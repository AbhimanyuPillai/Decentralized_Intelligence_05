import type { Express, Request, RequestHandler } from "express";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { decodePaymentResponseHeader, decodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentPayload } from "@x402/core/types";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { paymentMiddleware } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { privateKeyToAccount } from "viem/accounts";
import { claimPayment, fingerprintPayment, finishPayment } from "./replayStore.js";
import type { DemoFailureType } from "../../types.js";

export const BASE_SEPOLIA = "eip155:84532" as const;
export const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

function getSellerPayTo(environmentName: string): string | undefined {
  const configuredAddress = process.env[environmentName]?.trim();
  if (configuredAddress) return configuredAddress;

  // Existing projects can share one seller wallet until per-agent recipients are configured.
  const configuredKey = process.env.SELLER_PRIVATE_KEY?.trim();
  if (!configuredKey || !/^(0x)?[a-fA-F0-9]{64}$/.test(configuredKey)) return undefined;
  const privateKey = (configuredKey.startsWith("0x") ? configuredKey : `0x${configuredKey}`) as `0x${string}`;
  try {
    return privateKeyToAccount(privateKey).address;
  } catch {
    return undefined;
  }
}

export interface SellerListingDefinition {
  id: string;
  name: string;
  category: "scraping" | "data" | "inference";
  description: string;
  route: string;
  priceUnits: string;
  challengePriceUnits?: string;
  challengePayTo?: (listedPayTo: string) => string;
  demoScamType?: "price_mismatch" | "recipient_mismatch";
  demoReplayRole?: "first" | "second";
  demoFailureType?: DemoFailureType;
  onAuthorizationClaimed?: (request: Request) => void;
  onPaymentReplayRejected?: (request: Request, reason: string) => void;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  payToEnv: string;
  isReady?: () => boolean;
  handle: (input: unknown, request?: Request) => Promise<unknown>;
}

export function createSellerManifest(
  definition: SellerListingDefinition,
  endpointUrl: string
) {
  const payTo = getSellerPayTo(definition.payToEnv);
  const paymentsEnabled = process.env.SELLER_PAYMENTS_ENABLED === "true";
  const serviceReady = definition.isReady?.() ?? true;
  const ready = serviceReady && (!paymentsEnabled || isWalletAddress(payTo));
  const readinessReason = !serviceReady
    ? definition.demoScamType
      ? "Demo scam sellers require paid mode so Scout can inspect the deliberately mismatched payment challenge."
      : definition.demoFailureType
        ? "The seller failure demo requires paid mode."
      : `${definition.name} service configuration is incomplete.`
    : paymentsEnabled && !isWalletAddress(payTo)
      ? `Set ${definition.payToEnv} or SELLER_PRIVATE_KEY to enable paid calls.`
      : undefined;

  return {
    id: definition.id,
    name: definition.name,
    category: definition.category,
    description: definition.description,
    endpointUrl,
    priceUnits: paymentsEnabled ? definition.priceUnits : "0",
    paymentRequired: paymentsEnabled,
    ready,
    ...(readinessReason ? { readinessReason } : {}),
    network: BASE_SEPOLIA,
    asset: BASE_SEPOLIA_USDC,
    payTo: paymentsEnabled && payTo ? payTo : "0x0000000000000000000000000000000000000001",
    ...(definition.demoScamType ? { demoScamType: definition.demoScamType } : {}),
    ...(definition.demoReplayRole ? { demoReplayRole: definition.demoReplayRole } : {}),
    ...(definition.demoFailureType ? { demoFailureType: definition.demoFailureType } : {}),
    inputSchema: definition.inputSchema,
    outputSchema: definition.outputSchema,
    reputation: { totalCalls: 0, successfulCalls: 0, successRatePercent: null, medianLatencyMs: null, availabilityPercent: null, mismatchCount: 0 }
  };
}

interface SellerRequestState {
  fingerprint: string;
  serviceId: string;
  startedAt: number;
  workFailed: boolean;
}

declare module "express-serve-static-core" {
  interface Locals {
    paidSeller?: SellerRequestState;
  }
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
(addFormatsModule as unknown as (ajv: Ajv2020) => void)(ajv);
const freeRequestWindows = new Map<string, { startedAt: number; count: number }>();
const FREE_REQUESTS_PER_MINUTE = 30;
const facilitatorClient = new HTTPFacilitatorClient({
  url: process.env.X402_FACILITATOR_URL?.trim() || process.env.FACILITATOR_URL?.trim() || "https://x402.org/facilitator"
});
const resourceServer = new x402ResourceServer(facilitatorClient)
  .register(BASE_SEPOLIA, new ExactEvmScheme());

function isWalletAddress(value: string | undefined): value is string {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value) && !/^0x0{40}$/i.test(value);
}

function responseTxHash(response: import("express").Response): string | null {
  const header = response.getHeader("PAYMENT-RESPONSE");
  if (typeof header !== "string") return null;
  try {
    const settlement = decodePaymentResponseHeader(header);
    return settlement.success && typeof settlement.transaction === "string" && /^0x[a-fA-F0-9]{64}$/.test(settlement.transaction)
      ? settlement.transaction
      : null;
  } catch {
    return null;
  }
}

export function mountPaidJsonEndpoint(app: Express, definition: SellerListingDefinition): void {
  const validateInput = ajv.compile(definition.inputSchema);
  const validateOutput = ajv.compile(definition.outputSchema);
  const manifestPath = `/sellers/${definition.id}/manifest`;
  const payTo = getSellerPayTo(definition.payToEnv);
  const paymentsEnabled = process.env.SELLER_PAYMENTS_ENABLED === "true";
  const serviceReady = definition.isReady?.() ?? true;
  const ready = serviceReady && (!paymentsEnabled || isWalletAddress(payTo));
  const publicBase = process.env.PUBLIC_BASE_URL?.replace(/\/+$/, "");
  let endpointBase = "";
  try {
    const parsedBase = publicBase ? new URL(publicBase) : undefined;
    if (parsedBase && (parsedBase.protocol === "https:" || (parsedBase.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsedBase.hostname)))) {
      endpointBase = parsedBase.origin;
    }
  } catch {
    // Invalid or placeholder URLs fall back to a relative endpoint for local use.
  }

  app.get(manifestPath, (_request, response) => {
    response.json(createSellerManifest(
      definition,
      endpointBase ? `${endpointBase}${definition.route}` : definition.route
    ));
  });

  const validateRequest: RequestHandler = (request, response, next) => {
    if (!validateInput(request.body)) {
      response.status(400).json({ error: "Request does not match the seller input schema." });
      return;
    }
    next();
  };

  if (!paymentsEnabled) {
    const freeRateLimit: RequestHandler = (request, response, next) => {
      const key = request.ip || request.socket.remoteAddress || "unknown";
      const now = Date.now();
      const current = freeRequestWindows.get(`${definition.id}:${key}`);
      if (!current || now - current.startedAt >= 60_000) {
        freeRequestWindows.set(`${definition.id}:${key}`, { startedAt: now, count: 1 });
        next();
        return;
      }
      if (current.count >= FREE_REQUESTS_PER_MINUTE) {
        response.setHeader("Retry-After", String(Math.ceil((60_000 - (now - current.startedAt)) / 1000)));
        response.status(429).json({ error: "Free test request limit reached. Try again shortly." });
        return;
      }
      current.count += 1;
      next();
    };
    const deliverFree: RequestHandler = async (request, response) => {
      if (!serviceReady) {
        response.status(503).json({ error: `${definition.name} is not configured.` });
        return;
      }
      try {
        const result = await definition.handle(request.body);
        if (!validateOutput(result)) {
          console.error(`${definition.id} returned output that did not match its schema:`, ajv.errorsText(validateOutput.errors));
          response.status(500).json({ error: "Seller output did not match its registered schema." });
          return;
        }
        response.status(200).json(result);
      } catch (error) {
        console.error(`${definition.id} could not complete this request:`, error instanceof Error ? error.message : "unknown error");
        response.status(500).json({ error: `${definition.name} could not complete this request.` });
      }
    };
    app.post(definition.route, freeRateLimit, validateRequest, deliverFree);
    console.info(`${definition.id} is running in free test mode.`);
    return;
  }

  if (!ready || !payTo) {
    app.post(definition.route, validateRequest, (_request, response) => {
      response.status(503).json({ error: `${definition.name} is not configured.` });
    });
    console.warn(`${definition.id} is disabled until ${definition.payToEnv} and its service configuration are set.`);
    return;
  }

  const challengePayTo = definition.challengePayTo?.(payTo) ?? payTo;

  const routePayments = {
    [`POST ${definition.route}`]: {
      accepts: {
        scheme: "exact",
        network: BASE_SEPOLIA,
        payTo: challengePayTo,
        maxTimeoutSeconds: 60,
        price: {
          amount: definition.challengePriceUnits ?? definition.priceUnits,
          asset: BASE_SEPOLIA_USDC,
          extra: { assetTransferMethod: "eip3009", name: "USDC", version: "2" }
        }
      },
      description: definition.description,
      mimeType: "application/json",
      serviceName: definition.name
    }
  };
  const payment = paymentMiddleware(routePayments, resourceServer);

  const reserveAuthorization: RequestHandler = (request, response, next) => {
    const signature = request.get("PAYMENT-SIGNATURE");
    if (!signature) {
      response.status(402).json({ error: "A valid x402 v2 payment is required." });
      return;
    }

    let decoded: PaymentPayload;
    try {
      decoded = decodePaymentSignatureHeader(signature);
    } catch {
      response.status(402).json({ error: "Invalid x402 payment signature header." });
      return;
    }
    if (decoded.x402Version !== 2) {
      response.status(402).json({ error: "Only x402 version 2 is supported." });
      return;
    }

    const fingerprint = fingerprintPayment(decoded);
    const claim = claimPayment(fingerprint, definition.id);
    if (!claim.claimed) {
      definition.onPaymentReplayRejected?.(request, claim.reason);
      const error = claim.reason === "wrong_service"
        ? "This payment receipt is bound to a different seller service and cannot be reused here."
        : claim.reason === "in_progress"
          ? "This payment receipt is already being processed."
          : claim.reason === "settlement_unknown"
            ? "This payment receipt has an uncertain settlement and cannot be reused."
            : "This payment receipt has already been used and cannot be reused.";
      response.status(409).json({ error, code: claim.reason });
      return;
    }

    definition.onAuthorizationClaimed?.(request);

    response.locals.paidSeller = {
      fingerprint,
      serviceId: definition.id,
      startedAt: performance.now(),
      workFailed: false
    };
    response.on("finish", () => {
      const state = response.locals.paidSeller;
      if (!state) return;

      const txHash = responseTxHash(response);
      const outcome = txHash
        ? "settled"
        : state.workFailed || response.statusCode < 500
          ? "failed"
          : "unknown";

      try {
        finishPayment(
          state.fingerprint,
          state.serviceId,
          outcome,
          response.statusCode,
          txHash,
          Math.max(0, Math.round(performance.now() - state.startedAt))
        );
      } catch (error) {
        console.error("Could not persist seller call outcome.", error instanceof Error ? error.message : "unknown error");
      }
    });
    next();
  };

  const deliver: RequestHandler = async (request, response) => {
    try {
      const result = await definition.handle(request.body, request);
      if (!validateOutput(result)) {
        response.locals.paidSeller!.workFailed = true;
        console.error(`${definition.id} returned output that did not match its schema:`, ajv.errorsText(validateOutput.errors));
        response.status(500).json({ error: "Seller output did not match its registered schema." });
        return;
      }
      response.status(200).json(result);
    } catch (error) {
      response.locals.paidSeller!.workFailed = true;
      console.error(`${definition.id} could not complete this request:`, error instanceof Error ? error.message : "unknown error");
      if (definition.demoFailureType === "compute_error") {
        response.status(500).json({
            code: "DEMO_COMPUTE_FAILURE",
            error: "The demo seller failed during internal work. No service result was produced."
        });
        return;
      }
      response.status(500).json({ error: `${definition.name} could not complete this request.` });
    }
  };

  // The SDK verifies before `deliver`, then settles only when the validated handler returns 2xx.
  const blockDemoPayment: RequestHandler = (request, response, next) => {
    if (definition.demoScamType && request.get("PAYMENT-SIGNATURE")) {
      response.status(409).json({ error: "This intentionally unsafe demo seller never accepts payment." });
      return;
    }
    next();
  };
  app.post(definition.route, validateRequest, blockDemoPayment, payment, reserveAuthorization, deliver);
}

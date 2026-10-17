// Marketplace escrow: buyers pay the escrow wallet, and the marketplace releases the money
// to the seller or refunds the buyer.
//
//   held ──buyer accepts / hold expires──▶ released (money to seller)
//     │
//     └─buyer disputes─▶ automatic rule ─▶ refunded (money back to buyer)
//                        AI judge ───────▶ refunded or released
//                        unsure ─────────▶ needs review ──human──▶ released or refunded
//
// In free test mode the amounts are zero, so every step is bookkeeping only.
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { verifyMessage } from "viem";
import type { EscrowDecider, EscrowHold, LedgerRecord, SellerListing } from "../types.js";
import { getEscrowHold, listDueEscrowHolds, saveEscrowHold, updateEscrowHold } from "./database.js";
import { escrowEnabled, verdictMessage } from "./escrowConfig.js";
import { judgeDispute } from "./escrowJudge.js";
import { sendEscrowTransfer } from "./escrowTransfer.js";
import { findSeller } from "./registry.js";

export class EscrowError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export interface VerdictRequest {
  decision: "accept" | "dispute";
  reason?: string;
  evidence?: { task: string; input: unknown; output: unknown };
  signature?: string;
}

const HOLDABLE_STATUSES = new Set(["paid", "completed free", "paid, output rejected"]);
const ajv = new Ajv2020({ allErrors: true, strict: false });
(addFormatsModule as unknown as (instance: Ajv2020) => void)(ajv);
const outputValidators = new Map<string, ReturnType<typeof ajv.compile>>();

function paymentsEnabled(): boolean {
  return process.env.SELLER_PAYMENTS_ENABLED === "true";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function outputSchemaError(listing: SellerListing, output: unknown): string | undefined {
  const key = JSON.stringify(listing.outputSchema);
  let validate = outputValidators.get(key);
  if (!validate) {
    validate = ajv.compile(listing.outputSchema);
    outputValidators.set(key, validate);
  }
  return validate(output) ? undefined : ajv.errorsText(validate.errors);
}

/** Called after a call is saved to the ledger. Opens a hold if the seller is escrowed. */
export function openEscrowHold(record: LedgerRecord): EscrowHold | undefined {
  if (!escrowEnabled() || !HOLDABLE_STATUSES.has(record.status)) return undefined;
  const listing = findSeller(record.sellerId);
  if (!listing?.escrow) return undefined;
  const now = new Date();
  const hold: EscrowHold = {
    recordId: record.id,
    taskId: record.taskId,
    sellerId: record.sellerId,
    serviceName: record.serviceName,
    buyerAddress: record.buyerAddress,
    sellerPayTo: listing.escrow.sellerPayTo,
    asset: listing.asset,
    amountUnits: record.amountPaidUnits,
    paymentTxHash: record.txHash,
    state: "held",
    createdAt: now.toISOString(),
    releaseAfter: new Date(now.getTime() + listing.escrow.holdSeconds * 1000).toISOString()
  };
  saveEscrowHold(hold);
  return hold;
}

export function parseVerdict(body: unknown): VerdictRequest {
  if (!isObject(body)) throw new EscrowError("Verdict must be a JSON object.", 400);
  if (body.decision !== "accept" && body.decision !== "dispute") {
    throw new EscrowError("decision must be accept or dispute.", 400);
  }
  if (body.reason !== undefined && (typeof body.reason !== "string" || body.reason.length > 1000)) {
    throw new EscrowError("reason must be a string of at most 1000 characters.", 400);
  }
  if (body.decision === "dispute" && (typeof body.reason !== "string" || !body.reason.trim())) {
    throw new EscrowError("A dispute must say what was wrong.", 400);
  }
  if (body.signature !== undefined && (typeof body.signature !== "string" || !/^0x[a-fA-F0-9]+$/.test(body.signature))) {
    throw new EscrowError("signature must be a hex string.", 400);
  }
  let evidence: VerdictRequest["evidence"];
  if (body.evidence !== undefined) {
    if (!isObject(body.evidence) || typeof body.evidence.task !== "string") {
      throw new EscrowError("evidence must include the task the seller was hired for.", 400);
    }
    evidence = { task: body.evidence.task.slice(0, 2000), input: body.evidence.input, output: body.evidence.output };
  }
  return {
    decision: body.decision,
    ...(typeof body.reason === "string" ? { reason: body.reason.trim() } : {}),
    ...(evidence ? { evidence } : {}),
    ...(typeof body.signature === "string" ? { signature: body.signature } : {})
  };
}

/** The buyer accepts or disputes one call. Only the wallet that paid may do this. */
export async function submitVerdict(recordId: string, verdict: VerdictRequest): Promise<EscrowHold> {
  const found = getEscrowHold(recordId);
  if (!found) throw new EscrowError("No escrow hold exists for this call.", 404);
  if (found.state !== "held") throw new EscrowError(`This escrow is already ${found.state}.`, 409);

  if (paymentsEnabled()) {
    if (!verdict.signature) throw new EscrowError("Paid-mode verdicts must be signed by the buyer wallet.", 401);
    const valid = await verifyMessage({
      address: found.buyerAddress as `0x${string}`,
      message: verdictMessage(recordId, verdict.decision),
      signature: verdict.signature as `0x${string}`
    }).catch(() => false);
    if (!valid) throw new EscrowError("The verdict signature does not match the wallet that paid for this call.", 403);
  }

  // Re-read after the signature check so two verdicts cannot both act on the same hold.
  const hold = getEscrowHold(recordId)!;
  if (hold.state !== "held") throw new EscrowError(`This escrow is already ${hold.state}.`, 409);

  if (verdict.decision === "accept") {
    return settle(hold, "release", "buyer accepted", verdict.reason || "The buyer accepted the result.");
  }

  hold.dispute = { reason: verdict.reason!, at: new Date().toISOString() };
  hold.state = "needs review";
  hold.reviewNote = "The AI judge is reviewing this dispute.";
  updateEscrowHold(hold);
  return resolveDispute(hold, verdict);
}

async function resolveDispute(hold: EscrowHold, verdict: VerdictRequest): Promise<EscrowHold> {
  const listing = findSeller(hold.sellerId);
  const output = verdict.evidence?.output;
  const hasOutput = output !== undefined && output !== null;

  // Rule: a result that breaks the seller's own published format is refunded without debate.
  if (listing && hasOutput) {
    const schemaError = outputSchemaError(listing, output);
    if (schemaError) {
      return settle(hold, "refund", "automatic rule", `The result did not match the seller's published output format: ${schemaError}`);
    }
  }
  if (!listing || !hasOutput || !verdict.evidence) {
    return keepForReview(hold, "No usable result was submitted as evidence, so a human must decide.");
  }

  try {
    const ruling = await judgeDispute(listing, {
      task: verdict.evidence.task,
      input: verdict.evidence.input,
      output,
      complaint: hold.dispute!.reason
    });
    if (ruling.decision === "unsure") return keepForReview(hold, `The AI judge was unsure: ${ruling.reason}`);
    return settle(hold, ruling.decision, "AI judge", ruling.reason);
  } catch (error) {
    console.error("Escrow AI judge failed:", error instanceof Error ? error.message : "unknown error");
    return keepForReview(hold, "The AI judge was unavailable, so a human must decide.");
  }
}

function keepForReview(hold: EscrowHold, note: string): EscrowHold {
  hold.state = "needs review";
  hold.reviewNote = note;
  updateEscrowHold(hold);
  return hold;
}

async function settle(hold: EscrowHold, outcome: "release" | "refund", decidedBy: EscrowDecider, reason: string): Promise<EscrowHold> {
  hold.decision = { outcome, decidedBy, reason: reason.slice(0, 500), at: new Date().toISOString() };
  delete hold.reviewNote;
  const finalState = outcome === "release" ? "released" : "refunded";

  if (!paymentsEnabled() || BigInt(hold.amountUnits) === 0n) {
    hold.state = finalState;
    updateEscrowHold(hold);
    return hold;
  }

  hold.state = outcome === "release" ? "releasing" : "refunding";
  updateEscrowHold(hold);
  try {
    const recipient = outcome === "release" ? hold.sellerPayTo : hold.buyerAddress;
    const txHash = await sendEscrowTransfer(hold.asset, recipient, hold.amountUnits);
    hold.transferTxHash = txHash;
    hold.transferExplorerUrl = `https://sepolia.basescan.org/tx/${txHash}`;
    delete hold.transferError;
    hold.state = finalState;
  } catch (error) {
    hold.state = "transfer failed";
    hold.transferError = (error instanceof Error ? error.message : "Escrow transfer failed.").slice(0, 300);
  }
  updateEscrowHold(hold);
  return hold;
}

/** A human reviewer settles a disputed hold, or retries a transfer that failed. */
export async function resolveByHuman(recordId: string, outcome: "release" | "refund", note?: string): Promise<EscrowHold> {
  const hold = getEscrowHold(recordId);
  if (!hold) throw new EscrowError("No escrow hold exists for this call.", 404);
  if (hold.state !== "needs review" && hold.state !== "transfer failed") {
    throw new EscrowError(`Only disputed or failed holds can be resolved by hand; this one is ${hold.state}.`, 409);
  }
  if (hold.state === "needs review" && hold.reviewNote === "The AI judge is reviewing this dispute.") {
    throw new EscrowError("The AI judge is still reviewing this dispute.", 409);
  }
  const reason = note?.trim() || (outcome === "release" ? "A reviewer sided with the seller." : "A reviewer sided with the buyer.");
  return settle(hold, outcome, "human reviewer", reason);
}

let sweeping = false;

/** Releases undisputed holds whose hold period has ended. */
export async function releaseExpiredHolds(): Promise<number> {
  if (sweeping) return 0;
  sweeping = true;
  let released = 0;
  try {
    for (const due of listDueEscrowHolds(new Date().toISOString())) {
      const hold = getEscrowHold(due.recordId);
      if (hold?.state !== "held") continue;
      await settle(hold, "release", "hold expired", "No dispute was raised before the hold period ended.");
      released += 1;
    }
  } finally {
    sweeping = false;
  }
  return released;
}

export function startEscrowSweeper(): void {
  if (!escrowEnabled()) return;
  setInterval(() => {
    releaseExpiredHolds().catch((error: unknown) => {
      console.error("Escrow sweep failed:", error instanceof Error ? error.message : "unknown error");
    });
  }, 15_000).unref();
}

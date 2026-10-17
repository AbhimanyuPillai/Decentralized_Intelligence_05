import { Ajv2020 } from "ajv/dist/2020.js";
import contract from "../../marketplace-contract.json" with { type: "json" };
import type { SellerListing, SellerRegistration } from "../types.js";
import {
  calculateReputation,
  getSellerTrustStatus,
  getSeller,
  listSellers,
  reinstateSellerAfterReview,
  saveSeller
} from "./database.js";

const ajv = new Ajv2020({ allErrors: true, strict: false });

// Reputation is calculated from call records, so it is never trusted from a registration request.
const listingSchema = structuredClone(contract.sellerListingSchema);
const listingProperties = listingSchema.properties as Record<string, { pattern?: string; type?: string; minimum?: number; enum?: string[] }>;
listingProperties.paymentRequired = { type: "boolean" };
listingProperties.ready = { type: "boolean" };
listingProperties.readinessReason = { type: "string" };
listingProperties.selectionScore = { type: "number", minimum: 0 };
listingProperties.trustStatus = { type: "string", enum: ["unproven", "active", "quarantined", "blacklisted"] };
listingProperties.demoScamType = { type: "string", enum: ["price_mismatch", "recipient_mismatch"] };
const validateListing = ajv.compile(listingSchema);

function withCurrentReputation(listing: SellerListing): SellerListing {
  return {
    ...listing,
    reputation: calculateReputation(listing.id),
    trustStatus: getSellerTrustStatus(listing.id),
    rankingFactors: { legitimacy: 50, success: 50, availability: 50, latency: 50, cost: 50 },
    selectionScore: 50
  };
}

function rankSellers(listings: SellerListing[]): SellerListing[] {
  const eligible = listings.filter((seller) => seller.ready !== false &&
    seller.trustStatus !== "quarantined" && seller.trustStatus !== "blacklisted");
  const timed = eligible.filter((seller) => seller.reputation.medianLatencyMs !== null);
  const prices = eligible.map((seller) => BigInt(seller.priceUnits));
  const minLatency = Math.min(...timed.map((seller) => seller.reputation.medianLatencyMs!));
  const maxLatency = Math.max(...timed.map((seller) => seller.reputation.medianLatencyMs!));
  const minPrice = prices.length ? prices.reduce((a, b) => a < b ? a : b) : 0n;
  const maxPrice = prices.length ? prices.reduce((a, b) => a > b ? a : b) : 0n;

  const ranked = listings.map((seller) => {
    if (seller.trustStatus === "unproven") return { ...seller, rankingFactors: { legitimacy: 50, success: 50, availability: 50, latency: 50, cost: 50 }, selectionScore: 50 };
    const reputation = seller.reputation;
    const total = Math.max(1, reputation.totalCalls);
    const factors = {
      legitimacy: Math.max(0, (1 - reputation.mismatchCount / total) * 100),
      success: reputation.successRatePercent ?? 50,
      availability: reputation.availabilityPercent ?? 50,
      latency: reputation.medianLatencyMs === null ? 50 : maxLatency === minLatency
        ? 100
        : ((maxLatency - reputation.medianLatencyMs) / (maxLatency - minLatency)) * 100,
      cost: maxPrice === minPrice ? 100 : Number(((maxPrice - BigInt(seller.priceUnits)) * 10000n) / (maxPrice - minPrice)) / 100
    };
    const score = factors.legitimacy * 0.4 + factors.success * 0.25 + factors.availability * 0.15 + factors.latency * 0.1 + factors.cost * 0.1;
    return { ...seller, rankingFactors: factors, selectionScore: Math.round(score * 100) / 100 };
  });

  return ranked.sort((left, right) => {
    const scoreDifference = (right.selectionScore ?? 0) - (left.selectionScore ?? 0);
    if (scoreDifference !== 0) return scoreDifference;
    const latencyDifference = (left.reputation.medianLatencyMs ?? Number.MAX_SAFE_INTEGER) -
      (right.reputation.medianLatencyMs ?? Number.MAX_SAFE_INTEGER);
    if (latencyDifference !== 0) return latencyDifference;
    const priceDifference = BigInt(left.priceUnits) - BigInt(right.priceUnits);
    if (priceDifference !== 0n) return priceDifference < 0n ? -1 : 1;
    return left.id.localeCompare(right.id);
  });
}

export function registerSeller(input: SellerRegistration, registrationSource: "website" | "built_in" = "website"): SellerListing {
  if (registrationSource === "website" && getSeller(input.id)) throw new Error("A seller with this ID is already registered. Choose a new ID.");
  let endpoint: URL;
  try {
    endpoint = new URL(input.endpointUrl);
  } catch {
    throw new Error("endpointUrl must be a valid absolute URL.");
  }
  const paymentsEnabled = process.env.SELLER_PAYMENTS_ENABLED === "true";
  const localHttp = endpoint.protocol === "http:" && ["localhost", "127.0.0.1", "::1", "[::1]"].includes(endpoint.hostname);
  if (endpoint.protocol !== "https:" && !(!paymentsEnabled && localHttp)) {
    throw new Error(paymentsEnabled
      ? "Paid seller endpoints must use HTTPS."
      : "Free test endpoints must use HTTPS or localhost HTTP.");
  }

  const priceUnits = paymentsEnabled ? input.priceUnits : "0";
  if (!/^(0|[1-9][0-9]*)$/.test(priceUnits) || (paymentsEnabled && priceUnits === "0")) {
    throw new Error("Paid listings require a positive integer price in atomic USDC units.");
  }
  const suppliedPayTo = paymentsEnabled ? input.payTo : "0x0000000000000000000000000000000000000001";
  const validPayTo = /^0x[a-fA-F0-9]{40}$/.test(suppliedPayTo) && !/^0x0{40}$/i.test(suppliedPayTo);
  if (paymentsEnabled && !validPayTo && !(registrationSource === "built_in" && input.ready === false)) {
    throw new Error("Paid listings require a valid non-zero seller wallet address.");
  }
  const payTo = validPayTo ? suppliedPayTo : "0x0000000000000000000000000000000000000001";

  const listing = {
    ...input,
    priceUnits,
    payTo,
    paymentRequired: paymentsEnabled,
    ready: registrationSource === "built_in" ? input.ready === true : true,
    ...(input.readinessReason ? { readinessReason: input.readinessReason } : {}),
    ...(registrationSource === "built_in" && input.demoScamType ? { demoScamType: input.demoScamType } : {}),
    reputation: calculateReputation(input.id)
  } as SellerListing;

  if (!validateListing(listing)) {
    const details = ajv.errorsText(validateListing.errors, { separator: "; " });
    throw new Error(details);
  }

  saveSeller(listing, registrationSource);
  return findSeller(input.id)!;
}

export function findSeller(id: string): SellerListing | undefined {
  const listing = getSeller(id);
  return listing ? rankSellers([withCurrentReputation(listing)])[0] : undefined;
}

export function searchSellers(filters: {
  category?: string;
  maxPriceUnits?: string;
  query?: string;
  ready?: boolean;
  includeBlocked?: boolean;
}): SellerListing[] {
  const maxPrice = filters.maxPriceUnits
    ? BigInt(filters.maxPriceUnits)
    : undefined;

  const listings = listSellers()
    .map(withCurrentReputation)
    .filter((seller) => filters.includeBlocked || (seller.trustStatus !== "quarantined" && seller.trustStatus !== "blacklisted"))
    .filter((seller) => !filters.category || seller.category === filters.category)
    .filter((seller) => filters.ready === undefined || seller.ready === filters.ready)
    .filter((seller) => {
      const query = filters.query?.trim().toLocaleLowerCase();
      return !query || `${seller.name} ${seller.description} ${seller.id}`.toLocaleLowerCase().includes(query);
    })
    .filter(
      (seller) =>
        maxPrice === undefined || BigInt(seller.priceUnits) <= maxPrice
    );
  return rankSellers(listings);
}

export function reinstateSeller(id: string): boolean {
  return reinstateSellerAfterReview(id);
}

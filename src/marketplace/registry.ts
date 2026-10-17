import { Ajv2020 } from "ajv/dist/2020.js";
import contract from "../../marketplace-contract.json" with { type: "json" };
import type { SellerListing, SellerRegistration } from "../types.js";
import {
  calculateReputation,
  getSeller,
  listSellers,
  saveSeller
} from "./database.js";

const ajv = new Ajv2020({ allErrors: true, strict: false });

// Reputation is calculated from call records, so it is never trusted from a registration request.
const listingSchema = structuredClone(contract.sellerListingSchema);
const listingProperties = listingSchema.properties as Record<string, { pattern?: string; type?: string; minimum?: number }>;
listingProperties.paymentRequired = { type: "boolean" };
listingProperties.ready = { type: "boolean" };
listingProperties.readinessReason = { type: "string" };
listingProperties.selectionScore = { type: "number", minimum: 0 };
const validateListing = ajv.compile(listingSchema);

function withCurrentReputation(listing: SellerListing): SellerListing {
  const reputation = calculateReputation(listing.id);
  const neutralSuccessRate = reputation.successRatePercent ?? 100;
  const price = BigInt(listing.priceUnits);
  // Free listings use success rate alone because dividing by zero is undefined.
  const selectionScore = price === 0n ? neutralSuccessRate : neutralSuccessRate / Number(price);
  return {
    ...listing,
    reputation,
    selectionScore
  };
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
    reputation: calculateReputation(input.id)
  } as SellerListing;

  if (!validateListing(listing)) {
    const details = ajv.errorsText(validateListing.errors, { separator: "; " });
    throw new Error(details);
  }

  saveSeller(listing, registrationSource);
  return listing;
}

export function findSeller(id: string): SellerListing | undefined {
  const listing = getSeller(id);
  return listing ? withCurrentReputation(listing) : undefined;
}

export function searchSellers(filters: {
  category?: string;
  maxPriceUnits?: string;
  query?: string;
  ready?: boolean;
}): SellerListing[] {
  const maxPrice = filters.maxPriceUnits
    ? BigInt(filters.maxPriceUnits)
    : undefined;

  return listSellers()
    .filter((seller) => !filters.category || seller.category === filters.category)
    .filter((seller) => filters.ready === undefined || seller.ready === filters.ready)
    .filter((seller) => {
      const query = filters.query?.trim().toLocaleLowerCase();
      return !query || `${seller.name} ${seller.description} ${seller.id}`.toLocaleLowerCase().includes(query);
    })
    .filter(
      (seller) =>
        maxPrice === undefined || BigInt(seller.priceUnits) <= maxPrice
    )
    .map(withCurrentReputation)
    .sort((left, right) => {
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

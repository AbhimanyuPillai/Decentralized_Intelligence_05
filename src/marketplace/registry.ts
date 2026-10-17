import { Ajv2020 } from "ajv/dist/2020.js";
import contract from "../../marketplace-contract.json" with { type: "json" };
import type { SellerListing, SellerRegistration } from "../types.js";
import { movieSummaryReady } from "../sellers/movie-summary/service.js";
import {
  calculateReputation,
  getSeller,
  listSellers,
  saveSeller
} from "./database.js";

const ajv = new Ajv2020({ allErrors: true, strict: false });

// Reputation is calculated from call records, so it is never trusted from a registration request.
const listingSchema = structuredClone(contract.sellerListingSchema);
const listingProperties = listingSchema.properties as Record<string, { pattern?: string; type?: string }>;
const priceSchema = listingProperties.priceUnits;
if (priceSchema) priceSchema.pattern = "^(0|[1-9][0-9]*)$";
// Keep the shared contract JSON unchanged; these are runtime marketplace fields.
listingProperties.paymentRequired = { type: "boolean" };
listingProperties.ready = { type: "boolean" };
const validateListing = ajv.compile(listingSchema);

function withCurrentReputation(listing: SellerListing): SellerListing {
  return {
    ...listing,
    ...(listing.id === "movie-summary" ? { ready: movieSummaryReady() } : {}),
    reputation: calculateReputation(listing.id)
  };
}

export function registerSeller(input: SellerRegistration, registrationSource: "website" | "built_in" = "website"): SellerListing {
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
  const payTo = paymentsEnabled ? input.payTo : "0x0000000000000000000000000000000000000001";
  if (paymentsEnabled && (!/^0x[a-fA-F0-9]{40}$/.test(payTo) || /^0x0{40}$/i.test(payTo))) {
    throw new Error("Paid listings require a valid non-zero seller wallet address.");
  }

  const listing = {
    ...input,
    priceUnits,
    payTo,
    paymentRequired: paymentsEnabled,
    ready: input.id === "movie-summary" ? movieSummaryReady() : true,
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
    .map(withCurrentReputation);
}

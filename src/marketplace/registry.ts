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
const validateListing = ajv.compile(listingSchema);

function withCurrentReputation(listing: SellerListing): SellerListing {
  return { ...listing, reputation: calculateReputation(listing.id) };
}

export function seedListingsFromContract(): void {
  for (const listing of contract.sellers as SellerListing[]) {
    const hasPlaceholders =
      listing.endpointUrl.includes("REPLACE_ME") ||
      listing.payTo.includes("REPLACE_ME");

    // Don't publish sample entries with placeholder URLs or wallet addresses.
    if (hasPlaceholders) continue;

    const readyListing = withCurrentReputation(listing);
    if (validateListing(readyListing)) saveSeller(readyListing);
  }
}

export function registerSeller(input: SellerRegistration): SellerListing {
  let endpoint: URL;
  try {
    endpoint = new URL(input.endpointUrl);
  } catch {
    throw new Error("endpointUrl must be a valid absolute URL.");
  }
  if (endpoint.protocol !== "https:") {
    throw new Error("endpointUrl must use HTTPS.");
  }

  const listing = {
    ...input,
    reputation: calculateReputation(input.id)
  } as SellerListing;

  if (!validateListing(listing)) {
    const details = ajv.errorsText(validateListing.errors, { separator: "; " });
    throw new Error(details);
  }

  saveSeller(listing);
  return listing;
}

export function findSeller(id: string): SellerListing | undefined {
  const listing = getSeller(id);
  return listing ? withCurrentReputation(listing) : undefined;
}

export function searchSellers(filters: {
  category?: string;
  maxPriceUnits?: string;
}): SellerListing[] {
  const maxPrice = filters.maxPriceUnits
    ? BigInt(filters.maxPriceUnits)
    : undefined;

  return listSellers()
    .filter((seller) => !filters.category || seller.category === filters.category)
    .filter(
      (seller) =>
        maxPrice === undefined || BigInt(seller.priceUnits) <= maxPrice
    )
    .map(withCurrentReputation);
}

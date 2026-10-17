import type { Express } from "express";
import { mountPaidJsonEndpoint, type SellerListingDefinition } from "../shared/paidJsonEndpoint.js";
import { getPoundToRupeeRate } from "./service.js";
import { fxRatesInputSchema, fxRatesOutputSchema, type FxRatesInput } from "./schema.js";

export const fxRatesDefinition: SellerListingDefinition = {
  id: "fx-rates",
  name: "FX Rates Agent",
  category: "data",
  description: "Returns a sourced GBP-to-INR exchange rate and the time it was observed.",
  route: "/sellers/fx-rates/rate",
  priceUnits: "1000",
  payToEnv: "FX_RATES_PAY_TO",
  inputSchema: fxRatesInputSchema,
  outputSchema: fxRatesOutputSchema,
  handle: (input) => getPoundToRupeeRate(input as FxRatesInput)
};

export function mountFxRates(app: Express): void {
  mountPaidJsonEndpoint(app, fxRatesDefinition);
}

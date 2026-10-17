export const fxRatesInputSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: { from: { type: "string", const: "GBP" }, to: { type: "string", const: "INR" } },
  required: ["from", "to"],
  additionalProperties: false
} as const;

export const fxRatesOutputSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    from: { type: "string", const: "GBP" },
    to: { type: "string", const: "INR" },
    rate: { type: "number", exclusiveMinimum: 0 },
    timestamp: { type: "string", format: "date-time" },
    source: { type: "string", minLength: 1 }
  },
  required: ["from", "to", "rate", "timestamp", "source"],
  additionalProperties: false
} as const;

export interface FxRatesInput { from: "GBP"; to: "INR" }
export interface FxRatesOutput {
  from: "GBP";
  to: "INR";
  rate: number;
  timestamp: string;
  source: string;
}

export const hindiBookSummaryInputSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    items: {
      type: "array",
      minItems: 1,
      maxItems: 2,
      items: {
        type: "object",
        properties: { id: { type: "string", minLength: 1 }, text: { type: "string", minLength: 1 } },
        required: ["id", "text"],
        additionalProperties: false
      }
    }
  },
  required: ["items"],
  additionalProperties: false
} as const;

export const hindiBookSummaryOutputSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    summaries: {
      type: "array",
      minItems: 1,
      maxItems: 2,
      items: {
        type: "object",
        properties: {
          id: { type: "string", minLength: 1 },
          summary: { type: "string", minLength: 1 }
        },
        required: ["id", "summary"],
        additionalProperties: false
      }
    }
  },
  required: ["summaries"],
  additionalProperties: false
} as const;

export interface HindiBookSummaryInput { items: Array<{ id: string; text: string }> }
export interface HindiBookSummaryOutput { summaries: Array<{ id: string; summary: string }> }

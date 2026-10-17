export const jobSummaryInputSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    items: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          id: { type: "string", minLength: 1, maxLength: 120 },
          title: { type: "string", minLength: 1, maxLength: 200 },
          text: { type: "string", minLength: 1, maxLength: 5000 }
        },
        required: ["id", "text"],
        additionalProperties: false
      }
    }
  },
  required: ["items"],
  additionalProperties: false
} as const;

export const jobSummaryOutputSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    summaries: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          id: { type: "string", minLength: 1, maxLength: 120 },
          summary: { type: "string", minLength: 1, maxLength: 700 }
        },
        required: ["id", "summary"],
        additionalProperties: false
      }
    }
  },
  required: ["summaries"],
  additionalProperties: false
} as const;

export interface JobSummaryInput { items: Array<{ id: string; title?: string; text: string }> }
export interface JobSummaryOutput { summaries: Array<{ id: string; summary: string }> }

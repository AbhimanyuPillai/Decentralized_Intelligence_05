export const movieSummaryInputSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    items: {
      type: "array",
      minItems: 1,
      maxItems: 2,
      items: {
        type: "object",
        properties: {
          id: { type: "string", minLength: 1, maxLength: 80 },
          title: { type: "string", minLength: 1, maxLength: 160 },
          awards: { type: "integer", minimum: 0 },
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

export const movieSummaryOutputSchema = {
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
          id: { type: "string", minLength: 1, maxLength: 80 },
          summary: { type: "string", minLength: 1, maxLength: 500 }
        },
        required: ["id", "summary"],
        additionalProperties: false
      }
    }
  },
  required: ["summaries"],
  additionalProperties: false
} as const;

export interface MovieSummaryItem {
  id: string;
  title?: string;
  awards?: number;
  text: string;
}

export interface MovieSummaryInput {
  items: MovieSummaryItem[];
}

export interface MovieSummaryOutput {
  summaries: Array<{ id: string; summary: string }>;
}

export const movieFactsInputSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    titles: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      uniqueItems: true,
      items: { type: "string", minLength: 1, maxLength: 160 }
    }
  },
  required: ["titles"],
  additionalProperties: false
} as const;

export const movieFactsOutputSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    films: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          requestedTitle: { type: "string", minLength: 1 },
          title: { type: "string", minLength: 1 },
          description: { type: "string" },
          extract: { type: "string", minLength: 1, maxLength: 5000 },
          sourceName: { type: "string", const: "English Wikipedia" },
          sourceUrl: { type: "string", format: "uri" },
          retrievedAt: { type: "string", format: "date-time" }
        },
        required: ["requestedTitle", "title", "description", "extract", "sourceName", "sourceUrl", "retrievedAt"],
        additionalProperties: false
      }
    }
  },
  required: ["films"],
  additionalProperties: false
} as const;

export interface MovieFactsInput {
  titles: string[];
}

export interface MovieFact {
  requestedTitle: string;
  title: string;
  description: string;
  extract: string;
  sourceName: "English Wikipedia";
  sourceUrl: string;
  retrievedAt: string;
}

export interface MovieFactsOutput {
  films: MovieFact[];
}

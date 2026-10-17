export const shelfScraperInputSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: { page: { type: "integer", minimum: 1, maximum: 50 } },
  required: ["page"],
  additionalProperties: false
} as const;

export const shelfScraperOutputSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    page: { type: "integer", minimum: 1 },
    books: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", minLength: 1 },
          title: { type: "string", minLength: 1 },
          priceGbp: { type: "number", minimum: 0 },
          stars: { type: "integer", minimum: 1, maximum: 5 },
          description: { type: "string" }
        },
        required: ["id", "title", "priceGbp", "stars", "description"],
        additionalProperties: false
      }
    }
  },
  required: ["page", "books"],
  additionalProperties: false
} as const;

export interface ShelfScraperInput { page: number }
export interface ShelfBook {
  id: string;
  title: string;
  priceGbp: number;
  stars: number;
  description: string;
}
export interface ShelfScraperOutput { page: number; books: ShelfBook[] }

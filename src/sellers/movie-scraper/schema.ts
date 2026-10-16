export const movieScraperInputSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    year: { type: "integer", minimum: 2010, maximum: 2015 }
  },
  required: ["year"],
  additionalProperties: false
} as const;

export const movieScraperOutputSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    year: { type: "integer", minimum: 2010, maximum: 2015 },
    movies: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          title: { type: "string", minLength: 1 },
          year: { type: "integer", minimum: 2010, maximum: 2015 },
          nominations: { type: "integer", minimum: 0 },
          awards: { type: "integer", minimum: 0 },
          bestPicture: { type: "boolean" }
        },
        required: ["title", "year", "nominations", "awards", "bestPicture"],
        additionalProperties: false
      }
    }
  },
  required: ["year", "movies"],
  additionalProperties: false
} as const;

export interface MovieScraperInput {
  year: number;
}

export interface MovieRecord {
  title: string;
  year: number;
  nominations: number;
  awards: number;
  bestPicture: boolean;
}

export interface MovieScraperOutput {
  year: number;
  movies: MovieRecord[];
}

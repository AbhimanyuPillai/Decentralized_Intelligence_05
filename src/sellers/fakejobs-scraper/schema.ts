export const fakeJobsScraperInputSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    keywords: { type: "string", maxLength: 120 },
    location: { type: "string", maxLength: 120 },
    limit: { type: "integer", minimum: 1, maximum: 50 }
  },
  additionalProperties: false
} as const;

export const fakeJobsScraperOutputSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    totalFound: { type: "integer", minimum: 0 },
    jobs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", minLength: 1 },
          title: { type: "string", minLength: 1 },
          company: { type: "string", minLength: 1 },
          location: { type: "string", minLength: 1 },
          postedAt: { type: "string", format: "date" },
          url: { type: "string", format: "uri" }
        },
        required: ["id", "title", "company", "location", "postedAt", "url"],
        additionalProperties: false
      }
    }
  },
  required: ["totalFound", "jobs"],
  additionalProperties: false
} as const;

export interface FakeJobsScraperInput { keywords?: string; location?: string; limit?: number }
export interface FakeJobListing {
  id: string;
  title: string;
  company: string;
  location: string;
  postedAt: string;
  url: string;
}
export interface FakeJobsScraperOutput { totalFound: number; jobs: FakeJobListing[] }

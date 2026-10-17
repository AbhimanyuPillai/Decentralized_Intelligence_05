export const jobFactsInputSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    jobIds: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      uniqueItems: true,
      items: { type: "string", pattern: "^[a-z0-9-]+-[0-9]+$", maxLength: 120 }
    }
  },
  required: ["jobIds"],
  additionalProperties: false
} as const;

export const jobFactsOutputSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    jobs: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          id: { type: "string", minLength: 1 },
          title: { type: "string", minLength: 1 },
          company: { type: "string", minLength: 1 },
          location: { type: "string", minLength: 1 },
          postedAt: { type: "string", format: "date" },
          description: { type: "string", minLength: 1 },
          sourceUrl: { type: "string", format: "uri" }
        },
        required: ["id", "title", "company", "location", "postedAt", "description", "sourceUrl"],
        additionalProperties: false
      }
    }
  },
  required: ["jobs"],
  additionalProperties: false
} as const;

export interface JobFactsInput { jobIds: string[] }
export interface JobFact {
  id: string;
  title: string;
  company: string;
  location: string;
  postedAt: string;
  description: string;
  sourceUrl: string;
}
export interface JobFactsOutput { jobs: JobFact[] }

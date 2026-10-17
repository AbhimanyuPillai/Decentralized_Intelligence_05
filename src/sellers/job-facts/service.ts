import { load } from "cheerio";
import { fetchHtmlPage, mapConcurrent } from "../shared/htmlPage.js";
import type { JobFact, JobFactsInput, JobFactsOutput } from "./schema.js";

const JOBS_ORIGIN = "https://realpython.github.io";
const USER_AGENT = "PPC-Agent-Economy/1.0 (+https://realpython.github.io/fake-jobs/)";

function requiredText(value: string | undefined, field: string): string {
  const text = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!text) throw new Error(`The Fake Python job page did not include ${field}.`);
  return text;
}

async function getJobFact(id: string): Promise<JobFact> {
  if (!/^[a-z0-9-]+-[0-9]+$/.test(id)) throw new Error("A job ID has an invalid format.");
  const sourceUrl = new URL(`/fake-jobs/jobs/${id}.html`, JOBS_ORIGIN).toString();
  const html = await fetchHtmlPage(sourceUrl, USER_AGENT);
  const $ = load(html);
  const title = requiredText($("h1").first().text(), "a job title");
  const company = requiredText($("h2").first().text(), "a company name");
  const pageParagraphs = $("p")
    .toArray()
    .map((element) => $(element).text().replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const locationLine = pageParagraphs.find((text) => /^Location:\s*/i.test(text));
  const postedLine = pageParagraphs.find((text) => /^Posted:\s*/i.test(text));
  const location = requiredText(locationLine?.replace(/^Location:\s*/i, ""), "a location");
  const time = $("time").first();
  const postedAt = requiredText(
    time.attr("datetime") || time.text() || postedLine?.replace(/^Posted:\s*/i, ""),
    "a posted date",
  );
  const descriptionParts = $(".content p, .content li")
    .toArray()
    .map((element) => $(element).text().replace(/\s+/g, " ").trim())
    .filter((text) => Boolean(text) && !/^(Location|Posted):\s*/i.test(text));
  const description = requiredText(descriptionParts.join(" "), "a job description");

  return { id, title, company, location, postedAt, description, sourceUrl };
}

export async function getJobFacts(input: JobFactsInput): Promise<JobFactsOutput> {
  return { jobs: await mapConcurrent(input.jobIds, 3, getJobFact) };
}

import { load } from "cheerio";
import { fetchHtmlPage } from "../shared/htmlPage.js";
import type { FakeJobsScraperInput, FakeJobsScraperOutput, FakeJobListing } from "./schema.js";

const JOBS_URL = "https://realpython.github.io/fake-jobs/";
const USER_AGENT = "PPC-Agent-Economy/1.0 (+https://realpython.github.io/fake-jobs/)";

function textOrThrow(value: string | undefined, field: string): string {
  const text = value?.trim() ?? "";
  if (!text) throw new Error(`The Fake Python source did not include ${field}.`);
  return text;
}

function parseListings(html: string): FakeJobListing[] {
  const $ = load(html);
  const jobs = $(".card-content").toArray().map((element) => {
    const card = $(element);
    const title = textOrThrow(card.find(".title").first().text(), "a job title");
    const company = textOrThrow(card.find(".company").first().text(), "a company name");
    const location = textOrThrow(card.find(".location").first().text(), "a location");
    const dateText = card.find("time").first().attr("datetime") || card.find("time").first().text();
    const postedAt = textOrThrow(dateText, "a posted date");
    const jobLink = card.find('a[href*="/jobs/"]').first().attr("href");
    if (!jobLink) throw new Error("A job listing did not include its details link.");
    const url = new URL(jobLink, JOBS_URL);
    if (url.origin !== new URL(JOBS_URL).origin || !/^\/fake-jobs\/jobs\/[a-z0-9-]+\.html$/.test(url.pathname)) {
      throw new Error("The Fake Python source returned an unexpected job link.");
    }
    const id = url.pathname.split("/").pop()?.replace(/\.html$/, "");
    if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(postedAt)) throw new Error("The Fake Python source returned an invalid job listing.");
    return { id, title, company, location, postedAt, url: url.toString() };
  });
  if (jobs.length === 0) throw new Error("The Fake Python source returned no job cards.");
  return jobs;
}

export async function searchFakeJobs(input: FakeJobsScraperInput): Promise<FakeJobsScraperOutput> {
  const html = await fetchHtmlPage(JOBS_URL, USER_AGENT);
  const allJobs = parseListings(html);
  const keywords = input.keywords?.trim().toLowerCase();
  const location = input.location?.trim().toLowerCase();
  const matchingJobs = allJobs.filter((job) => {
    const haystack = `${job.title} ${job.company} ${job.location}`.toLowerCase();
    return (!keywords || keywords.split(/\s+/).every((word) => haystack.includes(word))) &&
      (!location || job.location.toLowerCase().includes(location));
  });
  return { totalFound: matchingJobs.length, jobs: matchingJobs.slice(0, input.limit ?? 20) };
}

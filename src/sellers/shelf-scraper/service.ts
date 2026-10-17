import { load } from "cheerio";
import { fetchHtmlPage, mapConcurrent } from "../shared/htmlPage.js";
import type { ShelfBook, ShelfScraperInput, ShelfScraperOutput } from "./schema.js";

const BASE_URL = "https://books.toscrape.com/";
const USER_AGENT = "PPC-Agent-Economy/1.0 (+https://books.toscrape.com/)";
const starValues: Record<string, number> = { One: 1, Two: 2, Three: 3, Four: 4, Five: 5 };

function requiredText(value: string | undefined, label: string): string {
  const text = value?.trim() ?? "";
  if (!text) throw new Error(`The book source did not provide ${label}.`);
  return text;
}

function parseCatalog(html: string, catalogUrl: string) {
  const $ = load(html);
  const books = $("article.product_pod").toArray().map((element) => {
    const card = $(element);
    const link = card.find("h3 a").first();
    const href = link.attr("href");
    if (!href) throw new Error("A book listing did not include a detail page link.");
    const detailUrl = new URL(href, catalogUrl).toString();
    const id = new URL(detailUrl).pathname.match(/\/([^/]+)\/index\.html$/)?.[1];
    const title = link.attr("title") || link.text();
    const priceText = card.find(".price_color").first().text();
    const price = Number(priceText.replace(/[^0-9.]/g, ""));
    const starClass = card.find(".star-rating").attr("class")?.split(/\s+/).find((name) => name !== "star-rating");
    const stars = starClass ? starValues[starClass] : undefined;
    if (!id || !title.trim() || !Number.isFinite(price) || stars === undefined) {
      throw new Error("The book source returned a listing with unexpected fields.");
    }
    return { id, title: title.trim(), priceGbp: price, stars, detailUrl };
  });
  if (books.length === 0) throw new Error("The book source returned no listings for this page.");
  return books;
}

async function getDescription(book: { detailUrl: string }): Promise<string> {
  const html = await fetchHtmlPage(book.detailUrl, USER_AGENT);
  const $ = load(html);
  return requiredText($("#product_description").next("p").text(), "a product description");
}

export async function scrapeBooks(input: ShelfScraperInput): Promise<ShelfScraperOutput> {
  const listingUrl = new URL(`catalogue/page-${input.page}.html`, BASE_URL);
  const html = await fetchHtmlPage(listingUrl.toString(), USER_AGENT);
  const listings = parseCatalog(html, listingUrl.toString());
  const books = await mapConcurrent(listings, 4, async (book): Promise<ShelfBook> => ({
    id: book.id,
    title: book.title,
    priceGbp: book.priceGbp,
    stars: book.stars,
    description: await getDescription(book)
  }));
  return { page: input.page, books };
}

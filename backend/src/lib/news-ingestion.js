import "dotenv/config";
import { createHash } from "node:crypto";
import { supabase } from "./supabase.js";

const GNEWS_ENDPOINT = "https://gnews.io/api/v4/search";
const INTERVAL_MS = Math.max(Number(process.env.NEWS_INGESTION_INTERVAL_MINUTES || 60), 15) * 60 * 1000;
const MAX_ARTICLES = Math.min(Math.max(Number(process.env.NEWS_INGESTION_MAX_ARTICLES || 10), 1), 10);

const FEEDS = [
  { name: "INDIA", slug: "india", query: '(India OR Indian) (economy OR business OR markets OR stocks OR finance)' },
  { name: "CRYPTO", slug: "crypto", query: '(cryptocurrency OR crypto OR Bitcoin OR Ethereum OR blockchain)' },
  { name: "CRICKET", slug: "cricket", query: '(cricket OR IPL OR BCCI OR "Indian cricket team")' }
];

function makeSlug(title, url) {
  const base = String(title || "news")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 105) || "news";
  const hash = createHash("sha256").update(String(url)).digest("hex").slice(0, 10);
  return `${base}-${hash}`;
}

async function getCategoryId(feed) {
  const { data, error } = await supabase
    .from("categories")
    .upsert({ name: feed.name, slug: feed.slug }, { onConflict: "slug" })
    .select("id")
    .single();
  if (error) throw new Error(`Category ${feed.slug}: ${error.message}`);
  return data.id;
}

async function fetchFeed(feed, apiKey) {
  const url = new URL(GNEWS_ENDPOINT);
  url.searchParams.set("q", feed.query);
  url.searchParams.set("lang", "en");
  url.searchParams.set("country", "in");
  url.searchParams.set("max", String(MAX_ARTICLES));
  url.searchParams.set("sortby", "publishedAt");
  url.searchParams.set("apikey", apiKey);

  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`GNews ${feed.slug} returned HTTP ${response.status}: ${detail.slice(0, 250)}`);
  }
  const payload = await response.json();
  return Array.isArray(payload.articles) ? payload.articles : [];
}

export async function ingestNewsFeed(feed) {
  const apiKey = process.env.GNEWS_API_KEY;
  if (!apiKey) throw new Error("GNEWS_API_KEY is not configured");

  const categoryId = await getCategoryId(feed);
  const { data: admins, error: adminError } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "ADMIN")
    .eq("status", true)
    .limit(1);

  if (adminError) throw new Error(`Admin profile lookup failed: ${adminError.message}`);
  if (!admins?.length) throw new Error("No active ADMIN profile exists for article attribution");
  const adminId = admins[0].id;

  const externalArticles = await fetchFeed(feed, apiKey);
  let inserted = 0;
  let skipped = 0;

  for (const article of externalArticles) {
    const title = String(article.title || "").trim();
    const sourceUrl = String(article.url || "").trim();
    if (!title || !sourceUrl || !/^https?:\/\//i.test(sourceUrl)) {
      skipped += 1;
      continue;
    }

    const description = String(article.description || "").trim();
    const sourceName = String(article.source?.name || "").trim() || "Original publisher";
    const publishedAt = article.publishedAt && !Number.isNaN(Date.parse(article.publishedAt))
      ? new Date(article.publishedAt).toISOString()
      : new Date().toISOString();
    const content = [
      description || title,
      "",
      `Source: ${sourceName}`,
      `Original article: ${sourceUrl}`
    ].join("\n");

    const row = {
      title: title.slice(0, 240),
      slug: makeSlug(title, sourceUrl),
      content,
      category_id: categoryId,
      created_by: adminId,
      image_url: typeof article.image === "string" && /^https?:\/\//i.test(article.image) ? article.image : null,
      source_url: sourceUrl,
      source_name: sourceName,
      access_type: "FREE",
      status: "PUBLISHED",
      published_at: publishedAt
    };

    const { data, error } = await supabase
      .from("articles")
      .upsert(row, { onConflict: "source_url", ignoreDuplicates: true })
      .select("id");

    if (error) {
      // Some older deployments may not have applied the migration yet.
      throw new Error(`Article insert failed for ${feed.slug}: ${error.message}`);
    }
    if (data?.length) inserted += 1;
    else skipped += 1;
  }

  return { category: feed.slug, fetched: externalArticles.length, inserted, skipped };
}

let ingestionRunning = false;

export async function runNewsIngestion() {
  if (!process.env.GNEWS_API_KEY) {
    console.warn("News ingestion is disabled: GNEWS_API_KEY is not configured");
    return;
  }
  if (ingestionRunning) {
    console.warn("News ingestion skipped: previous run still in progress");
    return;
  }

  ingestionRunning = true;
  try {
    for (const feed of FEEDS) {
      try {
        const result = await ingestNewsFeed(feed);
        console.log("News ingestion complete:", result);
      } catch (error) {
        console.error(`News ingestion failed for ${feed.slug}:`, error?.message || error);
      }
    }
  } finally {
    ingestionRunning = false;
  }
}

export function startNewsIngestionScheduler() {
  if (!process.env.GNEWS_API_KEY) {
    console.warn("News ingestion scheduler not started: GNEWS_API_KEY is not configured");
    return;
  }
  const intervalMinutes = Math.round(INTERVAL_MS / 60000);
  console.log(`News ingestion scheduler started (every ${intervalMinutes} minutes)`);
  // Run after the HTTP server has started; do not block startup on provider latency.
  setTimeout(() => void runNewsIngestion(), 5000);
  setInterval(() => void runNewsIngestion(), INTERVAL_MS);
}

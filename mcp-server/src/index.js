import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const required = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "BAZAARNEXA_ADMIN_EMAIL", "BAZAARNEXA_ADMIN_PASSWORD"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing required MCP environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

const apiBase = (process.env.BAZAARNEXA_API_URL || "https://news-api-egmd.onrender.com").replace(/\/+$/, "");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});
let accessToken = null;
let refreshToken = null;
let tokenExpiresAt = 0;
let authPromise = null;

async function signIn() {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: process.env.BAZAARNEXA_ADMIN_EMAIL,
    password: process.env.BAZAARNEXA_ADMIN_PASSWORD
  });
  if (error || !data.session || !data.user) {
    throw new Error("Supabase sign-in failed. Check the local admin credentials and Phone/Email auth configuration.");
  }
  accessToken = data.session.access_token;
  refreshToken = data.session.refresh_token;
  tokenExpiresAt = Date.now() + Math.max(0, data.session.expires_in - 60) * 1000;
  const { data: profile, error: profileError } = await supabase.from("profiles")
    .select("role,status").eq("id", data.user.id).maybeSingle();
  if (profileError || !profile || profile.role !== "ADMIN" || profile.status !== true) {
    accessToken = null;
    refreshToken = null;
    throw new Error("The configured Supabase user does not have an enabled ADMIN profile.");
  }
}

async function ensureToken() {
  if (accessToken && Date.now() < tokenExpiresAt) return accessToken;
  if (authPromise) return authPromise;
  authPromise = (async () => {
    if (refreshToken) {
      const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
      if (!error && data.session) {
        accessToken = data.session.access_token;
        refreshToken = data.session.refresh_token;
        tokenExpiresAt = Date.now() + Math.max(0, data.session.expires_in - 60) * 1000;
        return accessToken;
      }
    }
    await signIn();
    return accessToken;
  })();
  try { return await authPromise; } finally { authPromise = null; }
}

async function api(path, options = {}, retry = true) {
  const token = await ensureToken();
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    },
    signal: AbortSignal.timeout(20000)
  });
  if (response.status === 401 && retry) {
    accessToken = null;
    tokenExpiresAt = 0;
    return api(path, options, false);
  }
  const raw = await response.text();
  let payload;
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { error: "API returned invalid JSON" }; }
  if (!response.ok) {
    const message = typeof payload.error === "string" ? payload.error : `Admin API request failed (${response.status})`;
    throw new Error(message);
  }
  return payload;
}

const server = new McpServer({ name: "bazaarnexa-local", version: "0.1.0" });
const jsonResult = (value) => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });

server.tool(
  "list_categories",
  "List BazaarNexa categories and their IDs. Use the returned category ID when saving a draft.",
  {},
  async () => jsonResult(await api("/api/admin/categories"))
);

server.tool(
  "list_articles",
  "List recent BazaarNexa admin articles. Use this before drafting to avoid duplicates. Results include drafts and published items.",
  {
    page: z.number().int().min(1).max(100).optional().default(1),
    limit: z.number().int().min(1).max(100).optional().default(50),
    status: z.enum(["DRAFT", "PUBLISHED", "UNPUBLISHED", "ALL"]).optional().default("ALL")
  },
  async ({ page, limit, status }) => {
    const result = await api(`/api/admin/articles?page=${page}&limit=${limit}`);
    if (status !== "ALL") result.data = (result.data || []).filter((article) => article.status === status);
    return jsonResult(result);
  }
);

server.tool(
  "get_article",
  "Get an article from the admin list by exact article UUID or slug. Searches up to 100 recent admin records.",
  { id_or_slug: z.string().min(1).max(180) },
  async ({ id_or_slug }) => {
    const result = await api("/api/admin/articles?page=1&limit=100");
    const article = (result.data || []).find((item) => item.id === id_or_slug || item.slug === id_or_slug);
    if (!article) throw new Error("Article not found in the latest 100 admin records.");
    return jsonResult({ data: article });
  }
);

server.tool(
  "check_duplicates",
  "Check recent BazaarNexa article titles for exact or similar matches before drafting. This is a simple title comparison, not a guarantee of semantic uniqueness.",
  { title: z.string().min(3).max(240) },
  async ({ title }) => {
    const result = await api("/api/admin/articles?page=1&limit=100");
    const normalize = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const target = normalize(title);
    const targetWords = new Set(target.split(/\s+/).filter((word) => word.length > 3));
    const matches = (result.data || []).map((article) => {
      const normalized = normalize(article.title);
      const words = normalized.split(/\s+/).filter((word) => word.length > 3);
      const overlap = words.filter((word) => targetWords.has(word)).length;
      const score = targetWords.size ? overlap / targetWords.size : 0;
      return { article, score, exact: normalized === target };
    }).filter((item) => item.exact || item.score >= 0.6)
      .sort((a, b) => Number(b.exact) - Number(a.exact) || b.score - a.score)
      .slice(0, 10);
    return jsonResult({ query: title, matches });
  }
);

server.tool(
  "save_draft",
  "Create a new BazaarNexa article as DRAFT only. Never publishes. Research and verify claims before calling; include original source URL and publisher when available.",
  {
    title: z.string().min(5).max(240),
    content: z.string().min(80).max(50000),
    category_id: z.string().uuid(),
    source_url: z.string().url().optional(),
    source_name: z.string().max(200).optional(),
    image_url: z.string().url().optional(),
    access_type: z.enum(["FREE", "PREMIUM"]).optional().default("FREE")
  },
  async ({ title, content, category_id, source_url, source_name, image_url, access_type }) => {
    const result = await api("/api/admin/articles", {
      method: "POST",
      body: JSON.stringify({
        title, content, category_id, source_url: source_url || null,
        source_name: source_name || null, image_url: image_url || null,
        access_type, status: "DRAFT"
      })
    });
    return jsonResult({ message: "Draft saved. It has NOT been published.", ...result });
  }
);

server.tool(
  "update_draft",
  "Edit an existing DRAFT only. Refuses to modify published or unpublished articles. This tool cannot publish.",
  {
    id: z.string().uuid(),
    title: z.string().min(5).max(240).optional(),
    content: z.string().min(80).max(50000).optional(),
    category_id: z.string().uuid().optional(),
    source_url: z.string().url().nullable().optional(),
    source_name: z.string().max(200).nullable().optional(),
    image_url: z.string().url().nullable().optional(),
    access_type: z.enum(["FREE", "PREMIUM"]).optional()
  },
  async ({ id, ...changes }) => {
    const list = await api("/api/admin/articles?page=1&limit=100");
    const existing = (list.data || []).find((article) => article.id === id);
    if (!existing) throw new Error("Article not found in the latest 100 admin records.");
    if (existing.status !== "DRAFT") throw new Error("Only DRAFT articles can be edited through this MCP tool.");
    const patch = Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined));
    if (!Object.keys(patch).length) throw new Error("Provide at least one field to update.");
    const result = await api(`/api/admin/articles/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch)
    });
    return jsonResult({ message: "Draft updated. It remains unpublished.", ...result });
  }
);

async function main() {
  await ensureToken();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("BazaarNexa local MCP connected. Draft-only mode enabled.");
}

main().catch((error) => {
  console.error("BazaarNexa MCP failed to start:", error?.message || error);
  process.exit(1);
});

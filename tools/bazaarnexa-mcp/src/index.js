import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const apiBase = (process.env.BAZAARNEXA_API_URL || "https://news-api-egmd.onrender.com").replace(/\/$/, "");
const accessToken = process.env.BAZAARNEXA_ACCESS_TOKEN;

if (!accessToken) {
  console.error("Missing BAZAARNEXA_ACCESS_TOKEN. Set a Supabase user access token for an enabled BazaarNexa ADMIN account.");
  process.exit(1);
}

const server = new McpServer({ name: "bazaarnexa-local", version: "0.1.0" });

async function api(path, { method = "GET", body } = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20_000)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload.error === "string" ? payload.error : `API request failed with HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

function result(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

server.registerTool(
  "bazaarnexa_list_categories",
  {
    title: "List BazaarNexa categories",
    description: "Read available article categories from the existing authenticated BazaarNexa admin API.",
    inputSchema: {}
  },
  async () => result(await api("/api/admin/categories"))
);

server.registerTool(
  "bazaarnexa_list_articles",
  {
    title: "List BazaarNexa articles",
    description: "List articles through the existing admin API. Use this to find IDs and verify status before editing.",
    inputSchema: {
      page: z.number().int().min(1).max(10000).optional().describe("Page number (default 1)"),
      limit: z.number().int().min(1).max(100).optional().describe("Page size (default 20)")
    }
  },
  async ({ page = 1, limit = 20 }) => result(await api(`/api/admin/articles?page=${page}&limit=${limit}`))
);

server.registerTool(
  "bazaarnexa_create_draft",
  {
    title: "Create BazaarNexa draft",
    description: "Create a DRAFT article only. This tool never publishes articles and does not accept a status field. Get category_id from bazaarnexa_list_categories.",
    inputSchema: {
      title: z.string().trim().min(1).max(240),
      content: z.string().trim().min(1),
      category_id: z.string().uuid(),
      slug: z.string().trim().max(180).optional(),
      image_url: z.string().url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "image_url must use HTTP or HTTPS").nullable().optional(),
      access_type: z.enum(["FREE", "PREMIUM"]).default("FREE")
    }
  },
  async ({ title, content, category_id, slug, image_url, access_type }) => {
    const body = { title, content, category_id, access_type, status: "DRAFT" };
    if (slug) body.slug = slug;
    if (image_url !== undefined) body.image_url = image_url;
    return result(await api("/api/admin/articles", { method: "POST", body }));
  }
);

server.registerTool(
  "bazaarnexa_update_draft",
  {
    title: "Update BazaarNexa draft",
    description: "Update editable fields on an existing DRAFT only. Published or unpublished articles are refused. Status, publish, delete, user/role, and schema mutation operations are not exposed.",
    inputSchema: {
      id: z.string().uuid(),
      title: z.string().trim().min(1).max(240).optional(),
      content: z.string().trim().min(1).optional(),
      category_id: z.string().uuid().optional(),
      slug: z.string().trim().max(180).optional(),
      image_url: z.string().url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "image_url must use HTTP or HTTPS").nullable().optional(),
      access_type: z.enum(["FREE", "PREMIUM"]).optional()
    }
  },
  async ({ id, ...changes }) => {
    let page = 1;
    let article;
    while (page <= 10000) {
      const current = await api("/api/admin/articles?page=" + page + "&limit=100");
      const articles = Array.isArray(current.data) ? current.data : [];
      article = articles.find((item) => item.id === id);
      if (article || !current.pagination?.hasNextPage) break;
      page += 1;
    }
    if (!article) throw new Error("Article not found in the admin article listing. Verify the ID in the admin panel and retry.");
    if (article.status !== "DRAFT") throw new Error("Draft-only safety rule: only articles with status DRAFT can be updated by this MCP tool.");
    const body = Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined));
    if (!Object.keys(body).length) throw new Error("Provide at least one field to update.");
    return result(await api(`/api/admin/articles/${encodeURIComponent(id)}`, { method: "PATCH", body }));
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);

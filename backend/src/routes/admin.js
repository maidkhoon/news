import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { requireAdmin } from "../middleware/require-admin.js";
import { sendArticlePush } from "../lib/push.js";

const router = Router();

router.use(requireAdmin);

const articleFields = "id,title,slug,image_url,content,access_type,status,published_at,category_id,created_by,created_at,updated_at,categories(name,slug)";

async function notifyPublished(article) {
  const categoryName = article.categories?.name || "Market Research";
  await supabase.from("notifications").insert({
    title: article.title,
    message: `New ${categoryName} research is available.`,
    article_id: article.id
  });
  await sendArticlePush({ ...article, category_name: categoryName });
}

function makeSlug(value) {
  return String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .trim()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 140);
}

function validateArticle(body, { partial = false } = {}) {
  const errors = [];
  const required = ["title", "content", "category_id"];

  if (!partial) {
    for (const field of required) {
      if (typeof body[field] !== "string" || !body[field].trim()) {
        errors.push(field);
      }
    }
  }

  if (body.title !== undefined && (typeof body.title !== "string" || !body.title.trim() || body.title.length > 240)) errors.push("title");
  if (body.content !== undefined && (typeof body.content !== "string" || !body.content.trim())) errors.push("content");
  if (body.category_id !== undefined && (typeof body.category_id !== "string" || !body.category_id.trim())) errors.push("category_id");
  if (body.image_url !== undefined && body.image_url !== null && typeof body.image_url !== "string") errors.push("image_url");
  if (body.access_type !== undefined && !["FREE", "PREMIUM"].includes(body.access_type)) errors.push("access_type");
  if (body.status !== undefined && !["DRAFT", "PUBLISHED", "UNPUBLISHED"].includes(body.status)) errors.push("status");

  return [...new Set(errors)];
}

router.get("/articles", async (req, res) => {
  const page = Math.max(Number.parseInt(req.query.page || "1", 10) || 1, 1);
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit || "20", 10) || 20, 1), 100);
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const { data, error, count } = await supabase
    .from("articles")
    .select(articleFields, { count: "exact" })
    .order("updated_at", { ascending: false })
    .range(from, to);

  if (error) {
    console.error("Admin articles list failed:", error.message);
    return res.status(500).json({ error: "Unable to load admin articles" });
  }

  return res.json({
    data,
    pagination: { page, limit, total: count ?? 0, hasNextPage: (count ?? 0) > to + 1 }
  });
});

router.post("/articles", async (req, res) => {
  const errors = validateArticle(req.body || {});
  if (errors.length) {
    return res.status(400).json({ error: "Invalid article fields", fields: errors });
  }

  const title = req.body.title.trim();
  const slug = makeSlug(req.body.slug || title);
  if (!slug) return res.status(400).json({ error: "A valid title or slug is required" });

  const status = req.body.status || "DRAFT";
  const payload = {
    title,
    slug,
    content: req.body.content.trim(),
    category_id: req.body.category_id,
    created_by: req.user.id,
    image_url: req.body.image_url || null,
    access_type: req.body.access_type || "FREE",
    status,
    published_at: status === "PUBLISHED" ? new Date().toISOString() : null
  };

  const { data, error } = await supabase
    .from("articles")
    .insert(payload)
    .select(articleFields)
    .single();

  if (error) {
    if (error.code === "23505") return res.status(409).json({ error: "An article with this slug already exists" });
    if (error.code === "23503") return res.status(400).json({ error: "Category or admin profile was not found" });
    console.error("Admin article create failed:", error.message);
    return res.status(500).json({ error: "Unable to create article" });
  }

  if (status === "PUBLISHED") await notifyPublished(data);

  return res.status(201).json({ data });
});

router.patch("/articles/:id", async (req, res) => {
  const body = req.body || {};
  const errors = validateArticle(body, { partial: true });
  if (errors.length) return res.status(400).json({ error: "Invalid article fields", fields: errors });

  const allowed = ["title", "slug", "image_url", "content", "access_type", "status", "category_id"];
  const payload = {};

  for (const field of allowed) {
    if (body[field] !== undefined) payload[field] = body[field];
  }

  if (payload.title !== undefined) payload.title = payload.title.trim();
  if (payload.content !== undefined) payload.content = payload.content.trim();
  if (payload.slug !== undefined || payload.title !== undefined) {
    payload.slug = makeSlug(payload.slug || payload.title);
    if (!payload.slug) return res.status(400).json({ error: "A valid title or slug is required" });
  }

  if (payload.status === "PUBLISHED") payload.published_at = new Date().toISOString();
  if (payload.status && payload.status !== "PUBLISHED") payload.published_at = null;
  payload.updated_at = new Date().toISOString();

  if (!Object.keys(payload).length) return res.status(400).json({ error: "No editable fields supplied" });

  const { data, error } = await supabase
    .from("articles")
    .update(payload)
    .eq("id", req.params.id)
    .select(articleFields)
    .maybeSingle();

  if (error) {
    if (error.code === "23505") return res.status(409).json({ error: "An article with this slug already exists" });
    if (error.code === "23503") return res.status(400).json({ error: "Category was not found" });
    console.error("Admin article update failed:", error.message);
    return res.status(500).json({ error: "Unable to update article" });
  }

  if (!data) return res.status(404).json({ error: "Article not found" });
  if (body.status === "PUBLISHED") await notifyPublished(data);
  return res.json({ data });
});

router.delete("/articles/:id", async (req, res) => {
  const { data, error } = await supabase
    .from("articles")
    .delete()
    .eq("id", req.params.id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Admin article delete failed:", error.message);
    return res.status(500).json({ error: "Unable to delete article" });
  }

  if (!data) return res.status(404).json({ error: "Article not found" });
  return res.json({ ok: true, id: data.id });
});

export default router;

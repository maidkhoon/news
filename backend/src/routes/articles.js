import { Router } from "express";
import { supabase } from "../lib/supabase.js";

const router = Router();

router.get("/", async (req, res) => {
  const page = Math.max(Number.parseInt(req.query.page || "1", 10), 1);
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit || "10", 10), 1), 50);
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabase
    .from("articles")
    .select("id,title,slug,image_url,access_type,status,published_at,category_id,categories(name,slug)", { count: "exact" })
    .eq("status", "PUBLISHED")
    .order("published_at", { ascending: false })
    .range(from, to);

  if (req.query.category) {
    query = query.eq("categories.slug", String(req.query.category));
  }

  if (req.query.search) {
    query = query.ilike("title", `%${String(req.query.search).replace(/[%_]/g, "")}%`);
  }

  const { data, error, count } = await query;

  if (error) {
    return res.status(500).json({ error: "Unable to load articles" });
  }

  return res.json({
    data,
    pagination: {
      page,
      limit,
      total: count ?? 0,
      hasNextPage: (count ?? 0) > to + 1
    }
  });
});

router.get("/:slug", async (req, res) => {
  const { data, error } = await supabase
    .from("articles")
    .select("id,title,slug,image_url,content,access_type,status,published_at,category_id,categories(name,slug)")
    .eq("slug", req.params.slug)
    .eq("status", "PUBLISHED")
    .single();

  if (error || !data) {
    return res.status(404).json({ error: "Article not found" });
  }

  if (data.access_type === "PREMIUM") {
    return res.status(403).json({
      error: "PREMIUM_REQUIRED",
      message: "An active subscription is required."
    });
  }

  return res.json({ data });
});

export default router;

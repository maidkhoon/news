import { Router } from "express";
import { supabase } from "../lib/supabase.js";

const router = Router();

async function currentUser(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  return error ? null : data.user || null;
}

async function hasActiveSubscription(userId) {
  const { data, error } = await supabase.from("subscriptions")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "ACTIVE")
    .gt("expiry_date", new Date().toISOString())
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("Subscription access check failed:", error.message);
    return false;
  }
  return Boolean(data);
}

router.get("/", async (req, res) => {
  const parsedPage = Number.parseInt(req.query.page || "1", 10);
  const parsedLimit = Number.parseInt(req.query.limit || "10", 10);
  const page = Math.max(Number.isFinite(parsedPage) ? parsedPage : 1, 1);
  const limit = Math.min(Math.max(Number.isFinite(parsedLimit) ? parsedLimit : 10, 1), 50);
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const categoryFilter = req.query.category ? String(req.query.category) : "";
  const categoryRelation = categoryFilter ? "categories!inner(name,slug)" : "categories(name,slug)";
  let query = supabase
    .from("articles")
    .select(`id,title,slug,image_url,access_type,status,published_at,category_id,${categoryRelation}`, { count: "exact" })
    .eq("status", "PUBLISHED")
    .order("published_at", { ascending: false })
    .range(from, to);

  if (categoryFilter) query = query.eq("categories.slug", categoryFilter);
  if (req.query.search) query = query.ilike("title", `%${String(req.query.search).replace(/[%_]/g, "")}%`);

  const { data, error, count } = await query;
  if (error) {
    console.error("Public articles query failed:", error.message);
    return res.status(500).json({ error: "Unable to load articles" });
  }

  return res.json({
    data: data || [],
    pagination: { page, limit, total: count ?? 0, hasNextPage: (count ?? 0) > to + 1 }
  });
});

router.get("/:slug", async (req, res) => {
  const { data, error } = await supabase
    .from("articles")
    .select("id,title,slug,image_url,content,access_type,status,published_at,category_id,categories(name,slug)")
    .eq("slug", req.params.slug)
    .eq("status", "PUBLISHED")
    .maybeSingle();

  if (error || !data) return res.status(404).json({ error: "Article not found" });

  if (data.access_type === "PREMIUM") {
    const user = await currentUser(req);
    if (!user || !(await hasActiveSubscription(user.id))) {
      return res.status(403).json({
        error: "PREMIUM_REQUIRED",
        message: "An active subscription is required."
      });
    }
  }

  return res.json({ data });
});

export default router;

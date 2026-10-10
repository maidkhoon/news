import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { requireAdmin } from "../middleware/require-admin.js";

const router = Router();
router.use(requireAdmin);

function makeSlug(value) {
  return String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .trim()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

router.get("/", async (_req, res) => {
  const { data, error } = await supabase
    .from("categories")
    .select("id,name,slug")
    .order("name");
  if (error) {
    console.error("Admin category list failed:", error.message);
    return res.status(500).json({ error: "Unable to load categories" });
  }
  return res.json({ data: data || [] });
});

router.post("/", async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const slug = makeSlug(req.body?.slug || name);
  if (!name || name.length > 80 || !slug) {
    return res.status(400).json({ error: "A category name (up to 80 characters) is required" });
  }

  const { data, error } = await supabase
    .from("categories")
    .insert({ name, slug })
    .select("id,name,slug,created_at,updated_at")
    .single();

  if (error) {
    if (error.code === "23505") return res.status(409).json({ error: "A category with this name or slug already exists" });
    console.error("Admin category create failed:", error.message);
    return res.status(500).json({ error: "Unable to create category" });
  }
  return res.status(201).json({ data });
});

router.patch("/:id", async (req, res) => {
  const payload = {};
  if (req.body?.name !== undefined) {
    if (typeof req.body.name !== "string" || !req.body.name.trim() || req.body.name.trim().length > 80) {
      return res.status(400).json({ error: "Category name must be between 1 and 80 characters" });
    }
    payload.name = req.body.name.trim();
  }
  if (req.body?.slug !== undefined || req.body?.name !== undefined) {
    const slug = makeSlug(req.body?.slug || payload.name);
    if (!slug) return res.status(400).json({ error: "A valid category slug is required" });
    payload.slug = slug;
  }
  const { data, error } = await supabase
    .from("categories")
    .update(payload)
    .eq("id", req.params.id)
    .select("id,name,slug,created_at,updated_at")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") return res.status(409).json({ error: "A category with this name or slug already exists" });
    console.error("Admin category update failed:", error.message);
    return res.status(500).json({ error: "Unable to update category" });
  }
  if (!data) return res.status(404).json({ error: "Category not found" });
  return res.json({ data });
});

router.delete("/:id", async (req, res) => {
  const { data, error } = await supabase
    .from("categories")
    .delete()
    .eq("id", req.params.id)
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.code === "23503") {
      return res.status(409).json({ error: "This category contains articles. Move or delete those articles before deleting the category." });
    }
    console.error("Admin category delete failed:", error.message);
    return res.status(500).json({ error: "Unable to delete category" });
  }
  if (!data) return res.status(404).json({ error: "Category not found" });
  return res.json({ ok: true, id: data.id });
});

export default router;

import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { requireUser } from "../middleware/require-user.js";

const router = Router();

router.use(requireUser);

router.get("/", async (req, res) => {
  const { data, error } = await supabase.from("notifications")
    .select("id,title,message,article_id,created_at,articles(slug)")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ error: "Unable to load notifications" });
  return res.json({ data: data || [] });
});

export default router;

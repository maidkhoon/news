import { Router } from "express";
import { supabase } from "../lib/supabase.js";

const router = Router();

async function requireUser(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Authentication required" });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ error: "Invalid session" });
  req.authUser = data.user;
  next();
}

router.use(requireUser);

router.get("/", async (req, res) => {
  const { data, error } = await supabase.from("notifications")
    .select("id,title,message,article_id,created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ error: "Unable to load notifications" });
  return res.json({ data: data || [] });
});

export default router;

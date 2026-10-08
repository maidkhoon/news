import { Router } from "express";
import { supabase } from "../lib/supabase.js";

const router = Router();

router.get("/", async (_req, res) => {
  const { data, error } = await supabase
    .from("categories")
    .select("id,name,slug")
    .order("name");

  if (error) {
    return res.status(500).json({ error: "Unable to load categories" });
  }

  return res.json({ data });
});

export default router;

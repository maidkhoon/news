import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { requireUser } from "../middleware/require-user.js";

const router = Router();

router.use(requireUser);

router.patch("/me", async (req, res) => {
  const user = req.authUser;
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (name.length < 2 || name.length > 80) {
    return res.status(400).json({ error: "Name must be between 2 and 80 characters." });
  }
  const { data, error } = await supabase.from("profiles")
    .upsert({
      id: user.id, name, phone: user.phone || null, email: user.email || null,
      updated_at: new Date().toISOString()
    }, { onConflict: "id" })
    .select("id,name,phone,email,role,status")
    .single();
  if (error) {
    console.error("Profile update failed:", error.message);
    return res.status(500).json({ error: "Unable to update profile." });
  }
  if (!data.status) return res.status(403).json({ error: "Account disabled." });
  return res.json({ data });
});

router.get("/me", async (req, res) => {
  const user = req.authUser;
  const { data: existing, error: lookupError } = await supabase.from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();
  if (lookupError) return res.status(500).json({ error: "Unable to load profile" });

  const profilePayload = {
    id: user.id,
    phone: user.phone || null,
    email: user.email || null,
    updated_at: new Date().toISOString()
  };
  const operation = existing
    ? supabase.from("profiles").update({ phone: profilePayload.phone, email: profilePayload.email, updated_at: profilePayload.updated_at }).eq("id", user.id)
    : supabase.from("profiles").insert(profilePayload);
  const { data, error } = await operation.select("id,name,phone,email,role,status").single();

  if (error) {
    console.error("Profile bootstrap failed:", error.message);
    return res.status(500).json({ error: "Unable to load profile" });
  }
  if (!data.status) return res.status(403).json({ error: "Account disabled" });
  return res.json({ data });
});

export default router;

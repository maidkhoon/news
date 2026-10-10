import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { requireUser } from "../middleware/require-user.js";

const router = Router();

router.use(requireUser);

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

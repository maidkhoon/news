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
  const profilePayload = {
    phone: user.phone || null,
    email: user.email || null,
    updated_at: new Date().toISOString()
  };

  let { data, error } = await supabase.from("profiles")
    .update(profilePayload)
    .eq("id", user.id)
    .select("id,name,phone,email,role,status")
    .maybeSingle();
  if (error) {
    console.error("Profile bootstrap failed:", error.message);
    return res.status(500).json({ error: "Unable to load profile" });
  }

  if (!data) {
    const inserted = await supabase.from("profiles")
      .insert({ id: user.id, ...profilePayload })
      .select("id,name,phone,email,role,status")
      .single();
    if (inserted.error?.code === "23505") {
      // A concurrent request (e.g. a simultaneous device-register call)
      // created the row first; read what they wrote instead of erroring.
      const retried = await supabase.from("profiles").select("id,name,phone,email,role,status").eq("id", user.id).single();
      if (retried.error) {
        console.error("Profile bootstrap failed:", retried.error.message);
        return res.status(500).json({ error: "Unable to load profile" });
      }
      data = retried.data;
    } else if (inserted.error) {
      console.error("Profile bootstrap failed:", inserted.error.message);
      return res.status(500).json({ error: "Unable to load profile" });
    } else {
      data = inserted.data;
    }
  }

  if (!data.status) return res.status(403).json({ error: "Account disabled" });
  return res.json({ data });
});

export default router;

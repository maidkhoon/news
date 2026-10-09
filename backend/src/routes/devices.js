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

router.post("/register", async (req, res) => {
  const { token, platform } = req.body || {};
  if (typeof token !== "string" || !/^Expo(PushToken|PushToken\[)[^\s]+/.test(token)) {
    return res.status(400).json({ error: "A valid Expo push token is required" });
  }
  if (!["android", "ios"].includes(platform)) {
    return res.status(400).json({ error: "platform must be android or ios" });
  }

  const user = req.authUser;
  const { data: profile, error: profileLookupError } = await supabase.from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();
  if (profileLookupError) return res.status(500).json({ error: "Unable to register device" });
  if (!profile) {
    const { error: profileInsertError } = await supabase.from("profiles").insert({
      id: user.id,
      phone: user.phone || null,
      email: user.email || null
    });
    if (profileInsertError) {
      console.error("Device profile bootstrap failed:", profileInsertError.message);
      return res.status(500).json({ error: "Unable to register device" });
    }
  }

  const { data, error } = await supabase.from("devices").upsert({
    user_id: user.id,
    fcm_token: token,
    platform,
    updated_at: new Date().toISOString()
  }, { onConflict: "fcm_token" }).select("id,platform,updated_at").single();

  if (error) {
    console.error("Device registration failed:", error.message);
    return res.status(500).json({ error: "Unable to register notifications" });
  }
  return res.status(200).json({ data });
});

router.delete("/register", async (req, res) => {
  const { token } = req.body || {};
  if (typeof token !== "string" || !token) return res.status(400).json({ error: "token is required" });
  const { error } = await supabase.from("devices").delete()
    .eq("user_id", req.authUser.id).eq("fcm_token", token);
  if (error) return res.status(500).json({ error: "Unable to unregister device" });
  return res.json({ ok: true });
});

export default router;

import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { requireUser } from "../middleware/require-user.js";
import { ensureProfile } from "../lib/profiles.js";

const router = Router();

router.use(requireUser);

router.post("/register", async (req, res) => {
  const { token, platform } = req.body || {};
  if (typeof token !== "string" || !/^(Expo|Exponent)PushToken\[[^\]]+\]$/.test(token)) {
    return res.status(400).json({ error: "A valid Expo push token is required" });
  }
  if (!["android", "ios"].includes(platform)) {
    return res.status(400).json({ error: "platform must be android or ios" });
  }

  const user = req.authUser;
  try {
    await ensureProfile(user);
  } catch (error) {
    console.error("Device profile bootstrap failed:", error.message);
    return res.status(500).json({ error: "Unable to register device" });
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

import { Router } from "express";
import { randomBytes } from "node:crypto";
import { supabase } from "../lib/supabase.js";
import { requireUser } from "../middleware/require-user.js";
import { ensureProfile } from "../lib/profiles.js";

const router = Router();
router.use(requireUser);

function newReferralCode() {
  return randomBytes(5).toString("hex").toUpperCase();
}

router.get("/me", async (req, res) => {
  try {
    await ensureProfile(req.authUser);
    const userId = req.authUser.id;
    let { data: profile, error } = await supabase.from("profiles")
      .select("id,referral_code")
      .eq("id", userId)
      .single();
    if (error) throw error;

    if (!profile.referral_code) {
      // Unique constraint handles collisions; retry a small bounded number of times.
      for (let attempt = 0; attempt < 3 && !profile.referral_code; attempt += 1) {
        const code = newReferralCode();
        const result = await supabase.from("profiles")
          .update({ referral_code: code, updated_at: new Date().toISOString() })
          .eq("id", userId)
          .is("referral_code", null)
          .select("id,referral_code")
          .maybeSingle();
        if (result.error && result.error.code !== "23505") throw result.error;
        if (result.data?.referral_code) profile = result.data;
        if (!profile.referral_code) {
          const refreshed = await supabase.from("profiles").select("id,referral_code").eq("id", userId).single();
          if (refreshed.error) throw refreshed.error;
          profile = refreshed.data;
        }
      }
    }

    const { data: referrals, error: referralError } = await supabase.from("referrals")
      .select("id,status,reward_days,created_at,rewarded_at,paid_subscription_at")
      .eq("referrer_user_id", userId)
      .order("created_at", { ascending: false });
    if (referralError) throw referralError;

    const { data: attribution, error: attributionError } = await supabase.from("referrals")
      .select("status,reward_days,rewarded_at")
      .eq("referred_user_id", userId)
      .maybeSingle();
    if (attributionError) throw attributionError;

    return res.json({
      data: {
        code: profile.referral_code,
        link: `https://bazaarnexa.com/?ref=${encodeURIComponent(profile.referral_code || "")}`,
        rewardDays: Number(process.env.REFERRAL_REWARD_DAYS || 7),
        referrals: referrals || [],
        successful: (referrals || []).filter((item) => item.status === "rewarded").length,
        pending: (referrals || []).filter((item) => item.status === "pending").length,
        appliedReferral: attribution || null
      }
    });
  } catch (error) {
    console.error("Referral summary failed:", error instanceof Error ? error.message : error);
    return res.status(500).json({ error: "Unable to load referral information" });
  }
});

router.post("/claim", async (req, res) => {
  const code = typeof req.body?.code === "string" ? req.body.code.trim().toUpperCase() : "";
  if (!/^[A-F0-9]{10}$/.test(code)) {
    return res.status(400).json({ error: "Enter a valid referral code." });
  }

  try {
    await ensureProfile(req.authUser);
    const userId = req.authUser.id;
    const { data: existing, error: existingError } = await supabase.from("referrals")
      .select("id,status")
      .eq("referred_user_id", userId)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) return res.status(409).json({ error: "A referral code has already been applied to this account." });

    const { data: ownProfile, error: ownError } = await supabase.from("profiles")
      .select("id,referral_code")
      .eq("id", userId)
      .single();
    if (ownError) throw ownError;
    if (ownProfile.referral_code === code) return res.status(400).json({ error: "You cannot use your own referral code." });

    const { data: referrer, error: referrerError } = await supabase.from("profiles")
      .select("id")
      .eq("referral_code", code)
      .maybeSingle();
    if (referrerError) throw referrerError;
    if (!referrer) return res.status(404).json({ error: "Referral code not found." });
    if (referrer.id === userId) return res.status(400).json({ error: "You cannot refer yourself." });

    const { data: paid, error: paidError } = await supabase.from("subscriptions")
      .select("id")
      .eq("user_id", userId)
      .eq("provider", "google_play")
      .eq("status", "ACTIVE")
      .limit(1)
      .maybeSingle();
    if (paidError) throw paidError;
    if (paid) return res.status(409).json({ error: "Referral codes must be applied before the first paid subscription." });

    const { error: insertError } = await supabase.from("referrals").insert({
      referrer_user_id: referrer.id,
      referred_user_id: userId,
      status: "pending",
      reward_days: Number(process.env.REFERRAL_REWARD_DAYS || 7)
    });
    if (insertError?.code === "23505") return res.status(409).json({ error: "This account already has a referral applied." });
    if (insertError) throw insertError;
    return res.status(201).json({ ok: true, message: "Referral code applied. Your inviter earns premium days after your first paid subscription." });
  } catch (error) {
    console.error("Referral claim failed:", error instanceof Error ? error.message : error);
    return res.status(500).json({ error: "Unable to apply referral code" });
  }
});

export default router;

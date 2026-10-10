import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { requireAdmin } from "../middleware/require-admin.js";

const router = Router();
router.use(requireAdmin);

const PLAN_TYPES = new Set(["BASIC_MONTHLY", "BASIC_YEARLY", "PRO_MONTHLY", "PRO_YEARLY"]);

router.get("/users", async (req, res) => {
  const search = String(req.query.search || "").trim().slice(0, 120);
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id,name,email,phone,role,status,created_at,updated_at")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) {
    console.error("Admin user list failed:", error.message);
    return res.status(500).json({ error: "Unable to load users" });
  }
  const filtered = (profiles || []).filter((user) => {
    if (!search) return true;
    return [user.name, user.email, user.phone].some((value) => String(value || "").toLowerCase().includes(search.toLowerCase()));
  });
  const ids = filtered.map((user) => user.id);
  let subscriptions = [];
  if (ids.length) {
    const result = await supabase.from("subscriptions")
      .select("id,user_id,plan_type,status,start_date,expiry_date,auto_renewing,provider,created_at")
      .in("user_id", ids)
      .order("expiry_date", { ascending: false });
    if (result.error) {
      console.error("Admin subscriptions lookup failed:", result.error.message);
      return res.status(500).json({ error: "Unable to load subscription plans" });
    }
    subscriptions = result.data || [];
  }
  const now = Date.now();
  const latestByUser = new Map();
  for (const sub of subscriptions) {
    const active = sub.status === "ACTIVE" && sub.expiry_date && new Date(sub.expiry_date).getTime() > now;
    const previous = latestByUser.get(sub.user_id);
    if (active || !previous) latestByUser.set(sub.user_id, { ...sub, active: Boolean(active) });
  }
  return res.json({ data: filtered.map((user) => ({ ...user, subscription: latestByUser.get(user.id) || null })) });
});

router.get("/users/:id", async (req, res) => {
  const { data: profile, error } = await supabase.from("profiles")
    .select("id,name,email,phone,role,status,created_at,updated_at")
    .eq("id", req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: "Unable to load user profile" });
  if (!profile) return res.status(404).json({ error: "User not found" });
  const { data: subscriptions, error: subscriptionError } = await supabase.from("subscriptions")
    .select("id,plan_type,status,start_date,expiry_date,auto_renewing,provider,created_at")
    .eq("user_id", profile.id).order("created_at", { ascending: false }).limit(50);
  if (subscriptionError) return res.status(500).json({ error: "Unable to load subscription history" });
  return res.json({ data: { ...profile, subscriptions: subscriptions || [] } });
});

router.patch("/users/:id", async (req, res) => {
  const updates = {};
  if (req.body?.status !== undefined) {
    if (typeof req.body.status !== "boolean") return res.status(400).json({ error: "Status must be true or false" });
    if (req.params.id === req.authUser.id && req.body.status === false) {
      return res.status(400).json({ error: "You cannot disable your own admin account" });
    }
    updates.status = req.body.status;
  }
  if (req.body?.name !== undefined) {
    if (typeof req.body.name !== "string" || req.body.name.trim().length > 120) {
      return res.status(400).json({ error: "Name must be 120 characters or fewer" });
    }
    updates.name = req.body.name.trim() || null;
  }
  if (!Object.keys(updates).length) return res.status(400).json({ error: "No valid fields supplied" });
  updates.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from("profiles").update(updates)
    .eq("id", req.params.id)
    .select("id,name,email,phone,role,status,created_at,updated_at").maybeSingle();
  if (error) {
    console.error("Admin user update failed:", error.message);
    return res.status(500).json({ error: "Unable to update user" });
  }
  if (!data) return res.status(404).json({ error: "User not found" });
  return res.json({ data });
});

router.post("/users/:id/plan", async (req, res) => {
  const planType = String(req.body?.plan_type || "").toUpperCase();
  const expiryDate = req.body?.expiry_date;
  if (!PLAN_TYPES.has(planType)) return res.status(400).json({ error: "Choose a supported paid plan" });
  const expiry = new Date(expiryDate);
  if (!expiryDate || Number.isNaN(expiry.getTime()) || expiry <= new Date()) {
    return res.status(400).json({ error: "Expiry date must be in the future" });
  }
  const { data: profile, error: profileError } = await supabase.from("profiles")
    .select("id").eq("id", req.params.id).maybeSingle();
  if (profileError) return res.status(500).json({ error: "Unable to verify user" });
  if (!profile) return res.status(404).json({ error: "User not found" });

  const now = new Date().toISOString();
  const { error: expireError } = await supabase.from("subscriptions")
    .update({ status: "EXPIRED", updated_at: now })
    .eq("user_id", req.params.id).eq("status", "ACTIVE");
  if (expireError) {
    console.error("Previous plan update failed:", expireError.message);
    return res.status(500).json({ error: "Unable to replace existing plan" });
  }

  const { data, error } = await supabase.from("subscriptions").insert({
    user_id: req.params.id,
    plan_type: planType,
    provider: "admin_manual",
    status: "ACTIVE",
    start_date: now,
    expiry_date: expiry.toISOString(),
    auto_renewing: false,
    updated_at: now
  }).select("id,user_id,plan_type,status,start_date,expiry_date,auto_renewing,provider,created_at").single();
  if (error) {
    console.error("Manual plan assignment failed:", error.message);
    return res.status(500).json({ error: "Unable to assign plan" });
  }
  return res.status(201).json({ data, note: "Manual entitlement applied; this does not change or charge a Google Play purchase." });
});

router.post("/users/:id/free-plan", async (req, res) => {
  const { data: profile, error: profileError } = await supabase.from("profiles")
    .select("id").eq("id", req.params.id).maybeSingle();
  if (profileError) return res.status(500).json({ error: "Unable to verify user" });
  if (!profile) return res.status(404).json({ error: "User not found" });
  const { error } = await supabase.from("subscriptions")
    .update({ status: "EXPIRED", updated_at: new Date().toISOString() })
    .eq("user_id", req.params.id).eq("status", "ACTIVE");
  if (error) return res.status(500).json({ error: "Unable to remove active plan" });
  return res.json({ ok: true, plan_type: "FREE" });
});

export default router;

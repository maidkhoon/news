import { Router } from "express";
import { google } from "googleapis";
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

async function ensureProfile(user) {
  const { data: profile, error: lookupError } = await supabase.from("profiles")
    .select("id").eq("id", user.id).maybeSingle();
  if (lookupError) throw lookupError;
  if (profile) {
    const { error } = await supabase.from("profiles").update({
      phone: user.phone || null,
      email: user.email || null,
      updated_at: new Date().toISOString()
    }).eq("id", user.id);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from("profiles").insert({
    id: user.id,
    phone: user.phone || null,
    email: user.email || null
  });
  if (error) throw error;
}

router.use(requireUser);

router.get("/me", async (req, res) => {
  try {
    await ensureProfile(req.authUser);
    const { data, error } = await supabase.from("subscriptions")
      .select("id,plan_type,product_id,status,start_date,expiry_date,auto_renewing,provider")
      .eq("user_id", req.authUser.id)
      .eq("status", "ACTIVE")
      .gt("expiry_date", new Date().toISOString())
      .order("expiry_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return res.json({ data: data || null, active: Boolean(data) });
  } catch (error) {
    console.error("Subscription lookup failed:", error instanceof Error ? error.message : error);
    return res.status(500).json({ error: "Unable to load subscription status" });
  }
});

// This endpoint trusts only Google Play Developer API verification, never a client-supplied
// expiry date or "paid" flag. Configure the package/product IDs and service account in Render.
router.post("/verify-google-play", async (req, res) => {
  const { productId, purchaseToken, planType } = req.body || {};
  if (typeof productId !== "string" || typeof purchaseToken !== "string" || !purchaseToken.trim()) {
    return res.status(400).json({ error: "productId and purchaseToken are required" });
  }
  const packageName = process.env.GOOGLE_PLAY_PACKAGE_NAME;
  const credentialsJson = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  const allowedProducts = [
    process.env.GOOGLE_PLAY_BASIC_MONTHLY_PRODUCT_ID,
    process.env.GOOGLE_PLAY_BASIC_YEARLY_PRODUCT_ID,
    process.env.GOOGLE_PLAY_PRO_MONTHLY_PRODUCT_ID,
    process.env.GOOGLE_PLAY_PRO_YEARLY_PRODUCT_ID
  ].filter(Boolean);

  if (!packageName || !credentialsJson || !allowedProducts.length) {
    return res.status(503).json({
      error: "PLAY_BILLING_NOT_CONFIGURED",
      message: "Google Play billing verification is not configured on the server yet."
    });
  }
  if (!allowedProducts.includes(productId)) {
    return res.status(400).json({ error: "Unknown subscription product" });
  }

  try {
    const credentials = JSON.parse(credentialsJson);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/androidpublisher"]
    });
    const publisher = google.androidpublisher({ version: "v3", auth });
    const { data: purchase } = await publisher.purchases.subscriptionsv2.get({
      packageName,
      token: purchaseToken
    });

    const activeStates = new Set(["SUBSCRIPTION_STATE_ACTIVE", "SUBSCRIPTION_STATE_IN_GRACE_PERIOD", "SUBSCRIPTION_STATE_CANCELED"]);
    if (!activeStates.has(purchase.subscriptionState || "")) {
      return res.status(402).json({ error: "SUBSCRIPTION_NOT_ACTIVE", state: purchase.subscriptionState || "UNKNOWN" });
    }

    const lineItem = (purchase.lineItems || []).find(item => item.productId === productId);
    if (!lineItem?.expiryTime) {
      return res.status(400).json({ error: "Purchase does not include the selected product" });
    }
    const expiry = new Date(lineItem.expiryTime);
    if (Number.isNaN(expiry.getTime()) || expiry <= new Date()) {
      return res.status(402).json({ error: "SUBSCRIPTION_EXPIRED" });
    }

    if (purchase.acknowledgementState !== "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED") {
      await publisher.purchases.subscriptions.acknowledge({
        packageName,
        subscriptionId: productId,
        token: purchaseToken,
        requestBody: {}
      });
    }

    const { data: existingPurchase, error: existingPurchaseError } = await supabase.from("subscriptions")
      .select("user_id")
      .eq("purchase_token", purchaseToken)
      .maybeSingle();
    if (existingPurchaseError) throw existingPurchaseError;
    if (existingPurchase && existingPurchase.user_id !== req.authUser.id) {
      return res.status(409).json({ error: "PURCHASE_ALREADY_LINKED", message: "This Google Play purchase is already linked to another account." });
    }

    await ensureProfile(req.authUser);
    const start = purchase.startTime ? new Date(purchase.startTime).toISOString() : new Date().toISOString();
    const autoRenewing = Boolean(lineItem.autoRenewingPlan?.autoRenewEnabled);
    const { data, error } = await supabase.from("subscriptions").upsert({
      user_id: req.authUser.id,
      plan_type: typeof planType === "string" ? planType.slice(0, 40) : productId,
      product_id: productId,
      purchase_token: purchaseToken,
      provider: "google_play",
      status: "ACTIVE",
      start_date: start,
      expiry_date: expiry.toISOString(),
      auto_renewing: autoRenewing,
      updated_at: new Date().toISOString()
    }, { onConflict: "purchase_token" })
      .select("id,plan_type,product_id,status,start_date,expiry_date,auto_renewing")
      .single();

    if (error) throw error;
    return res.json({ data, active: true });
  } catch (error) {
    console.error("Google Play verification failed:", error instanceof Error ? error.message : error);
    return res.status(502).json({ error: "Unable to verify purchase with Google Play" });
  }
});

export default router;

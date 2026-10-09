import { supabase } from "../lib/supabase.js";

export async function requireAdmin(req, res, next) {
  const authorization = req.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const { data: authData, error: authError } = await supabase.auth.getUser(match[1]);

  if (authError || !authData?.user) {
    return res.status(401).json({ error: "Invalid or expired access token" });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id,role,status")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (profileError) {
    console.error("Admin profile lookup failed:", profileError.message);
    return res.status(500).json({ error: "Unable to verify admin permissions" });
  }

  if (!profile || profile.status !== true || profile.role !== "ADMIN") {
    return res.status(403).json({ error: "Admin access required" });
  }

  req.user = authData.user;
  req.adminProfile = profile;
  return next();
}

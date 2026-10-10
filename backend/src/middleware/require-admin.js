import { supabase } from "../lib/supabase.js";
import { requireUser } from "./require-user.js";

/**
 * Require a valid user token and an enabled ADMIN profile.
 * requireUser attaches the verified Supabase auth user to req.user/req.authUser.
 */
export async function requireAdmin(req, res, next) {
  await requireUser(req, res, async () => {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("id,role,status")
      .eq("id", req.authUser.id)
      .maybeSingle();

    if (error) {
      console.error("Admin profile lookup failed:", error.message);
      return res.status(500).json({ error: "Unable to verify admin permissions" });
    }

    if (!profile || profile.status !== true || profile.role !== "ADMIN") {
      return res.status(403).json({ error: "Admin access required" });
    }

    req.adminProfile = profile;
    return next();
  });
}

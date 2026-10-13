import { supabase } from "../lib/supabase.js";
import { requireUser } from "./require-user.js";

/**
 * Require a valid user token and an enabled ADMIN or MASTER_ADMIN profile.
 * Master-admin-only actions must additionally check req.adminProfile.role.
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

    if (!profile || profile.status !== true || !["ADMIN", "MASTER_ADMIN"].includes(profile.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    req.adminProfile = profile;
    return next();
  });
}

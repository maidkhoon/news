import { supabase } from "../lib/supabase.js";

/**
 * Validate a Supabase access token and attach the verified auth user.
 * Both req.authUser and req.user are populated for backwards compatibility.
 */
export async function requireUser(req, res, next) {
  const authorization = req.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const { data, error } = await supabase.auth.getUser(match[1].trim());
  if (error || !data?.user) {
    return res.status(401).json({ error: "Invalid or expired access token" });
  }

  req.authUser = data.user;
  req.user = data.user;
  return next();
}

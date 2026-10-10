import { getAuthenticatedUser, getBearerToken } from "../lib/auth.js";

/**
 * Validate a Supabase access token and attach the verified auth user.
 * Both req.authUser and req.user are populated for backwards compatibility.
 */
export async function requireUser(req, res, next) {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const user = await getAuthenticatedUser(token);
  if (!user) {
    return res.status(401).json({ error: "Invalid or expired access token" });
  }

  req.authUser = user;
  req.user = user;
  return next();
}

import { supabase } from "./supabase.js";

// Subscriptions/devices rows have a foreign key to profiles(id), so any route
// that writes or reads those tables for a user must guarantee the profile
// row exists first. Mirrors the lookup-or-insert pattern already used in
// routes/devices.js and routes/users.js.
export async function ensureProfile(user) {
  const { data: existing, error: lookupError } = await supabase.from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) return existing;

  const { data: inserted, error: insertError } = await supabase.from("profiles")
    .insert({
      id: user.id,
      phone: user.phone || null,
      email: user.email || null
    })
    .select("id")
    .single();
  if (insertError) throw insertError;
  return inserted;
}

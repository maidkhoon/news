import crypto from "node:crypto";
import { supabase } from "./supabase.js";

const TTL_MS = 24 * 60 * 60 * 1000;

export function fingerprint(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * Wraps a non-repeatable write with an optional client-supplied Idempotency-Key.
 * - No key supplied: runs the handler as-is (no behavior change for existing clients).
 * - Same key + same payload: returns the previously stored result without re-running the handler.
 * - Same key + different payload: rejected with 409 IDEMPOTENCY_KEY_REUSE_MISMATCH.
 * - Same key, concurrent/in-flight: rejected with 409 REQUEST_IN_PROGRESS (safe to retry).
 * Handler must return { status, body }.
 */
export async function withIdempotency({ actorId, scope, key, payload, handler }) {
  if (!key) return handler();

  const requestFingerprint = fingerprint(payload);
  const { data: inserted, error: insertError } = await supabase
    .from("idempotency_keys")
    .insert({ actor_id: actorId, scope, idempotency_key: key, request_fingerprint: requestFingerprint })
    .select("id")
    .single();

  if (!insertError) {
    const result = await handler();
    await supabase
      .from("idempotency_keys")
      .update({ response_status: result.status, response_body: result.body, completed_at: new Date().toISOString() })
      .eq("id", inserted.id);
    return result;
  }

  if (insertError.code !== "23505") throw insertError;

  const { data: existing, error: fetchError } = await supabase
    .from("idempotency_keys")
    .select("id,request_fingerprint,response_status,response_body,created_at")
    .eq("actor_id", actorId)
    .eq("scope", scope)
    .eq("idempotency_key", key)
    .maybeSingle();
  if (fetchError) throw fetchError;
  if (!existing) throw new Error("Idempotency key lookup failed after insert conflict");

  const age = Date.now() - new Date(existing.created_at).getTime();
  if (age > TTL_MS) {
    // ponytail: lazy expiry (delete-then-retry) instead of a cleanup cron;
    // add a scheduled purge job if idempotency_keys volume becomes large.
    await supabase.from("idempotency_keys").delete().eq("id", existing.id);
    return withIdempotency({ actorId, scope, key, payload, handler });
  }

  if (existing.request_fingerprint !== requestFingerprint) {
    return {
      status: 409,
      body: { error: "IDEMPOTENCY_KEY_REUSE_MISMATCH", message: "This Idempotency-Key was already used with different request data." }
    };
  }

  if (existing.response_body === null) {
    return {
      status: 409,
      body: { error: "REQUEST_IN_PROGRESS", message: "An identical request is already being processed. Retry shortly." }
    };
  }

  return { status: existing.response_status, body: existing.response_body };
}

import crypto from "node:crypto";
import { supabase } from "./supabase.js";

const TTL_MS = 24 * 60 * 60 * 1000;
// Bounded lease: how long a claimed-but-not-yet-completed key is trusted to
// still be genuinely in-flight before another caller may reclaim it. Must
// comfortably exceed how long a real handler takes, but stay far below
// TTL_MS so a crashed request doesn't block retries for a day.
let CLAIM_TIMEOUT_MS = 30 * 1000;
// How often the original owner renews its lease while its handler is still
// running. Must be well under CLAIM_TIMEOUT_MS so renewals land before the
// lease would otherwise look abandoned.
let RENEW_INTERVAL_MS = 10 * 1000;
const PERSIST_RETRY_ATTEMPTS = 3;
const PERSIST_RETRY_DELAY_MS = 100;
const MAX_EXPIRY_RETRIES = 10;

// Test-only hook: production code never calls this. Lets tests use
// millisecond-scale timeouts instead of real 30s/10s waits.
export function __setIdempotencyTimingForTests(overrides = {}) {
  if (overrides.claimTimeoutMs !== undefined) CLAIM_TIMEOUT_MS = overrides.claimTimeoutMs;
  if (overrides.renewIntervalMs !== undefined) RENEW_INTERVAL_MS = overrides.renewIntervalMs;
}

export function fingerprint(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function renewLease(id, token) {
  const { error } = await supabase
    .from("idempotency_keys")
    .update({ claimed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("lease_token", token)
    .is("response_body", null);
  if (error) throw error;
}

// Persists the handler's result, conditioned on still holding `token`. If a
// reclaim stole the lease while the handler was running (only possible if
// our own renewals failed/lagged for the full CLAIM_TIMEOUT_MS), this
// matches zero rows rather than overwriting whatever the reclaimer wrote.
async function persistResult(id, token, result) {
  let lastError = null;
  for (let attempt = 0; attempt < PERSIST_RETRY_ATTEMPTS; attempt += 1) {
    const { data, error } = await supabase
      .from("idempotency_keys")
      .update({ response_status: result.status, response_body: result.body, completed_at: new Date().toISOString() })
      .eq("id", id)
      .eq("lease_token", token)
      .select("id")
      .maybeSingle();
    if (!error) return { fenced: !data, error: null };
    lastError = error;
    if (attempt < PERSIST_RETRY_ATTEMPTS - 1) await sleep(PERSIST_RETRY_DELAY_MS * (attempt + 1));
  }
  return { fenced: false, error: lastError };
}

// Runs the handler as the current lease owner (fresh claim or successful
// reclaim), renewing the lease periodically so a merely-slow handler is
// never mistaken for a crashed one.
async function ownAndRun(id, token, handler) {
  const heartbeat = setInterval(() => {
    renewLease(id, token).catch((error) => {
      console.error(`Idempotency lease renewal failed for id=${id}:`, error?.message || error);
    });
  }, RENEW_INTERVAL_MS);
  heartbeat.unref?.();

  try {
    const result = await handler();

    const { fenced, error: persistError } = await persistResult(id, token, result);
    if (persistError) {
      // We don't know whether our result was recorded. Throwing is the
      // honest answer for *this* request; it does not by itself guarantee
      // a later retry is duplicate-free - see docs/INDEXING_AND_IDEMPOTENCY.md
      // for the residual risk and why admin_article_create has a second,
      // independent safety net (the articles.slug unique constraint).
      console.error(`Idempotency result persist failed for id=${id} after ${PERSIST_RETRY_ATTEMPTS} attempts:`, persistError.message);
      throw persistError;
    }
    if (fenced) {
      // Someone else reclaimed this key before we finished (our renewals
      // must have failed or lagged past CLAIM_TIMEOUT_MS). The work we just
      // did is real and this request still gets its real result, but the
      // stored "canonical" response for this key belongs to the reclaimer.
      console.error(`Idempotency lease for id=${id} was reclaimed before this handler finished; result returned to caller but not recorded as canonical.`);
    }
    return result;
  } finally {
    clearInterval(heartbeat);
  }
}

/**
 * Wraps a non-repeatable write with an optional client-supplied Idempotency-Key.
 * - No key supplied: runs the handler as-is (no behavior change for existing clients).
 * - Same key + same payload, completed: returns the previously stored result without re-running the handler.
 * - Same key + different payload: rejected with 409 IDEMPOTENCY_KEY_REUSE_MISMATCH.
 * - Same key, lease renewed within CLAIM_TIMEOUT_MS: rejected with 409 REQUEST_IN_PROGRESS (safe to retry).
 * - Same key, lease stale (no renewal for CLAIM_TIMEOUT_MS, presumed crashed): one caller atomically
 *   reclaims the lease (compare-and-swap on lease_token) and runs the handler; everyone else who
 *   loses the race gets 409 REQUEST_IN_PROGRESS, never a duplicate run.
 *
 * This is best-effort, not a guarantee of exactly-once execution: if the
 * owning process can reach whatever the handler talks to but cannot reach
 * idempotency_keys for the full lease window, its renewals and its final
 * persist will fail/fence while the handler itself still completes, which
 * can lead to a later reclaim re-running the handler. In practice this
 * requires the two to be reachable independently, which is unlikely when
 * they share the same database (as admin_article_create's handler does).
 *
 * Handler must return { status, body }.
 */
export async function withIdempotency({ actorId, scope, key, payload, handler }) {
  return attempt({ actorId, scope, key, payload, handler }, 0);
}

async function attempt({ actorId, scope, key, payload, handler }, retryCount) {
  if (!key) return handler();
  if (retryCount > MAX_EXPIRY_RETRIES) {
    throw new Error(`Idempotency key "${key}" did not converge after ${MAX_EXPIRY_RETRIES} expiry retries`);
  }

  const requestFingerprint = fingerprint(payload);
  const myToken = crypto.randomUUID();
  const now = new Date().toISOString();
  const { data: inserted, error: insertError } = await supabase
    .from("idempotency_keys")
    .insert({ actor_id: actorId, scope, idempotency_key: key, request_fingerprint: requestFingerprint, claimed_at: now, lease_token: myToken })
    .select("id")
    .single();

  if (!insertError) return ownAndRun(inserted.id, myToken, handler);
  if (insertError.code !== "23505") throw insertError;

  const { data: existing, error: fetchError } = await supabase
    .from("idempotency_keys")
    .select("id,request_fingerprint,response_status,response_body,created_at,claimed_at,lease_token")
    .eq("actor_id", actorId)
    .eq("scope", scope)
    .eq("idempotency_key", key)
    .maybeSingle();
  if (fetchError) throw fetchError;
  if (!existing) throw new Error("Idempotency key lookup failed after insert conflict");

  if (existing.request_fingerprint !== requestFingerprint) {
    return {
      status: 409,
      body: { error: "IDEMPOTENCY_KEY_REUSE_MISMATCH", message: "This Idempotency-Key was already used with different request data." }
    };
  }

  const keyAge = Date.now() - new Date(existing.created_at).getTime();
  if (keyAge > TTL_MS) {
    // ponytail: lazy expiry (delete-then-retry) instead of a cleanup cron;
    // add a scheduled purge job if idempotency_keys volume becomes large.
    // A delete failure must not be swallowed: silently recursing on a row
    // that's still there would either loop pointlessly or (if treated as
    // success) risk two callers believing they each "cleaned up and own"
    // the slot.
    const { error: deleteError } = await supabase.from("idempotency_keys").delete().eq("id", existing.id);
    if (deleteError) throw deleteError;
    return attempt({ actorId, scope, key, payload, handler }, retryCount + 1);
  }

  if (existing.response_body !== null) {
    return { status: existing.response_status, body: existing.response_body };
  }

  const leaseAge = Date.now() - new Date(existing.claimed_at).getTime();
  if (leaseAge <= CLAIM_TIMEOUT_MS) {
    return {
      status: 409,
      body: { error: "REQUEST_IN_PROGRESS", message: "An identical request is already being processed. Retry shortly." }
    };
  }

  // The lease is older than the timeout and still has no response, so the
  // original claimant is presumed dead (crashed, or its renewals could not
  // reach the database). Attempt an atomic compare-and-swap reclaim: the
  // UPDATE only matches if lease_token still equals the value we just read
  // and response_body is still null, so if multiple requests race here at
  // most one of them can win. A live-but-renewing owner is never reclaimed,
  // because its own renewal already advanced lease_token/claimed_at past
  // what we read here before leaseAge could exceed CLAIM_TIMEOUT_MS.
  const newToken = crypto.randomUUID();
  const { data: reclaimed, error: reclaimError } = await supabase
    .from("idempotency_keys")
    .update({ claimed_at: new Date().toISOString(), lease_token: newToken })
    .eq("id", existing.id)
    .eq("lease_token", existing.lease_token)
    .is("response_body", null)
    .select("id")
    .maybeSingle();
  if (reclaimError) throw reclaimError;

  if (!reclaimed) {
    // Someone else renewed or reclaimed it between our read and our
    // reclaim attempt. Treat this request as in-progress; safe to retry.
    return {
      status: 409,
      body: { error: "REQUEST_IN_PROGRESS", message: "An identical request is already being processed. Retry shortly." }
    };
  }

  return ownAndRun(reclaimed.id, newToken, handler);
}

import { test, beforeEach, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ??= "https://test-project.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";

const { supabase } = await import("./supabase.js");
const { withIdempotency, fingerprint, __setIdempotencyTimingForTests } = await import("./idempotency.js");

// In-memory stand-in for the idempotency_keys table that enforces the same
// unique(actor_id, scope, idempotency_key) constraint Postgres would, plus
// Postgres's atomic-UPDATE-only-matches-what-it-matches semantics (needed to
// exercise the compare-and-swap reclaim/renew/persist paths).
let rows;
let nextId;
let realFrom;

function matching(actorId, scope, key) {
  return rows.find((r) => r.actor_id === actorId && r.scope === scope && r.idempotency_key === key);
}

function fakeIdempotencyTable() {
  const state = { filters: [], mode: "select", patch: null };
  const builder = {
    insert(record) {
      if (matching(record.actor_id, record.scope, record.idempotency_key)) {
        return { select: () => ({ single: async () => ({ data: null, error: { code: "23505", message: "duplicate key" } }) }) };
      }
      const stored = { id: String(nextId++), response_status: null, response_body: null, created_at: new Date().toISOString(), ...record };
      rows.push(stored);
      return { select: () => ({ single: async () => ({ data: { id: stored.id }, error: null }) }) };
    },
    select() { return builder; },
    update(patch) { state.mode = "update"; state.patch = patch; return builder; },
    delete() { state.mode = "delete"; return builder; },
    eq(field, value) { state.filters.push([field, value]); return builder; },
    is(field, value) { state.filters.push([field, value]); return builder; },
    async maybeSingle() { return resolve(); },
    async single() { return resolve(); },
    // Supabase's query builder is itself thenable, so callers may `await` it
    // directly with no terminal `.select()`/`.maybeSingle()` (e.g. the bare
    // renewLease/delete calls in idempotency.js). Mirror that here.
    then(onFulfilled, onRejected) { return Promise.resolve(resolve()).then(onFulfilled, onRejected); }
  };

  function matchedRows() {
    return rows.filter((r) => state.filters.every(([field, value]) => r[field] === value));
  }

  function resolve() {
    const found = matchedRows();
    if (state.mode === "update") {
      // Mirrors a real atomic UPDATE: only rows matching every filter (at
      // the moment this statement runs) are affected - the exact property
      // the compare-and-swap reclaim/renew/persist logic depends on.
      found.forEach((row) => Object.assign(row, state.patch));
      return { data: found[0] || null, error: null };
    }
    if (state.mode === "delete") {
      rows = rows.filter((row) => !found.includes(row));
      return { data: null, error: null };
    }
    return { data: found[0] || null, error: null };
  }

  return builder;
}

before(() => {
  realFrom = (table) => {
    if (table !== "idempotency_keys") throw new Error(`Unexpected table in test: ${table}`);
    return fakeIdempotencyTable();
  };
});

beforeEach(() => {
  rows = [];
  nextId = 1;
  supabase.from = realFrom;
  __setIdempotencyTimingForTests({ claimTimeoutMs: 30 * 1000, renewIntervalMs: 10 * 1000 });
});

function seedRow({ actorId = "user-1", scope = "test", key = "key-1", payload = { title: "x" }, claimedSecondsAgo = 0, createdSecondsAgo = 0 }) {
  const row = {
    id: String(nextId++),
    actor_id: actorId,
    scope,
    idempotency_key: key,
    request_fingerprint: fingerprint(payload),
    response_status: null,
    response_body: null,
    created_at: new Date(Date.now() - createdSecondsAgo * 1000).toISOString(),
    claimed_at: new Date(Date.now() - claimedSecondsAgo * 1000).toISOString(),
    lease_token: `seed-token-${nextId}`
  };
  rows.push(row);
  return row;
}

test("no key: handler runs directly, nothing persisted", async () => {
  let calls = 0;
  const result = await withIdempotency({
    actorId: "user-1", scope: "test", key: undefined, payload: { a: 1 },
    handler: async () => { calls += 1; return { status: 201, body: { ok: true } }; }
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { status: 201, body: { ok: true } });
  assert.equal(rows.length, 0);
});

test("same key + same payload: handler runs once, replay returns stored result", async () => {
  let calls = 0;
  const run = () => withIdempotency({
    actorId: "user-1", scope: "test", key: "key-1", payload: { title: "x" },
    handler: async () => { calls += 1; return { status: 201, body: { id: "article-1" } }; }
  });

  const first = await run();
  const second = await run();

  assert.equal(calls, 1);
  assert.deepEqual(first, { status: 201, body: { id: "article-1" } });
  assert.deepEqual(second, first);
});

test("same key + different payload: rejected without re-running handler", async () => {
  let calls = 0;
  const handler = async () => { calls += 1; return { status: 201, body: { id: "article-1" } }; };

  await withIdempotency({ actorId: "user-1", scope: "test", key: "key-1", payload: { title: "x" }, handler });
  const second = await withIdempotency({ actorId: "user-1", scope: "test", key: "key-1", payload: { title: "y" }, handler });

  assert.equal(calls, 1);
  assert.equal(second.status, 409);
  assert.equal(second.body.error, "IDEMPOTENCY_KEY_REUSE_MISMATCH");
});

test("concurrent in-flight request within the lease window is rejected, not duplicated", async () => {
  seedRow({ claimedSecondsAgo: 1 });

  let calls = 0;
  const result = await withIdempotency({
    actorId: "user-1", scope: "test", key: "key-1", payload: { title: "x" },
    handler: async () => { calls += 1; return { status: 201, body: {} }; }
  });

  assert.equal(calls, 0);
  assert.equal(result.status, 409);
  assert.equal(result.body.error, "REQUEST_IN_PROGRESS");
});

test("different actor with the same key is an independent request (cross-user isolation)", async () => {
  const results = {};
  for (const actorId of ["user-1", "user-2"]) {
    results[actorId] = await withIdempotency({
      actorId, scope: "test", key: "shared-key", payload: { title: actorId },
      handler: async () => ({ status: 201, body: { createdBy: actorId } })
    });
  }
  assert.deepEqual(results["user-1"].body, { createdBy: "user-1" });
  assert.deepEqual(results["user-2"].body, { createdBy: "user-2" });
});

test("expired key (24h TTL) is purged and the handler runs again (retry after transient failure)", async () => {
  let calls = 0;
  const handler = async () => { calls += 1; return { status: 201, body: { attempt: calls } }; };

  const first = await withIdempotency({ actorId: "user-1", scope: "test", key: "key-1", payload: { a: 1 }, handler });
  rows[0].created_at = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  const second = await withIdempotency({ actorId: "user-1", scope: "test", key: "key-1", payload: { a: 1 }, handler });

  assert.equal(calls, 2);
  assert.deepEqual(first.body, { attempt: 1 });
  assert.deepEqual(second.body, { attempt: 2 });
});

test("a delete failure while purging an expired key throws instead of looping or silently proceeding", async () => {
  seedRow({ createdSecondsAgo: 25 * 60 * 60 });
  supabase.from = (table) => {
    const real = realFrom(table);
    return { ...real, delete: () => ({ eq: async () => ({ data: null, error: new Error("connection reset") }) }) };
  };

  let calls = 0;
  await assert.rejects(
    () => withIdempotency({
      actorId: "user-1", scope: "test", key: "key-1", payload: { title: "x" },
      handler: async () => { calls += 1; return { status: 201, body: {} }; }
    }),
    /connection reset/
  );
  assert.equal(calls, 0, "the handler must not run if we can't safely clear the expired row first");
});

test("concurrent requests both finding the key expired converge on a single handler run", async () => {
  seedRow({ createdSecondsAgo: 25 * 60 * 60 });

  let calls = 0;
  const attempt = () => withIdempotency({
    actorId: "user-1", scope: "test", key: "key-1", payload: { title: "x" },
    // A short delay keeps the winner's own insert -> persist sequence from
    // racing to completion before the loser even reaches its own insert,
    // so the loser deterministically observes "in progress", not a replay.
    handler: async () => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 20)); return { status: 201, body: { winner: calls } }; }
  });

  const [first, second] = await Promise.all([attempt(), attempt()]);

  assert.equal(calls, 1, "exactly one caller must actually run the handler for the expired key");
  const statuses = [first.status, second.status].sort();
  assert.deepEqual(statuses, [201, 409]);
  const loser = first.status === 409 ? first : second;
  assert.equal(loser.body.error, "REQUEST_IN_PROGRESS");
});

test("abandoned claim (stale lease) is safely reclaimed and the handler runs", async () => {
  seedRow({ claimedSecondsAgo: 31 });

  let calls = 0;
  const result = await withIdempotency({
    actorId: "user-1", scope: "test", key: "key-1", payload: { title: "x" },
    handler: async () => { calls += 1; return { status: 201, body: { id: "article-recovered" } }; }
  });

  assert.equal(calls, 1, "the reclaiming request must actually run the handler");
  assert.deepEqual(result, { status: 201, body: { id: "article-recovered" } });
  assert.equal(rows[0].response_body.id, "article-recovered", "the result must be persisted so later replays see it");
});

test("completed response always replays immediately, even past the lease timeout", async () => {
  const row = seedRow({ claimedSecondsAgo: 60 });
  row.response_status = 201;
  row.response_body = { id: "article-done" };
  row.completed_at = new Date().toISOString();

  let calls = 0;
  const result = await withIdempotency({
    actorId: "user-1", scope: "test", key: "key-1", payload: { title: "x" },
    handler: async () => { calls += 1; return { status: 201, body: { id: "SHOULD NOT RUN" } }; }
  });

  assert.equal(calls, 0);
  assert.deepEqual(result, { status: 201, body: { id: "article-done" } });
});

test("two requests racing to reclaim the same abandoned claim: only one runs the handler", async () => {
  seedRow({ claimedSecondsAgo: 31 });

  let calls = 0;
  const attempt = () => withIdempotency({
    actorId: "user-1", scope: "test", key: "key-1", payload: { title: "x" },
    handler: async () => { calls += 1; return { status: 201, body: { winner: calls } }; }
  });

  const [first, second] = await Promise.all([attempt(), attempt()]);

  assert.equal(calls, 1, "only one of the two racing reclaims may run the handler");
  const statuses = [first.status, second.status].sort();
  assert.deepEqual(statuses, [201, 409]);
  const loser = first.status === 409 ? first : second;
  assert.equal(loser.body.error, "REQUEST_IN_PROGRESS");
});

test("a slow-but-alive handler renews its lease, so a concurrent request is told to retry instead of reclaiming", async () => {
  __setIdempotencyTimingForTests({ claimTimeoutMs: 100, renewIntervalMs: 20 });

  let calls = 0;
  const slowAttempt = withIdempotency({
    actorId: "user-1", scope: "test", key: "key-1", payload: { title: "x" },
    handler: async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 350));
      return { status: 201, body: { id: "article-slow" } };
    }
  });

  await new Promise((resolve) => setTimeout(resolve, 150));
  const duringRun = await withIdempotency({
    actorId: "user-1", scope: "test", key: "key-1", payload: { title: "x" },
    handler: async () => { calls += 1; return { status: 201, body: { id: "SHOULD NOT RUN" } }; }
  });

  assert.equal(duringRun.status, 409);
  assert.equal(duringRun.body.error, "REQUEST_IN_PROGRESS", "lease renewal must keep the slow handler's claim looking alive");

  const final = await slowAttempt;
  assert.equal(calls, 1, "the slow handler must still be the only one that ever ran");
  assert.deepEqual(final, { status: 201, body: { id: "article-slow" } });
});

test("handler exception leaves the row unclaimed (no response persisted) for a later retry to recover", async () => {
  let calls = 0;
  await assert.rejects(
    () => withIdempotency({
      actorId: "user-1", scope: "test", key: "key-1", payload: { title: "x" },
      handler: async () => { calls += 1; throw new Error("downstream boom"); }
    }),
    /downstream boom/
  );

  assert.equal(calls, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].response_body, null, "a thrown handler must never leave a fabricated response behind");
});

test("persistence failure after a successful handler throws rather than silently reporting success", async () => {
  __setIdempotencyTimingForTests({ claimTimeoutMs: 30 * 1000, renewIntervalMs: 10 * 1000 });
  supabase.from = (table) => {
    const real = realFrom(table);
    return {
      ...real,
      update(patch) {
        if (Object.prototype.hasOwnProperty.call(patch, "response_status")) {
          return { eq: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: new Error("connection reset") }) }) }) }) };
        }
        return real.update(patch);
      }
    };
  };

  let calls = 0;
  await assert.rejects(
    () => withIdempotency({
      actorId: "user-1", scope: "test", key: "key-1", payload: { title: "x" },
      handler: async () => { calls += 1; return { status: 201, body: { id: "article-done-but-unsaved" } }; }
    }),
    /connection reset/
  );

  assert.equal(calls, 1, "the handler's real side effect still only runs once");
  assert.equal(rows[0].response_body, null, "an un-persistable result must not be reported as the stored canonical response");
});

after(() => {
  __setIdempotencyTimingForTests({ claimTimeoutMs: 30 * 1000, renewIntervalMs: 10 * 1000 });
});

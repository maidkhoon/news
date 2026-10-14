import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ??= "https://test-project.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";

const { supabase } = await import("./supabase.js");
const { withIdempotency, fingerprint } = await import("./idempotency.js");

// In-memory stand-in for the idempotency_keys table that enforces the same
// unique(actor_id, scope, idempotency_key) constraint Postgres would.
let rows;
let nextId;

function row(id) { return rows.find((r) => r.id === id); }
function matching(actorId, scope, key) {
  return rows.find((r) => r.actor_id === actorId && r.scope === scope && r.idempotency_key === key);
}

function fakeIdempotencyTable() {
  const builder = {
    _filters: {},
    insert(record) {
      if (matching(record.actor_id, record.scope, record.idempotency_key)) {
        return { select: () => ({ single: async () => ({ data: null, error: { code: "23505", message: "duplicate key" } }) }) };
      }
      const stored = { id: String(nextId++), response_status: null, response_body: null, created_at: new Date().toISOString(), ...record };
      rows.push(stored);
      return { select: () => ({ single: async () => ({ data: { id: stored.id }, error: null }) }) };
    },
    select() { return builder; },
    eq(field, value) { builder._filters[field] = value; return builder; },
    async maybeSingle() {
      const match = rows.find((r) => Object.entries(builder._filters).every(([k, v]) => r[k] === v));
      return { data: match || null, error: null };
    },
    update(patch) {
      return {
        eq: async (field, value) => {
          const match = rows.find((r) => r[field] === value);
          if (match) Object.assign(match, patch);
          return { data: match || null, error: null };
        }
      };
    },
    delete() {
      return {
        eq: async (field, value) => {
          rows = rows.filter((r) => r[field] !== value);
          return { data: null, error: null };
        }
      };
    }
  };
  return builder;
}

beforeEach(() => {
  rows = [];
  nextId = 1;
  supabase.from = (table) => {
    if (table !== "idempotency_keys") throw new Error(`Unexpected table in test: ${table}`);
    return fakeIdempotencyTable();
  };
});

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

test("concurrent in-flight request with same key is rejected, not duplicated", async () => {
  // Simulate: first insert succeeded but the handler has not finished (so
  // response_body is still null) when a second request races in.
  rows.push({ id: "in-flight", actor_id: "user-1", scope: "test", idempotency_key: "key-1", request_fingerprint: fingerprint({ title: "x" }), response_status: null, response_body: null, created_at: new Date().toISOString() });

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

test("expired key is purged and the handler runs again (retry after transient failure)", async () => {
  let calls = 0;
  const handler = async () => { calls += 1; return { status: 201, body: { attempt: calls } }; };

  const first = await withIdempotency({ actorId: "user-1", scope: "test", key: "key-1", payload: { a: 1 }, handler });
  // Force the stored row to look 25 hours old (older than the 24h TTL).
  rows[0].created_at = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  const second = await withIdempotency({ actorId: "user-1", scope: "test", key: "key-1", payload: { a: 1 }, handler });

  assert.equal(calls, 2);
  assert.deepEqual(first.body, { attempt: 1 });
  assert.deepEqual(second.body, { attempt: 2 });
});

import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ??= "https://test-project.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";

const { default: express } = await import("express");
const { supabase } = await import("../lib/supabase.js");
const { default: adminRouter } = await import("./admin.js");

const ADMIN_USER = { id: "admin-1", email: "admin@example.com" };
const OTHER_ADMIN = { id: "admin-2", email: "other-admin@example.com" };

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminRouter);
  return app;
}

async function withServer(fn) {
  const app = buildApp();
  const server = app.listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// Minimal in-memory Postgres stand-in: enough `.eq().select()` chaining to
// exercise admin.js + idempotency.js exactly as Supabase would, including
// unique-constraint conflicts (23505) on articles.slug and on
// idempotency_keys(actor_id, scope, idempotency_key).
let db;
let currentUser;

function uniqueViolation() {
  return { code: "23505", message: "duplicate key value violates unique constraint" };
}

function fakeFrom(table) {
  const state = { filters: [], patch: null, mode: "select" };
  const builder = {
    select() { return builder; },
    eq(field, value) { state.filters.push([field, value]); return builder; },
    order() { return builder; },
    range() { return builder; },
    insert(record) { state.mode = "insert"; state.record = record; return builder; },
    update(patch) { state.mode = "update"; state.patch = patch; return builder; },
    delete() { state.mode = "delete"; return builder; },
    async maybeSingle() { return resolve(); },
    async single() { return resolve(); },
    // Supabase's query builder is itself thenable, so callers may `await`
    // it directly (e.g. a bare `.insert()` or `.update().eq()` with no
    // terminal `.select()`). Mirror that here so those paths actually run.
    then(onFulfilled, onRejected) { return Promise.resolve(resolve()).then(onFulfilled, onRejected); }
  };

  function matchRows() {
    return db[table].filter((row) => state.filters.every(([field, value]) => row[field] === value));
  }

  function resolve() {
    if (state.mode === "insert") {
      if (table === "articles" && db.articles.some((r) => r.slug === state.record.slug)) {
        return { data: null, error: uniqueViolation() };
      }
      if (table === "idempotency_keys" && db.idempotency_keys.some((r) =>
        r.actor_id === state.record.actor_id && r.scope === state.record.scope && r.idempotency_key === state.record.idempotency_key)) {
        return { data: null, error: uniqueViolation() };
      }
      const row = { id: `${table}-${db[table].length + 1}`, created_at: new Date().toISOString(), response_status: null, response_body: null, ...state.record };
      db[table].push(row);
      return { data: row, error: null };
    }
    if (state.mode === "update") {
      const matches = matchRows();
      matches.forEach((row) => Object.assign(row, state.patch));
      return { data: matches[0] || null, error: null };
    }
    if (state.mode === "delete") {
      db[table] = db[table].filter((row) => !matchRows().includes(row));
      return { data: null, error: null };
    }
    const matches = matchRows();
    return { data: matches[0] || null, error: null };
  }

  return builder;
}

before(() => {
  supabase.auth.getUser = async () => ({ data: { user: currentUser }, error: null });
  supabase.from = (table) => {
    if (!(table in db)) throw new Error(`Unexpected table in test: ${table}`);
    return fakeFrom(table);
  };
});

beforeEach(() => {
  currentUser = ADMIN_USER;
  db = {
    profiles: [
      { id: ADMIN_USER.id, role: "ADMIN", status: true },
      { id: OTHER_ADMIN.id, role: "ADMIN", status: true }
    ],
    articles: [],
    idempotency_keys: [],
    devices: [],
    notifications: []
  };
});

function authHeaders(extra = {}) {
  return { Authorization: "Bearer test-token", "Content-Type": "application/json", ...extra };
}

const draftPayload = {
  title: "Nifty 50 closes higher",
  content: "Markets rallied on strong earnings across the board today.",
  category_id: "cat-india"
};

test("POST /admin/articles with the same Idempotency-Key and payload returns the original draft, not a duplicate", async () => {
  await withServer(async (baseUrl) => {
    const headers = authHeaders({ "Idempotency-Key": "draft-key-1" });
    const first = await fetch(`${baseUrl}/api/admin/articles`, { method: "POST", headers, body: JSON.stringify(draftPayload) });
    const firstBody = await first.json();
    assert.equal(first.status, 201);

    const second = await fetch(`${baseUrl}/api/admin/articles`, { method: "POST", headers, body: JSON.stringify(draftPayload) });
    const secondBody = await second.json();

    assert.equal(second.status, 201);
    assert.deepEqual(secondBody, firstBody);
    assert.equal(db.articles.length, 1, "only one article should have been created");
  });
});

test("POST /admin/articles with the same Idempotency-Key and a different payload is rejected", async () => {
  await withServer(async (baseUrl) => {
    const headers = authHeaders({ "Idempotency-Key": "draft-key-1" });
    await fetch(`${baseUrl}/api/admin/articles`, { method: "POST", headers, body: JSON.stringify(draftPayload) });

    const res = await fetch(`${baseUrl}/api/admin/articles`, {
      method: "POST", headers, body: JSON.stringify({ ...draftPayload, title: "A completely different headline here" })
    });
    const body = await res.json();

    assert.equal(res.status, 409);
    assert.equal(body.error, "IDEMPOTENCY_KEY_REUSE_MISMATCH");
    assert.equal(db.articles.length, 1);
  });
});

test("POST /admin/articles without an Idempotency-Key behaves exactly as before (opt-in only)", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/admin/articles`, { method: "POST", headers: authHeaders(), body: JSON.stringify(draftPayload) });
    assert.equal(res.status, 201);
    assert.equal(db.idempotency_keys.length, 0);
  });
});

test("the same Idempotency-Key from a different admin is an independent request (cross-user isolation)", async () => {
  await withServer(async (baseUrl) => {
    const headers = { "Content-Type": "application/json", "Idempotency-Key": "draft-key-1" };

    // Distinct titles/slugs so the only shared thing between these two
    // requests is the Idempotency-Key header, isolating key scoping from
    // the (separate, already-covered) article-slug uniqueness behavior.
    currentUser = ADMIN_USER;
    const first = await fetch(`${baseUrl}/api/admin/articles`, { method: "POST", headers: { ...headers, Authorization: "Bearer admin-1-token" }, body: JSON.stringify({ ...draftPayload, title: "Admin one headline" }) });
    assert.equal(first.status, 201);

    currentUser = OTHER_ADMIN;
    const second = await fetch(`${baseUrl}/api/admin/articles`, { method: "POST", headers: { ...headers, Authorization: "Bearer admin-2-token" }, body: JSON.stringify({ ...draftPayload, title: "Admin two headline" }) });
    assert.equal(second.status, 201);

    assert.equal(db.articles.length, 2, "each admin's request should create its own article");
  });
});

test("PATCH publish is retried without sending a duplicate publish notification", async () => {
  await withServer(async (baseUrl) => {
    const createRes = await fetch(`${baseUrl}/api/admin/articles`, { method: "POST", headers: authHeaders(), body: JSON.stringify(draftPayload) });
    const { data: article } = await createRes.json();

    const publishOnce = async () => fetch(`${baseUrl}/api/admin/articles/${article.id}`, {
      method: "PATCH", headers: authHeaders(), body: JSON.stringify({ status: "PUBLISHED" })
    });

    const first = await publishOnce();
    assert.equal(first.status, 200);
    assert.equal(db.notifications.length, 1, "first publish should insert one notification");

    const second = await publishOnce();
    assert.equal(second.status, 200);
    assert.equal(db.notifications.length, 1, "retrying an already-published article must not insert a second notification");
  });
});

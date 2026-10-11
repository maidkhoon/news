import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Set dummy Supabase config before anything imports lib/supabase.js, which
// throws at module load time if these are missing. Dynamic import() below
// (unlike static import) runs after this assignment.
process.env.SUPABASE_URL ??= "https://test-project.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
// Leave GOOGLE_PLAY_* unset so verify-google-play exercises the
// "billing not configured" path without needing real credentials.
delete process.env.GOOGLE_PLAY_PACKAGE_NAME;
delete process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;

const { default: express } = await import("express");
const { supabase } = await import("../lib/supabase.js");
const { default: subscriptionsRouter } = await import("./subscriptions.js");

const TEST_USER = { id: "11111111-1111-1111-1111-111111111111", phone: "+15550000000", email: null };

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/subscriptions", subscriptionsRouter);
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

// Chainable fake query builder: every filter method returns itself, and the
// terminal method (maybeSingle/single) resolves to a pre-set result.
function fakeQuery(result) {
  const builder = {
    select() { return builder; },
    eq() { return builder; },
    gt() { return builder; },
    order() { return builder; },
    limit() { return builder; },
    insert() { return builder; },
    upsert() { return builder; },
    maybeSingle: async () => result,
    single: async () => result
  };
  return builder;
}

let tableResults;

before(() => {
  // Authenticate any bearer token as TEST_USER.
  supabase.auth.getUser = async () => ({ data: { user: TEST_USER }, error: null });
  supabase.from = (table) => {
    if (!(table in tableResults)) throw new Error(`Unexpected table in test: ${table}`);
    return fakeQuery(tableResults[table]);
  };
});

beforeEach(() => {
  tableResults = {
    profiles: { data: { id: TEST_USER.id }, error: null }
  };
});

test("GET /me returns active:false when no active subscription exists", async () => {
  tableResults.subscriptions = { data: null, error: null };
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/subscriptions/me`, {
      headers: { Authorization: "Bearer test-token" }
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.active, false);
    assert.equal(body.data, null);
  });
});

test("GET /me returns active:true with subscription data when one exists", async () => {
  const subscriptionRow = {
    id: "sub-1",
    plan_type: "PRO_MONTHLY",
    product_id: "pro_monthly",
    status: "ACTIVE",
    start_date: "2026-01-01T00:00:00.000Z",
    expiry_date: "2099-01-01T00:00:00.000Z",
    auto_renewing: true,
    provider: "google_play"
  };
  tableResults.subscriptions = { data: subscriptionRow, error: null };
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/subscriptions/me`, {
      headers: { Authorization: "Bearer test-token" }
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.active, true);
    assert.deepEqual(body.data, subscriptionRow);
  });
});

test("GET /me returns 500 without leaking details when profile lookup fails", async () => {
  tableResults.profiles = { data: null, error: { message: "connection reset" } };
  tableResults.subscriptions = { data: null, error: null };
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/subscriptions/me`, {
      headers: { Authorization: "Bearer test-token" }
    });
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.error, "Unable to load subscription status");
    assert.ok(!JSON.stringify(body).includes("connection reset"));
  });
});

test("POST /verify-google-play returns 503 when server billing is not configured", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/subscriptions/verify-google-play`, {
      method: "POST",
      headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
      body: JSON.stringify({ productId: "pro_monthly", purchaseToken: "token-123" })
    });
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error, "PLAY_BILLING_NOT_CONFIGURED");
  });
});

import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ??= "https://test-project.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
process.env.NVIDIA_API_KEY ??= "test-nvidia-key";

const { default: express } = await import("express");
const { supabase } = await import("../lib/supabase.js");
const { default: insightsRouter, classifyProviderFailure } = await import("./insights.js");

const ARTICLE = {
  id: "article-1",
  title: "Example headline",
  content: "Some published article body text.",
  source_url: "https://example.com/story",
  source_name: "Example Wire",
  published_at: "2026-01-01T00:00:00.000Z",
  categories: { name: "India" }
};

function fakeQuery(result) {
  const builder = {
    select() { return builder; },
    eq() { return builder; },
    neq() { return builder; },
    order() { return builder; },
    limit() { return builder; },
    maybeSingle: async () => result
  };
  return builder;
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/insights", insightsRouter);
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

const originalFetch = globalThis.fetch;
const NVIDIA_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";

// Only intercepts calls to the NVIDIA endpoint; the test's own outer fetch()
// calls to the local Express server go through the real fetch untouched.
function mockNvidiaFetch(handler) {
  globalThis.fetch = (url, init) => {
    if (typeof url === "string" && url.startsWith(NVIDIA_ENDPOINT)) return handler(url, init);
    return originalFetch(url, init);
  };
}

before(() => {
  supabase.from = () => fakeQuery({ data: ARTICLE, error: null });
});

beforeEach(() => {
  process.env.NVIDIA_API_KEY = "test-nvidia-key";
  globalThis.fetch = originalFetch;
});

after(() => {
  globalThis.fetch = originalFetch;
});

test("classifyProviderFailure maps provider statuses to safe client messages", () => {
  assert.equal(classifyProviderFailure(401).httpStatus, 503);
  assert.equal(classifyProviderFailure(403).httpStatus, 503);
  assert.equal(classifyProviderFailure(404).httpStatus, 502);
  const retired = classifyProviderFailure(410);
  assert.equal(retired.httpStatus, 502);
  assert.match(retired.error, /retired/i);
  assert.equal(classifyProviderFailure(429).httpStatus, 503);
  assert.equal(classifyProviderFailure(500).httpStatus, 502);
  assert.equal(classifyProviderFailure(599).httpStatus, 502);
});

test("POST /summary returns 503 when NVIDIA_API_KEY is not configured", async () => {
  delete process.env.NVIDIA_API_KEY;
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/insights/summary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: "example-slug" })
    });
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.match(body.error, /not configured/i);
  });
});

test("POST /summary returns 502 and no fabricated summary when the provider retired the model (410)", async () => {
  mockNvidiaFetch(async () => new Response("Gone", { status: 410 }));
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/insights/summary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: "example-slug" })
    });
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.match(body.error, /retired/i);
    assert.equal(body.data, undefined);
  });
});

test("POST /summary returns 503 when the provider rate-limits the request (429)", async () => {
  mockNvidiaFetch(async () => new Response("Too Many Requests", { status: 429 }));
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/insights/summary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: "example-slug" })
    });
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.match(body.error, /rate-limited/i);
  });
});

test("POST /summary returns 504 when the provider request times out", async () => {
  mockNvidiaFetch(async () => {
    const err = new Error("The operation was aborted due to timeout");
    err.name = "TimeoutError";
    throw err;
  });
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/insights/summary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: "example-slug" })
    });
    assert.equal(res.status, 504);
    const body = await res.json();
    assert.match(body.error, /too long/i);
  });
});

test("POST /summary returns structured bullets and the source link on success", async () => {
  mockNvidiaFetch(async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({
      bullets: ["First point", "Second point", "Third point"],
      keyTerms: [{ term: "RBI", explanation: "India's central bank" }]
    }) } }]
  }), { status: 200 }));

  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/insights/summary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: "example-slug" })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.data.bullets, ["First point", "Second point", "Third point"]);
    assert.equal(body.data.sourceUrl, ARTICLE.source_url);
    assert.equal(body.data.sourceName, ARTICLE.source_name);
    assert.equal(typeof body.data.model, "string");
    assert.ok(body.data.model.length > 0);
  });
});

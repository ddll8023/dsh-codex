import test from "node:test";
import assert from "node:assert/strict";
import { CodexModelCatalog } from "../lib/model-catalog.js";
import { resolveAdapterOptions } from "../lib/config.js";
import { DEFAULT_BASE_URL, WIRE_ORIGINATOR } from "../lib/constants.js";
import { makeCredential } from "./helpers.js";

const FALLBACK_MODEL = {
  id: "gpt-known",
  name: "GPT Known",
  api: "openai-codex-responses",
  provider: "openai-codex",
  baseUrl: DEFAULT_BASE_URL,
  reasoning: true,
  thinkingLevelMap: { low: "low", high: "high" },
  input: ["text", "image"],
  cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
  contextWindow: 272000,
  maxTokens: 128000,
  type: "chat",
};

function response(status, body, headers = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { ...(body === null ? {} : { "content-type": "application/json" }), ...headers },
  });
}

test("model catalog client version defaults and validates as Codex semver", () => {
  assert.equal(resolveAdapterOptions({}).modelCatalogClientVersion, "0.157.0");
  assert.equal(resolveAdapterOptions({ modelCatalogClientVersion: "0.158.1" }).modelCatalogClientVersion, "0.158.1");
  assert.throws(() => resolveAdapterOptions({ modelCatalogClientVersion: "latest" }), /major.minor.patch/);
});

function liveModel(overrides = {}) {
  return {
    slug: "gpt-live",
    display_name: "GPT Live",
    supported_in_api: true,
    context_window: 196000,
    max_context_window: 272000,
    input_modalities: ["text", "image"],
    supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }],
    baseUrl: "https://untrusted.example/backend-api",
    ...overrides,
  };
}

test("Codex model catalog requests the account-specific endpoint and maps live records", async () => {
  const credential = makeCredential({ accountId: "account-live" });
  let request;
  const catalog = new CodexModelCatalog({
    store: { read: async () => credential },
    fallbackModels: [FALLBACK_MODEL],
    fetchImpl: async (url, init) => {
      request = { url, init };
      return response(200, { models: [liveModel()] }, { etag: '"catalog-v1"' });
    },
    now: () => 1000,
  });

  const models = await catalog.refresh({ baseURL: DEFAULT_BASE_URL, clientVersion: "0.157.0" });
  const url = new URL(request.url);
  assert.equal(url.origin, "https://chatgpt.com");
  assert.equal(url.pathname, "/backend-api/codex/models");
  assert.equal(url.searchParams.get("client_version"), "0.157.0");
  assert.equal(request.init.method, "GET");
  assert.equal(request.init.headers.authorization, `Bearer ${credential.access}`);
  assert.equal(request.init.headers["chatgpt-account-id"], "account-live");
  assert.equal(request.init.headers.originator, WIRE_ORIGINATOR);

  assert.deepEqual(models.map((model) => model.id), ["gpt-live"]);
  assert.equal(models[0].name, "GPT Live");
  assert.equal(models[0].contextWindow, 196000);
  assert.equal(models[0].baseUrl, DEFAULT_BASE_URL, "catalog data cannot redirect model requests");
  assert.deepEqual(models[0].input, ["text", "image"]);
  assert.deepEqual(models[0].thinkingLevelMap, { low: "low", high: "high" });
  assert.equal(models[0].maxTokens, FALLBACK_MODEL.maxTokens);
  assert.deepEqual(models[0].cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
});

test("Codex model catalog uses account-scoped cache and ETag revalidation", async () => {
  const credential = makeCredential({ accountId: "account-cache" });
  let now = 10_000;
  let calls = 0;
  let secondHeaders;
  const catalog = new CodexModelCatalog({
    store: { read: async () => credential },
    fallbackModels: [FALLBACK_MODEL],
    cacheMs: 100,
    now: () => now,
    fetchImpl: async (_url, init) => {
      calls += 1;
      if (calls === 1) return response(200, { models: [liveModel()] }, { etag: '"catalog-v1"' });
      secondHeaders = init.headers;
      return response(304, null, { etag: '"catalog-v1"' });
    },
  });

  const first = await catalog.refresh({ baseURL: DEFAULT_BASE_URL, clientVersion: "0.157.0" });
  await catalog.refresh({ baseURL: DEFAULT_BASE_URL, clientVersion: "0.157.0" });
  assert.equal(calls, 1, "fresh catalog is served from memory");

  now += 101;
  const revalidated = await catalog.refresh({ baseURL: DEFAULT_BASE_URL, clientVersion: "0.157.0" });
  assert.equal(calls, 2);
  assert.equal(secondHeaders["if-none-match"], '"catalog-v1"');
  assert.equal(revalidated[0].id, first[0].id);
});

test("Codex model catalog does not contact the backend without credentials", async () => {
  let calls = 0;
  const catalog = new CodexModelCatalog({
    store: { read: async () => undefined },
    fallbackModels: [FALLBACK_MODEL],
    fetchImpl: async () => { calls += 1; throw new Error("unexpected request"); },
  });

  const models = await catalog.refresh({ baseURL: DEFAULT_BASE_URL, clientVersion: "0.157.0" });
  assert.deepEqual(models.map((model) => model.id), ["gpt-known"]);
  assert.equal(calls, 0);
});

test("Codex model catalog retains last-good data and falls back to bundled models on failure", async () => {
  const credential = makeCredential({ accountId: "account-fallback" });
  let fail = false;
  const catalog = new CodexModelCatalog({
    store: { read: async () => credential },
    fallbackModels: [FALLBACK_MODEL],
    fetchImpl: async () => {
      if (fail) return response(503, {});
      return response(200, { models: [liveModel()] }, { etag: '"catalog-v1"' });
    },
  });

  const live = await catalog.refresh({ baseURL: DEFAULT_BASE_URL, clientVersion: "0.157.0" });
  fail = true;
  await catalog.refresh({ baseURL: DEFAULT_BASE_URL, clientVersion: "0.157.0", force: true });
  assert.equal(catalog.getModels()[0].id, live[0].id, "last-good account catalog survives a failed refresh");

  const noAccountCatalog = new CodexModelCatalog({
    store: { read: async () => undefined },
    fallbackModels: [FALLBACK_MODEL],
    fetchImpl: async () => response(503, {}),
  });
  assert.deepEqual(
    (await noAccountCatalog.refresh({ baseURL: DEFAULT_BASE_URL, clientVersion: "0.157.0" })).map((model) => model.id),
    ["gpt-known"],
  );
});

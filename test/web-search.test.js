import test from "node:test";
import assert from "node:assert/strict";
import { resolveAdapterOptions } from "../lib/config.js";
import {
  createCodexPayloadTransformer,
  hostedWebSearchTool,
  transformCodexPayload,
} from "../lib/web-search.js";

test("Codex Web Search config defaults to enabled live mode", () => {
  const options = resolveAdapterOptions({});
  assert.equal(options.nativeWebSearch, true);
  assert.equal(options.webSearchMode, "live");
});

test("Codex hosted Web Search modes use the public request fields", () => {
  assert.deepEqual(hostedWebSearchTool("live"), { type: "web_search", external_web_access: true });
  assert.deepEqual(hostedWebSearchTool("cached"), { type: "web_search", external_web_access: false });
  assert.deepEqual(hostedWebSearchTool("indexed"), {
    type: "web_search",
    external_web_access: true,
    indexed_web_access: true,
  });
  assert.equal(hostedWebSearchTool("disabled"), undefined);
});

test("payload transformer is request-local and idempotently removes ordinary web_search", () => {
  const body = {
    model: "gpt-5.4",
    tools: [
      { type: "function", name: "read", parameters: {} },
      { type: "function", name: "web_search", parameters: { type: "object" } },
      { type: "function", name: "bash", parameters: {} },
    ],
  };
  const transformer = createCodexPayloadTransformer({
    tools: [{ name: "web_search" }, { name: "read" }],
    nativeWebSearch: true,
    webSearchMode: "cached",
  });
  const once = transformer(body);
  const twice = transformer(once);
  assert.deepEqual(once, twice);
  assert.deepEqual(once.tools, [
    { type: "function", name: "read", parameters: {} },
    { type: "function", name: "bash", parameters: {} },
    { type: "web_search", external_web_access: false },
  ]);
  assert.deepEqual(body.tools[1], { type: "function", name: "web_search", parameters: { type: "object" } });
});

test("payload transformer does not grant search without the Harness permission", () => {
  const body = { tools: [{ type: "function", name: "read", parameters: {} }] };
  assert.equal(
    transformCodexPayload(body, {
      harnessTools: [{ name: "read" }],
      nativeWebSearch: true,
      webSearchMode: "live",
    }),
    undefined,
  );
  assert.equal(
    transformCodexPayload(body, {
      harnessTools: [{ name: "web_search" }],
      nativeWebSearch: false,
      webSearchMode: "live",
    }),
    undefined,
  );
  assert.equal(
    transformCodexPayload(body, {
      harnessTools: [{ name: "web_search" }],
      nativeWebSearch: true,
      webSearchMode: "disabled",
    }),
    undefined,
  );
});

test("webSearchMode disabled installs no payload hook and keeps the function tool", () => {
  const transformer = createCodexPayloadTransformer({
    tools: [{ name: "web_search" }],
    nativeWebSearch: true,
    webSearchMode: "disabled",
  });
  assert.equal(transformer, undefined);
});

test("invalid Codex Web Search configuration is rejected at resolution", () => {
  assert.throws(() => resolveAdapterOptions({ webSearchMode: "instant" }), /webSearchMode must be one of/);
  assert.throws(() => resolveAdapterOptions({ nativeWebSearch: "yes" }), /nativeWebSearch must be a boolean/);
});

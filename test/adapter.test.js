import test from "node:test";
import assert from "node:assert/strict";
import { zstdDecompressSync } from "node:zlib";
import { CodexAdapter } from "../lib/adapter.js";
import { resolveAdapterOptions } from "../lib/config.js";
import { SeamCredentialStore } from "../lib/credentials.js";
import { buildModels } from "../lib/models.js";
import {
  collectChunks,
  fakeCredentialsService,
  generateOptions,
  harnessMessage,
  jsonResponse,
  makeAccessToken,
  makeCredential,
  mockFetch,
  sseResponse,
  textStreamEvents,
  toolCallStreamEvents,
} from "./helpers.js";

function makeAdapter(initialStore = {}, freshen = async () => {}, attachments, configOverrides = {}) {
  const seam = fakeCredentialsService(initialStore);
  const ctx = { get: (name) => (name === "credentials" ? seam : undefined) };
  const store = new SeamCredentialStore(ctx);
  const models = buildModels(store, undefined);
  const config = {
    options: () => resolveAdapterOptions(configOverrides),
    models: () => models,
    freshen,
    attachments: () => attachments,
  };
  return { adapter: new CodexAdapter(config), store, seam, models };
}

function decodeBody(captured) {
  return JSON.parse(
    captured.headers["content-encoding"] === "zstd"
      ? zstdDecompressSync(Buffer.from(captured.body)).toString()
      : captured.body,
  );
}

test("adapter metadata and model catalog", async () => {
  const { adapter } = makeAdapter();
  assert.deepEqual(adapter.providerInfo("openai-codex"), { id: "openai-codex", name: "OpenAI Codex" });
  const models = await adapter.listModels("openai-codex");
  assert.ok(models.length >= 5, "codex catalog advertised");
  assert.ok(models.every((model) => model.provider === "openai-codex"));
  const resolved = await adapter.resolveModel("openai-codex", "gpt-5.4");
  assert.equal(resolved.id, "gpt-5.4");
  assert.equal(resolved.context.contextWindow, 272000);
  assert.ok(resolved.reasoning.efforts.length > 0);
});

test("wire request carries the Codex headers and Responses-API body", async () => {
  const credential = makeCredential({ accountId: "user-wire" });
  const { adapter } = makeAdapter({ OPENAI_CODEX_OAUTH: JSON.stringify(credential) });
  let captured;
  const { restore, requests } = mockFetch(({ url, headers, body }) => {
    captured = { url, headers, body };
    return sseResponse(textStreamEvents("hi there"));
  });
  try {
    const options = generateOptions({ model: "gpt-5.4" });
    const chunks = await collectChunks(adapter.stream(options));
    assert.ok(chunks.length > 0);
  } finally {
    restore();
  }
  assert.equal(requests.length, 1);
  assert.equal(captured.url, "https://chatgpt.com/backend-api/codex/responses");
  assert.equal(captured.headers["authorization"], `Bearer ${credential.access}`);
  assert.equal(captured.headers["chatgpt-account-id"], "user-wire");
  assert.equal(captured.headers["originator"], "pi");
  assert.equal(captured.headers["openai-beta"], "responses=experimental");
  assert.equal(captured.headers["content-type"], "application/json");
  assert.equal(captured.headers["accept"], "text/event-stream");
  assert.ok(captured.headers["user-agent"], "user-agent present");

  const body = JSON.parse(
    captured.headers["content-encoding"] === "zstd"
      ? zstdDecompressSync(Buffer.from(captured.body)).toString()
      : captured.body,
  );
  assert.equal(body.model, "gpt-5.4");
  assert.equal(body.stream, true);
  assert.equal(body.store, false);
  assert.equal(body.instructions, "You are a test.");
  const input = body.input;
  assert.ok(Array.isArray(input) && input.length > 0);
  assert.equal(input[0].role, "user");
  const tool = body.tools.find((entry) => entry.name === "get_weather");
  assert.ok(tool, "tools sent");
  assert.equal(tool.type, "function");
});

test("Codex native web search replaces only the Harness web_search function", async () => {
  const credential = makeCredential();
  const { adapter } = makeAdapter({ OPENAI_CODEX_OAUTH: JSON.stringify(credential) });
  let captured;
  const { restore } = mockFetch(({ headers, body }) => {
    captured = { headers, body };
    return sseResponse(textStreamEvents("native search"));
  });
  try {
    const chunks = await collectChunks(
      adapter.stream(
        generateOptions({
          tools: [
            { name: "read", description: "Read a file", parameters: { type: "object", properties: {} } },
            { name: "web_search", description: "Search the web", parameters: { type: "object", properties: { query: { type: "string" } } } },
            { name: "bash", description: "Run a command", parameters: { type: "object", properties: {} } },
          ],
        }),
      ),
    );
    assert.equal(chunks.at(-1).reason.kind, "stop");
  } finally {
    restore();
  }
  const body = decodeBody(captured);
  assert.deepEqual(
    body.tools.filter((tool) => tool.type === "function").map((tool) => tool.name),
    ["read", "bash"],
  );
  assert.deepEqual(body.tools.find((tool) => tool.type === "web_search"), {
    type: "web_search",
    external_web_access: true,
  });
});

test("Codex does not inject hosted search when Harness did not expose web_search", async () => {
  const credential = makeCredential();
  const { adapter } = makeAdapter({ OPENAI_CODEX_OAUTH: JSON.stringify(credential) });
  let captured;
  const { restore } = mockFetch(({ headers, body }) => {
    captured = { headers, body };
    return sseResponse(textStreamEvents("ordinary tools"));
  });
  try {
    await collectChunks(adapter.stream(generateOptions({ tools: [{ name: "read", description: "Read", parameters: { type: "object" } }] })));
  } finally {
    restore();
  }
  const body = decodeBody(captured);
  assert.equal(body.tools.some((tool) => tool.type === "web_search"), false);
});

test("nativeWebSearch=false keeps the ordinary web_search function unchanged", async () => {
  const credential = makeCredential();
  const { adapter } = makeAdapter(
    { OPENAI_CODEX_OAUTH: JSON.stringify(credential) },
    async () => {},
    undefined,
    { nativeWebSearch: false },
  );
  let captured;
  const { restore } = mockFetch(({ headers, body }) => {
    captured = { headers, body };
    return sseResponse(textStreamEvents("disabled"));
  });
  try {
    await collectChunks(
      adapter.stream(
        generateOptions({
          tools: [{ name: "web_search", description: "Search", parameters: { type: "object" } }],
        }),
      ),
    );
  } finally {
    restore();
  }
  const body = decodeBody(captured);
  assert.ok(body.tools.some((tool) => tool.type === "function" && tool.name === "web_search"));
  assert.equal(body.tools.some((tool) => tool.type === "web_search"), false);
});

test("Codex search events and final text do not break the stream parser", async () => {
  const credential = makeCredential();
  const { adapter } = makeAdapter({ OPENAI_CODEX_OAUTH: JSON.stringify(credential) });
  const textEvents = textStreamEvents("answer with search");
  textEvents[4].item.content[0].annotations = [
    { type: "url_citation", url: "https://example.com/source", title: "Example source" },
  ];
  const events = [
    textEvents[0],
    { type: "response.web_search_call.in_progress", item_id: "ws_1", output_index: 0 },
    { type: "response.output_item.added", output_index: 0, item: { id: "ws_1", type: "web_search_call", status: "in_progress" } },
    { type: "response.web_search_call.searching", item_id: "ws_1", output_index: 0 },
    { type: "response.web_search_call.completed", item_id: "ws_1", output_index: 0 },
    ...textEvents.slice(1),
  ];
  const { restore } = mockFetch(() => sseResponse(events));
  try {
    const chunks = await collectChunks(
      adapter.stream(
        generateOptions({
          tools: [{ name: "web_search", description: "Search", parameters: { type: "object" } }],
        }),
      ),
    );
    assert.equal(chunks.filter((chunk) => chunk.type === "text-delta").map((chunk) => chunk.text).join(""), "answer with search");
    assert.equal(chunks.at(-1).reason.kind, "stop");
  } finally {
    restore();
  }
});

test("unsupported Codex native search errors use a stable provider code", async () => {
  const credential = makeCredential();
  const { adapter } = makeAdapter({ OPENAI_CODEX_OAUTH: JSON.stringify(credential) });
  const { restore } = mockFetch(() =>
    jsonResponse(400, { error: { message: "web_search is not supported for this model" } }),
  );
  try {
    const chunks = await collectChunks(
      adapter.stream(
        generateOptions({
          tools: [{ name: "web_search", description: "Search", parameters: { type: "object" } }],
        }),
      ),
    );
    assert.equal(chunks.at(-1).reason.failure.code, "CODEX_WEB_SEARCH_UNSUPPORTED");
  } finally {
    restore();
  }
});

test("SSE text stream translates to harness chunks", async () => {
  const credential = makeCredential();
  const { adapter } = makeAdapter({ OPENAI_CODEX_OAUTH: JSON.stringify(credential) });
  const { restore } = mockFetch(() => sseResponse(textStreamEvents("hello world")));
  try {
    const chunks = await collectChunks(adapter.stream(generateOptions()));
    const types = chunks.map((chunk) => chunk.type);
    assert.deepEqual(types, ["block-start", "text-delta", "text-delta", "block-end", "usage", "finish"]);
    const texts = chunks.filter((chunk) => chunk.type === "text-delta").map((chunk) => chunk.text);
    assert.equal(texts.join(""), "hello world");
    const finish = chunks.at(-1);
    assert.equal(finish.reason.kind, "stop");
    const usage = chunks.find((chunk) => chunk.type === "usage").usage;
    assert.equal(usage.inputTokens, 8); // 10 input - 2 cached
    assert.equal(usage.outputTokens, 4);
    assert.equal(usage.cacheReadTokens, 2);
  } finally {
    restore();
  }
});

test("SSE tool-call stream translates to a tool-call block and tool-calls finish", async () => {
  const credential = makeCredential();
  const { adapter } = makeAdapter({ OPENAI_CODEX_OAUTH: JSON.stringify(credential) });
  const { restore } = mockFetch(() => sseResponse(toolCallStreamEvents("get_weather", '{"city":"Paris"}')));
  try {
    const chunks = await collectChunks(adapter.stream(generateOptions()));
    const start = chunks.find((chunk) => chunk.type === "block-start");
    assert.equal(start.blockType, "tool-call");
    const deltas = chunks.filter((chunk) => chunk.type === "tool-call-delta").map((chunk) => chunk.argumentsDelta);
    assert.equal(deltas.join(""), '{"city":"Paris"}');
    const end = chunks.find((chunk) => chunk.type === "block-end");
    assert.equal(end.block.type, "tool-call");
    assert.equal(end.block.name, "get_weather");
    assert.deepEqual(JSON.parse(end.block.arguments), { city: "Paris" });
    const finish = chunks.at(-1);
    assert.equal(finish.reason.kind, "tool-calls");
  } finally {
    restore();
  }
});

test("no stored credential surfaces a MISSING_CREDENTIAL error finish", async () => {
  const { adapter } = makeAdapter();
  const { restore } = mockFetch(() => {
    throw new Error("fetch must not be called without credentials");
  });
  try {
    const chunks = await collectChunks(adapter.stream(generateOptions()));
    const finish = chunks.at(-1);
    assert.equal(finish.type, "finish");
    assert.equal(finish.reason.kind, "error");
    assert.equal(finish.reason.failure.code, "MISSING_CREDENTIAL");
    assert.match(finish.reason.failure.message, /codex login/);
  } finally {
    restore();
  }
});

test("unknown model surfaces an UNKNOWN_MODEL error finish", async () => {
  const credential = makeCredential();
  const { adapter } = makeAdapter({ OPENAI_CODEX_OAUTH: JSON.stringify(credential) });
  const { restore } = mockFetch(() => {
    throw new Error("fetch must not be called for an unknown model");
  });
  try {
    const chunks = await collectChunks(adapter.stream(generateOptions({ model: "no-such-model" })));
    const finish = chunks.at(-1);
    assert.equal(finish.type, "finish");
    assert.equal(finish.reason.kind, "error");
    assert.equal(finish.reason.failure.code, "UNKNOWN_MODEL");
  } finally {
    restore();
  }
});

test("streaming refresh: about-to-expire token is swapped before the request", async () => {
  const credential = makeCredential({ expires: Date.now() + 60_000 });
  const { adapter, store } = makeAdapter();
  // Seed the store after the adapter was built (store is shared).
  await store.modify("openai-codex", async () => credential);
  const oauth = {
    async refresh(current) {
      // The rotated access token must remain a valid JWT: pi-ai derives the
      // account id from it for the chatgpt-account-id header.
      return { ...current, access: makeAccessToken("user-rotated"), expires: Date.now() + 3600_000 };
    },
  };
  const { freshenCredential } = await import("../lib/credentials.js");
  const config = {
    options: () => resolveAdapterOptions({}),
    models: adapter.config.models,
    freshen: () => freshenCredential(store, oauth, 5 * 60_000),
  };
  const refreshedAdapter = new CodexAdapter(config);
  let capturedHeaders;
  const { restore, requests } = mockFetch(({ headers }) => {
    capturedHeaders = headers;
    return sseResponse(textStreamEvents("after refresh"));
  });
  try {
    const chunks = await collectChunks(refreshedAdapter.stream(generateOptions()));
    assert.equal(chunks.at(-1).reason.kind, "stop");
  } finally {
    restore();
  }
  assert.equal(requests.length, 1);
  assert.equal(capturedHeaders["authorization"], `Bearer ${makeAccessToken("user-rotated")}`);
  assert.equal(capturedHeaders["chatgpt-account-id"], "user-rotated");
  const stored = await store.read("openai-codex");
  assert.equal(stored.access, makeAccessToken("user-rotated"));
});

test("usage-limit wording maps to the harness QUOTA code", async () => {
  const credential = makeCredential();
  const { adapter } = makeAdapter({ OPENAI_CODEX_OAUTH: JSON.stringify(credential) });
  // A non-2xx response with the codex friendly usage-limit body.
  const { restore } = mockFetch(() => {
    return jsonResponse(429, {
      error: {
        message: "You have hit your ChatGPT usage limit (plus plan). Try again in ~5 min.",
        code: "usage_limit_reached",
        plan_type: "plus",
        resets_at: Math.floor(Date.now() / 1000) + 300,
      },
    });
  });
  try {
    const chunks = await collectChunks(adapter.stream(generateOptions()));
    const finish = chunks.at(-1);
    assert.equal(finish.type, "finish");
    assert.equal(finish.reason.kind, "error");
    assert.equal(finish.reason.failure.code, "QUOTA");
  } finally {
    restore();
  }
});

test("image content is read from durable attachments and sent as Responses input_image", async () => {
  const credential = makeCredential();
  const imageRef = {
    attachmentId: "img-1",
    mediaType: "image/png",
    bytes: 4,
    width: 1,
    height: 1,
  };
  const attachmentBytes = Uint8Array.from([0, 1, 2, 3]);
  let readRef;
  const attachments = {
    async readImage(ref) {
      readRef = ref;
      return { ref: imageRef, data: attachmentBytes };
    },
  };
  const { adapter } = makeAdapter({ OPENAI_CODEX_OAUTH: JSON.stringify(credential) }, async () => {}, attachments);
  let captured;
  const { restore } = mockFetch(({ headers, body }) => {
    captured = { headers, body };
    return sseResponse(textStreamEvents("image understood"));
  });
  try {
    const options = generateOptions({
      messages: [
        harnessMessage("user", [
          { type: "text", text: "Describe this image." },
          { type: "image", attachment: imageRef },
        ]),
      ],
    });
    const chunks = await collectChunks(adapter.stream(options));
    assert.equal(chunks.at(-1).reason.kind, "stop");
  } finally {
    restore();
  }
  assert.deepEqual(readRef, imageRef);
  const body = JSON.parse(
    captured.headers["content-encoding"] === "zstd"
      ? zstdDecompressSync(Buffer.from(captured.body)).toString()
      : captured.body,
  );
  const user = body.input.find((entry) => entry.role === "user");
  assert.deepEqual(user.content, [
    { type: "input_text", text: "Describe this image." },
    { type: "input_image", detail: "auto", image_url: "data:image/png;base64,AAECAw==" },
  ]);
});

test("image input remains unsupported for text-only Codex models", async () => {
  const credential = makeCredential();
  const attachments = {
    async readImage(ref) {
      return { ref, data: Uint8Array.from([1]) };
    },
  };
  const { adapter } = makeAdapter({ OPENAI_CODEX_OAUTH: JSON.stringify(credential) }, async () => {}, attachments);
  const options = generateOptions({
    model: "gpt-5.3-codex-spark",
    messages: [
      harnessMessage("user", [{ type: "image", attachment: { attachmentId: "img-1", mediaType: "image/png" } }]),
    ],
  });
  const chunks = await collectChunks(adapter.stream(options));
  const finish = chunks.at(-1);
  assert.equal(finish.type, "finish");
  assert.equal(finish.reason.kind, "error");
  assert.equal(finish.reason.failure.code, "UNSUPPORTED_CONTENT");
  assert.match(finish.reason.failure.message, /does not support image input/);
});

/** Decode the (possibly zstd) request body and return its JSON. */

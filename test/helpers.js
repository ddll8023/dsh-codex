/**
 * Shared test helpers for dsh-codex.
 *
 * All tests run against mock HTTP: `globalThis.fetch` is replaced with a
 * scripted handler; no real OpenAI/ChatGPT account is ever contacted. The
 * OAuth browser-flow test binds the real local callback port (127.0.0.1:1455)
 * that pi-ai's flow expects, but only to loop back locally.
 *
 * @module dsh-codex/test-helpers
 */

import { Service } from "@deepseek-ai/cordis";

/** Base64url-encode bytes for a fake JWT. */
function b64url(input) {
  return Buffer.from(input).toString("base64url");
}

/**
 * Build a fake JWT access token carrying the ChatGPT account claim.
 * @param accountId - the account id to embed (default "user-test123").
 * @param extra - extra payload fields (e.g. {exp}).
 * @returns a three-part JWT string.
 */
export function makeAccessToken(accountId = "user-test123", extra = {}) {
  const header = b64url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      ...extra,
      "https://api.openai.com/auth": { chatgpt_account_id: accountId },
    }),
  );
  return `${header}.${payload}.fake-signature`;
}

/** A fake credential record matching what pi-ai stores for codex. */
export function makeCredential(overrides = {}) {
  return {
    type: "oauth",
    access: makeAccessToken(overrides.accountId ?? "user-test123"),
    refresh: "refresh-token-1",
    expires: Date.now() + 3600_000,
    accountId: "accountId" in overrides ? overrides.accountId : "user-test123",
    ...overrides,
  };
}

/** In-memory fake of the harness credentials seam (resolve/set/unset/describe). */
export function fakeCredentialsService(initial = {}) {
  const values = new Map(Object.entries(initial));
  let operations = Promise.resolve();
  return {
    values,
    async resolve(ref) {
      const value = values.get(ref);
      return value === undefined ? undefined : { value, source: "file" };
    },
    async describe(ref) {
      return { configured: values.has(ref), source: "file", writable: true };
    },
    async set(ref, value) {
      const run = operations.then(async () => {
        if (typeof value !== "string" || value.length === 0) throw new Error(`empty value for ${ref}`);
        values.set(ref, value);
      });
      operations = run.catch(() => undefined);
      return run;
    },
    async unset(ref) {
      const run = operations.then(async () => {
        values.delete(ref);
      });
      operations = run.catch(() => undefined);
      return run;
    },
    async write(ref, value) {
      return value === undefined ? this.unset(ref) : this.set(ref, value);
    },
  };
}

/** Minimal fake of the settings service for installSettingsSection. */
export class FakeSettings extends Service {
  static provide = "settings";
  constructor(ctx) {
    super(ctx, "settings");
    this.registrations = new Map();
  }
  register(ns, schema, options) {
    if (this.registrations.has(ns)) throw new Error(`settings namespace "${ns}" already registered`);
    const watchers = new Set();
    const registration = {
      ns,
      schema,
      base: options?.base,
      validate: options?.validate,
      watchers,
      revision: 0,
      resolved: schema(options?.base ?? {}),
    };
    if (registration.validate !== undefined) registration.validate(registration.resolved);
    this.registrations.set(ns, registration);
    const scope = {
      get: () => registration.resolved,
      watch: (callback) => {
        watchers.add(callback);
        return () => watchers.delete(callback);
      },
    };
    return scope;
  }
  /** Simulate a settings write for tests (merge patch over base, re-resolve). */
  update(ns, patch) {
    const registration = this.registrations.get(ns);
    if (registration === undefined) throw new Error(`settings namespace "${ns}" is not registered`);
    const next = registration.schema({ ...registration.base, ...patch });
    registration.validate?.(next);
    registration.resolved = next;
    registration.revision += 1;
    for (const watcher of [...registration.watchers]) watcher(next, registration.resolved);
  }
}

/** Minimal fake of the commands registry. */
export function fakeCommandsService() {
  const definitions = new Map();
  return {
    register(definition) {
      if (definitions.has(definition.name)) throw new Error(`command "${definition.name}" already registered`);
      definitions.set(definition.name, definition);
      return () => definitions.delete(definition.name);
    },
    list() {
      return [...definitions.values()];
    },
    find(name) {
      return definitions.get(name);
    },
    definitions,
  };
}

/**
 * Replace `globalThis.fetch` with a scripted handler for the duration of a
 * test. Returns a spy recording every request. When the handler returns
 * `undefined`, the request falls through to the original fetch (used to let
 * local loopback calls — e.g. the OAuth callback server — bypass the mock).
 * @param handler - (url, init) => Response | undefined | Promise<Response | undefined>.
 * @returns { requests, restore } - recorded {url, init, headers} and the restore fn.
 */
export function mockFetch(handler) {
  const requests = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    const rawHeaders = init?.headers;
    const headerEntries =
      typeof rawHeaders?.entries === "function"
        ? [...rawHeaders.entries()]
        : Object.entries(rawHeaders ?? {});
    const headers = Object.fromEntries(headerEntries.map(([key, value]) => [key.toLowerCase(), String(value)]));
    const request = { url, init, headers, body: init?.body };
    requests.push(request);
    const result = await handler(request);
    if (result !== undefined) return result;
    return original(input, init);
  };
  return {
    requests,
    restore() {
      globalThis.fetch = original;
    },
  };
}

/** Build a fetch Response-like with the given status and JSON body. */
export function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Build a streaming Response whose body is SSE text.
 * @param events - array of event objects (JSON-encoded as `data:` lines).
 * @param status - HTTP status (default 200).
 */
export function sseResponse(events, status = 200) {
  const text = events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("");
  return new Response(text, {
    status,
    headers: { "content-type": "text/event-stream" },
  });
}

/** Responses-API SSE events for a plain text completion. */
export function textStreamEvents(text, usage, responseId = "resp_test") {
  return [
    { type: "response.created", response: { id: responseId } },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { id: "msg_1", type: "message", role: "assistant", content: [] },
    },
    { type: "response.output_text.delta", output_index: 0, delta: text.slice(0, Math.ceil(text.length / 2)) },
    { type: "response.output_text.delta", output_index: 0, delta: text.slice(Math.ceil(text.length / 2)) },
    {
      type: "response.output_item.done",
      output_index: 0,
      item: { id: "msg_1", type: "message", role: "assistant", content: [{ type: "output_text", text }] },
    },
    {
      type: "response.completed",
      response: {
        id: responseId,
        status: "completed",
        usage: {
          input_tokens: 10,
          output_tokens: 4,
          total_tokens: 14,
          input_tokens_details: { cached_tokens: 2 },
          output_tokens_details: {},
        },
      },
    },
  ];
}

/** Responses-API SSE events for one function-call (tool) completion. */
export function toolCallStreamEvents(name, argsJson, responseId = "resp_tool") {
  const callId = `call_abc`;
  return [
    { type: "response.created", response: { id: responseId } },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { id: "fc_1", type: "function_call", call_id: callId, name, arguments: "" },
    },
    { type: "response.function_call_arguments.delta", output_index: 0, delta: argsJson.slice(0, Math.ceil(argsJson.length / 2)) },
    { type: "response.function_call_arguments.delta", output_index: 0, delta: argsJson.slice(Math.ceil(argsJson.length / 2)) },
    {
      type: "response.function_call_arguments.done",
      output_index: 0,
      arguments: argsJson,
    },
    {
      type: "response.output_item.done",
      output_index: 0,
      item: { id: "fc_1", type: "function_call", call_id: callId, name, arguments: argsJson },
    },
    {
      type: "response.completed",
      response: {
        id: responseId,
        status: "completed",
        usage: {
          input_tokens: 5,
          output_tokens: 3,
          total_tokens: 8,
          input_tokens_details: {},
          output_tokens_details: {},
        },
      },
    },
  ];
}

/**
 * Collect an async iterable of harness chunks, normalizing an adapter throw
 * into a terminal error/aborted finish chunk exactly like LlmRuntime does.
 */
export async function collectChunks(iterable, signal) {
  const chunks = [];
  try {
    for await (const chunk of iterable) chunks.push(chunk);
  } catch (error) {
    const failure = {
      message: error instanceof Error ? error.message : String(error),
      code: typeof error?.code === "string" ? error.code : "UNKNOWN",
    };
    chunks.push({
      type: "finish",
      reason:
        signal?.aborted || failure.code === "ABORTED"
          ? { kind: "aborted", failure }
          : { kind: "error", failure },
    });
  }
  return chunks;
}

/** A tiny harness message for adapter tests. */
export function harnessMessage(role, content, source) {
  return {
    role,
    content,
    id: `test-${role}-${Math.random().toString(36).slice(2)}`,
    source: source ?? { kind: "user" },
  };
}

/** Build GenerateOptions for adapter tests. */
export function generateOptions(overrides = {}) {
  return {
    provider: "openai-codex",
    model: "gpt-5.4",
    messages: [harnessMessage("user", [{ type: "text", text: "hello codex" }])],
    system: "You are a test.",
    tools: [{ name: "get_weather", description: "Get weather", parameters: { type: "object", properties: {} } }],
    ...overrides,
  };
}

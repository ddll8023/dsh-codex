import test from "node:test";
import assert from "node:assert/strict";
import { Context } from "@deepseek-ai/cordis";
import LlmRuntime from "@deepseek-ai/dsh-llm";
import { Session } from "@deepseek-ai/dsh-session";
import SessionProjectionRegistry from "@deepseek-ai/dsh-session-projection";
import { updatePluginConfig, fakeCommandsService, fakeCredentialsService, jsonResponse, mockFetch, sseResponse, textStreamEvents, makeCredential } from "./helpers.js";
import * as plugin from "../lib/index.js";

/** Boot a minimal harness app with the dsh-codex plugin mounted. */
async function bootApp(config = {}) {
  const app = new Context();
  new LlmRuntime(app); // provides ctx.llm (the public provider registry)
  new SessionProjectionRegistry(app);
  const credentials = fakeCredentialsService();
  app.provide("credentials", credentials);
  const commands = fakeCommandsService();
  app.provide("commands", commands);
  const fiber = app.plugin(plugin, config);
  await fiber;
  return { app, fiber, credentials, commands };
}

test("plugin load registers the openai-codex provider and commands", async () => {
  const { app, commands } = await bootApp();
  try {
    const providers = app.llm.listProviders();
    assert.ok(providers.some((entry) => entry.id === "openai-codex"), "openai-codex route registered");
    const configurable = app.llm.listConfigurableProviders();
    assert.ok(
      configurable.some((entry) => entry.provider === "openai-codex" && entry.settingsNs === "llm-codex"),
      "configurable-provider directory entry present",
    );
    const models = await app.llm.listModels("openai-codex");
    assert.ok(models.length >= 5, "codex models advertised to the model picker");
    const info = await app.llm.resolveModelInfo("openai-codex", "gpt-5.4");
    assert.equal(info.context.contextWindow, 272000);

    const codex = commands.find("codex");
    assert.ok(codex, "/codex command registered");
    assert.equal(codex.recordInput, false);
    const result = await codex.handler({
      commandId: "c1",
      agent: {},
      rawInput: " status",
      signal: new AbortController().signal,
    });
    assert.equal(result.kind, "success");
    assert.match(result.text, /not logged in/);
  } finally {
    await app.fiber.dispose();
  }
});

test("plugin reuses a predeclared catalog directory on newer Harness", async () => {
  const app = new Context();
  const runtime = new LlmRuntime(app);
  runtime.registerConfigurableProviders([{
    provider: "openai-codex",
    displayName: "OpenAI Codex",
    settingsNs: "llm-pi-ai",
    settingsPath: ["providers", "openai-codex"],
    declared: false,
  }]);
  app.provide("credentials", fakeCredentialsService());
  const commands = fakeCommandsService();
  app.provide("commands", commands);
  await app.plugin(plugin, {});
  try {
    assert.ok(app.llm.listProviders().some((entry) => entry.id === "openai-codex"), "OAuth adapter route registered");
    const configurable = app.llm.listConfigurableProviders();
    assert.equal(configurable.filter((entry) => entry.provider === "openai-codex").length, 1);
    assert.equal(configurable.find((entry) => entry.provider === "openai-codex").settingsNs, "llm-pi-ai");
    assert.ok(commands.find("codex"), "plugin login command remains registered");
  } finally {
    await app.fiber.dispose();
  }
});

test("/codex speed persists and reports the session speed", async () => {
  const { app, commands } = await bootApp();
  try {
    const session = Session.create("plugin-speed");
    const initialSeq = session.seq;
    const codex = commands.find("codex");
    const invoke = (rawInput) => codex.handler({
      commandId: "speed-1",
      agent: { session },
      rawInput,
      signal: new AbortController().signal,
    });

    let result = await invoke(" speed");
    assert.equal(result.kind, "success");
    assert.match(result.text, /Standard/);

    result = await invoke(" speed fast");
    assert.equal(result.kind, "success");
    assert.match(result.text, /Fast/);
    assert.equal(session.events, undefined, "the Host no longer exposes Session.events");
    assert.deepEqual(session.snapshotEvents().filter((event) => event.type === "codex/speed").map(({ type, data }) => ({ type, data })),
      [{ type: "codex/speed", data: { speed: "fast" } }]);

    result = await invoke(" speed");
    assert.equal(result.kind, "success");
    assert.match(result.text, /Fast/);

    result = await invoke(" speed fast");
    assert.equal(session.seq, initialSeq + 1, "repeating the same speed does not append another event");
    assert.equal(result.kind, "success");
  } finally {
    await app.fiber.dispose();
  }
});

test("Fast projection drives only Codex request service tier and survives session restore", async () => {
  const { app, fiber, commands } = await bootApp();
  try {
    let session = Session.create("request-speed");
    const codex = commands.find("codex");
    const setSpeed = (speed) => codex.handler({
      commandId: "set-speed", agent: { session }, rawInput: ` speed ${speed}`, signal: new AbortController().signal,
    });
    const request = (base) => fiber.ctx.waterfall("agent/request", { agent: { session } }, async () => base);
    assert.equal((await setSpeed("fast")).kind, "success");
    const fast = await request({ provider: "openai-codex", model: "gpt-5.4" });
    assert.equal(fast.codexServiceTier, "priority");
    session = Session.create(session.id, session.snapshotEvents(), session.header, session.inheritedEventCount);
    assert.equal((await request({ provider: "openai-codex" })).codexServiceTier, "priority");
    const foreign = { provider: "deepseek", model: "deepseek-chat" };
    assert.equal(await request(foreign), foreign);
    assert.equal((await setSpeed("standard")).kind, "success");
    assert.equal("codexServiceTier" in await request({ provider: "openai-codex", codexServiceTier: "priority" }), false);
  } finally {
    await app.fiber.dispose();
  }
});

test("plugin unload removes the provider route and leaves nothing behind", async () => {
  const app = new Context();
  const runtime = new LlmRuntime(app); // keep the instance to inspect the registry after disposal
  app.provide("credentials", fakeCredentialsService());
  app.provide("commands", fakeCommandsService());
  await app.plugin(plugin, {});
  assert.ok(app.llm.listProviders().some((entry) => entry.id === "openai-codex"));
  await app.fiber.dispose();
  assert.equal(runtime.adapters.has("openai-codex"), false, "adapter route disposed");
  assert.equal(runtime.directory.has("openai-codex"), false, "configurable-provider entry disposed");
});

test("plugin registration and unload never mutate the Harness Web Runtime", async () => {
  const app = new Context();
  new LlmRuntime(app);
  const webRuntime = { searchProvider: "exa", fetchProvider: "http", marker: "unchanged" };
  app.provide("web", webRuntime);
  app.provide("credentials", fakeCredentialsService());
  app.provide("commands", fakeCommandsService());
  await app.plugin(plugin, {});
  assert.equal(app.get("web"), webRuntime);
  assert.deepEqual(webRuntime, { searchProvider: "exa", fetchProvider: "http", marker: "unchanged" });
  await app.fiber.dispose();
  assert.deepEqual(webRuntime, { searchProvider: "exa", fetchProvider: "http", marker: "unchanged" });
});

test("a full model call streams through the real llm service", async () => {
  const credential = makeCredential();
  const { app } = await bootApp();
  try {
    await app
      .get("credentials")
      .set("OPENAI_CODEX_OAUTH", JSON.stringify(credential));
    const { restore } = mockFetch(() => sseResponse(textStreamEvents("plugin stream hello")));
    try {
      const chunks = [];
      for await (const chunk of app.llm.stream({
        provider: "openai-codex",
        model: "gpt-5.4",
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "ping" }],
            id: "m1",
            source: { kind: "user" },
          },
        ],
      })) {
        chunks.push(chunk);
      }
      const texts = chunks.filter((chunk) => chunk.type === "text-delta").map((chunk) => chunk.text);
      assert.equal(texts.join(""), "plugin stream hello");
      const finish = chunks.at(-1);
      assert.equal(finish.type, "finish");
      assert.equal(finish.reason.kind, "stop");
    } finally {
      restore();
    }
  } finally {
    await app.fiber.dispose();
  }
});

test("volatile config change re-resolves connection facts without restart", async () => {
  const { app, fiber } = await bootApp({ baseURL: "https://chatgpt.com/backend-api" });
  try {
    const credential = makeCredential();
    await app.get("credentials").set("OPENAI_CODEX_OAUTH", JSON.stringify(credential));
    let capturedUrl;
    const { restore } = mockFetch(({ url }) => {
      capturedUrl = url;
      return sseResponse(textStreamEvents("ok"));
    });
    try {
      const chunks = [];
      for await (const chunk of app.llm.stream({
        provider: "openai-codex",
        model: "gpt-5.4",
        messages: [{ role: "user", content: [{ type: "text", text: "x" }], id: "m2", source: { kind: "user" } }],
      })) {
        chunks.push(chunk);
      }
      assert.equal(chunks.at(-1).reason.kind, "stop");
      assert.equal(capturedUrl, "https://chatgpt.com/backend-api/codex/responses");
      updatePluginConfig(fiber, { baseURL: "https://codex.example/backend-api" });
      const updated = [];
      for await (const chunk of app.llm.stream({
        provider: "openai-codex",
        model: "gpt-5.4",
        messages: [{ role: "user", content: [{ type: "text", text: "again" }], id: "m3", source: { kind: "user" } }],
      })) updated.push(chunk);
      assert.equal(updated.at(-1).reason.kind, "stop");
      assert.equal(capturedUrl, "https://codex.example/backend-api/codex/responses");
    } finally {
      restore();
    }
  } finally {
    await app.fiber.dispose();
  }
});

test("invalid volatile config is rejected before the last good snapshot changes", async () => {
  const { app, fiber } = await bootApp();
  try {
    const previous = fiber.config.get();
    const registration = app.llm.adapters.get("openai-codex");
    assert.throws(() => updatePluginConfig(fiber, { baseURL: "" }), /baseURL must not be empty/);
    assert.throws(() => updatePluginConfig(fiber, { modelCatalogClientVersion: "invalid" }), /major.minor.patch/);
    assert.equal(fiber.config.get(), previous);
    assert.equal(app.llm.adapters.get("openai-codex"), registration);
  } finally {
    await app.fiber.dispose();
  }
});

test("volatile retry policy changes refresh the existing adapter registration", async () => {
  const { app, fiber } = await bootApp({ retryPolicy: { mode: "normal", maxRetries: 2 } });
  try {
    const previous = app.llm.adapters.get("openai-codex");
    updatePluginConfig(fiber, { retryPolicy: { mode: "normal", maxRetries: 5 } });
    const current = app.llm.adapters.get("openai-codex");
    assert.equal(current.adapter, previous.adapter, "no plugin remount");
    assert.equal(current.retryPolicy.maxRetries, 5);
    assert.notEqual(current, previous, "registration facts refreshed");
    updatePluginConfig(fiber, { transport: "auto" });
    assert.equal(app.llm.adapters.get("openai-codex"), current, "unchanged policy does not replace registration");
  } finally {
    await app.fiber.dispose();
  }
});

test("/codex usage reports the quota when logged in and asks for login otherwise", async () => {
  const { app, credentials } = await bootApp();
  try {
    const codex = app.get("commands").find("codex");
    const invoke = (rawInput) =>
      codex.handler({ commandId: "c2", agent: {}, rawInput, signal: new AbortController().signal });

    // Not logged in: no network call, explicit guidance.
    let calls = 0;
    const { restore } = mockFetch(() => {
      calls += 1;
      return jsonResponse(500, {});
    });
    let result;
    try {
      result = await invoke(" usage");
    } finally {
      restore();
    }
    assert.equal(result.kind, "error");
    assert.match(result.text, /not logged in/);
    assert.equal(calls, 0, "no usage request without a credential");

    // Logged in: quota line comes back from wham/usage.
    await credentials.set("OPENAI_CODEX_OAUTH", JSON.stringify(makeCredential({ accountId: "user-cli" })));
    const { restore: restore2 } = mockFetch(({ url }) => {
      if (url === "https://chatgpt.com/backend-api/wham/usage") {
        return jsonResponse(200, {
          plan_type: "pro",
          rate_limit: {
            primary_window: { used_percent: 61, limit_window_seconds: 18000, reset_at: "2026-08-17T03:00:00Z" },
            secondary_window: { used_percent: 5, limit_window_seconds: 604800, reset_at: "2026-08-18T00:00:00Z" },
          },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    try {
      result = await invoke(" usage");
    } finally {
      restore2();
    }
    assert.equal(result.kind, "success");
    assert.match(result.text, /^Usage: \[pro\]/);
    assert.match(result.text, /5h 61% \(reset/);
  } finally {
    await app.fiber.dispose();
  }
});

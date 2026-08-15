import test from "node:test";
import assert from "node:assert/strict";
import { Context } from "@deepseek-ai/cordis";
import LlmRuntime from "@deepseek-ai/dsh-llm";
import { FakeSettings, fakeCommandsService, fakeCredentialsService, mockFetch, sseResponse, textStreamEvents, makeCredential } from "./helpers.js";
import * as plugin from "../lib/index.js";

/** Boot a minimal harness app with the dsh-codex plugin mounted. */
async function bootApp(config = {}) {
  const app = new Context();
  new LlmRuntime(app); // provides ctx.llm (the public provider registry)
  new FakeSettings(app); // provides ctx.settings
  const credentials = fakeCredentialsService();
  app.provide("credentials", credentials);
  const commands = fakeCommandsService();
  app.provide("commands", commands);
  await app.plugin(plugin, config);
  return { app, credentials, commands };
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

test("plugin unload removes the provider route and leaves nothing behind", async () => {
  const app = new Context();
  const runtime = new LlmRuntime(app); // keep the instance to inspect the registry after disposal
  new FakeSettings(app);
  app.provide("credentials", fakeCredentialsService());
  app.provide("commands", fakeCommandsService());
  await app.plugin(plugin, {});
  assert.ok(app.llm.listProviders().some((entry) => entry.id === "openai-codex"));
  await app.fiber.dispose();
  assert.equal(runtime.adapters.has("openai-codex"), false, "adapter route disposed");
  assert.equal(runtime.directory.has("openai-codex"), false, "configurable-provider entry disposed");
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

test("settings change re-resolves connection facts without restart", async () => {
  const { app } = await bootApp({ baseURL: "https://chatgpt.com/backend-api" });
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
    } finally {
      restore();
    }
  } finally {
    await app.fiber.dispose();
  }
});

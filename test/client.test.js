import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packagePath = resolve(dirname(fileURLToPath(import.meta.url)), "../package.json");

function loadClientModule() {
  const loaded = [];
  const previousWindow = globalThis.window;
  const clientWindow = { __ModuleLoader__: { load: (entry) => loaded.push(entry) } };
  globalThis.window = clientWindow;
  return import(`../lib/client.js?test=${Date.now()}-${Math.random()}`).then(() => {
    globalThis.window = previousWindow;
    assert.equal(loaded.length, 1);
    const entry = loaded[0];
    const exports = entry.factory((name) => {
      if (name === "react") {
        return {
          createElement: () => null,
          useEffect: () => {},
          useLayoutEffect: () => {},
          useRef: () => ({ current: null }),
          useState: () => [false, () => {}],
          useSyncExternalStore: () => ({ current: null }),
        };
      }
      if (name === "@deepseek-ai/dsh-client-ui-primitives") {
        return {
          Menu: () => null,
          IconChevronDownOutline14: () => null,
        };
      }
      throw new Error(`unexpected client bundle dependency: ${name}`);
    });
    return { entry, exports, clientWindow };
  }, (error) => {
    globalThis.window = previousWindow;
    throw error;
  });
}

test("Codex client bundle declares the Web UI contribution", async () => {
  const { entry, exports } = await loadClientModule();
  assert.equal(entry.id, "dsh-codex");
  assert.ok(exports.inject.includes("slots"));
  assert.ok(exports.inject.includes("remote"));
  assert.ok(exports.inject.includes("remote.commands"));
  assert.ok(exports.inject.includes("locale"));
  assert.ok(exports.inject.includes("commandUi"));
  assert.equal(typeof exports.apply, "function");

  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  assert.ok(packageJson.dsh.client.inject.includes("@deepseek-ai/dsh-client-ui-commands"));
  assert.equal(packageJson.peerDependencies?.["@deepseek-ai/dsh-client-ui-commands"], "^0.0.1-rc.3");
});

test("only a successful browser /codex login opens the authorization URL", async () => {
  const { exports, clientWindow } = await loadClientModule();
  const listeners = new Map();
  const scope = {
    on: (name, listener) => listeners.set(name, listener),
    effect: () => {},
    locale: { register: () => {}, bind: () => (key) => key },
    remote: {
      $mount: async () => async () => {},
      commands: { execute: async () => ({ ok: true }) },
    },
    get: (name) => {
      if (name === "remote.codexUsage") return { get: async () => ({ ok: true, value: { status: "not_logged_in" } }) };
      if (name === "remote.codexAccount") return { getStatus: async () => ({ ok: true, value: { loggedIn: false } }) };
      return undefined;
    },
    slots: { inject: () => {} },
  };
  const context = { inject: async (_dependencies, callback) => callback(scope) };
  const previousWindow = globalThis.window;
  const opened = [];
  const authUrl = "https://auth.openai.com/oauth/authorize?client_id=test";
  const browserLoginText =
    "OpenAI Codex login started (authorization code + PKCE).\n" +
    "Open this URL in your browser and complete login:\n" +
    `${authUrl}\nThe callback is http://localhost:1455/auth/callback.`;
  clientWindow.open = (...args) => { opened.push(args); return {}; };
  globalThis.window = clientWindow;
  try {
    await exports.apply(context);
    const onExecuted = listeners.get("command/executed");
    assert.equal(typeof onExecuted, "function");

    onExecuted("session-1", "codex", { kind: "success", text: "OpenAI Codex device-code login started." });
    onExecuted("session-1", "codex", { kind: "success", text: `Login in progress. Open: ${authUrl}` });
    onExecuted("session-1", "other", { kind: "success", text: browserLoginText });
    onExecuted("session-1", "codex", { kind: "error", text: browserLoginText });
    onExecuted("session-1", "codex", { kind: "success", text: browserLoginText.replace(authUrl, "https://example.com/login") });
    assert.deepEqual(opened, []);

    onExecuted("session-1", "codex", { kind: "success", text: browserLoginText });
    assert.deepEqual(opened, [[authUrl, "_blank", "noopener"]]);
  } finally {
    globalThis.window = previousWindow;
  }
});

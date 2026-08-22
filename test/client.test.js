import test from "node:test";
import assert from "node:assert/strict";

function loadClientModule() {
  const loaded = [];
  const previousWindow = globalThis.window;
  globalThis.window = { __ModuleLoader__: { load: (entry) => loaded.push(entry) } };
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
    return { entry, exports };
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
  assert.equal(typeof exports.apply, "function");
});

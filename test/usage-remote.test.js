import test from "node:test";
import assert from "node:assert/strict";
import { Context } from "@deepseek-ai/cordis";
import { remoteMethods } from "@deepseek-ai/dsh-typert-protocol";
import { CodexUsageService } from "../lib/usage-remote.js";

test("Codex usage Remote exposes a token-free get method", async () => {
  const app = new Context();
  try {
    await app.plugin(CodexUsageService, {
      readUsage: async () => ({
        status: "ok",
        planLabel: "plus",
        windows: [{ label: "5h", percentage: 43, nextResetAt: 1_700_000_000_000 }],
        fetchedAt: 1_700_000_000_000,
      }),
    });
    const service = app.get("codexUsage");
    assert.equal(typeof service.get, "function");
    assert.deepEqual(remoteMethods(service).map((entry) => entry.method), ["get"]);
    assert.deepEqual(await service.get(), {
      status: "ok",
      planLabel: "plus",
      windows: [{ label: "5h", percentage: 43, nextResetAt: 1_700_000_000_000 }],
      fetchedAt: 1_700_000_000_000,
    });
  } finally {
    await app.fiber.dispose();
  }
});

test("Codex usage Remote rejects construction without a reader", () => {
  const app = new Context();
  try {
    assert.throws(() => new CodexUsageService(app), /requires a readUsage function/);
  } finally {
    void app.fiber.dispose();
  }
});

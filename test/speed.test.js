import test from "node:test";
import assert from "node:assert/strict";
import {
  codexSpeedProjection,
  DEFAULT_SPEED,
  FAST_MODE_SERVICE_TIER,
  normalizeSpeed,
  setAgentSpeed,
  speedFromEvents,
} from "../lib/speed.js";

test("Codex speed defaults to Standard and folds the latest valid event", () => {
  assert.equal(speedFromEvents([]), undefined);
  assert.equal(normalizeSpeed(undefined), undefined);
  assert.equal(normalizeSpeed(" default "), "standard");
  assert.equal(normalizeSpeed("FAST"), "fast");
  assert.equal(normalizeSpeed("turbo"), undefined);
  assert.equal(
    speedFromEvents([
      { type: "codex/speed", data: { speed: "fast" } },
      { type: "other/event", data: {} },
      { type: "codex/speed", data: { speed: "standard" } },
    ]),
    "standard",
  );
  assert.equal(DEFAULT_SPEED, "standard");
  assert.equal(FAST_MODE_SERVICE_TIER, "priority");
});

test("Codex speed projection exposes stable Standard/Fast options", () => {
  const state = codexSpeedProjection.init();
  assert.deepEqual(codexSpeedProjection.view(state), {
    currentValue: "standard",
    options: [
      { value: "standard", name: "Standard" },
      { value: "fast", name: "Fast" },
    ],
  });
  const next = codexSpeedProjection.apply(state, { type: "codex/speed", data: { speed: "fast" } });
  assert.equal(codexSpeedProjection.view(next).currentValue, "fast");
  assert.equal(codexSpeedProjection.apply(next, { type: "other/event", data: {} }), next);
  assert.throws(
    () => codexSpeedProjection.schema.parse({ currentValue: "turbo", options: [] }),
    /invalid currentValue|invalid shape/,
  );
});

test("setAgentSpeed persists only actual speed changes", () => {
  const events = [];
  const agent = {
    session: {
      events,
      append(type, data) {
        events.push({ type, data });
      },
    },
  };
  assert.equal(setAgentSpeed(agent, "fast"), "fast");
  assert.deepEqual(events, [{ type: "codex/speed", data: { speed: "fast" } }]);
  assert.equal(setAgentSpeed(agent, "fast"), "fast");
  assert.equal(events.length, 1);
  assert.equal(setAgentSpeed(agent, "default"), "standard");
  assert.deepEqual(events.at(-1), { type: "codex/speed", data: { speed: "standard" } });
  assert.throws(() => setAgentSpeed(agent, "turbo"), /must be standard or fast/);
});

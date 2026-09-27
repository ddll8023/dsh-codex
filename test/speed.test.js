/** 新版 Session 投影、会话查询和 Fast 状态契约测试。 */
import test from "node:test";
import assert from "node:assert/strict";
import { Context } from "@deepseek-ai/cordis";
import { Session } from "@deepseek-ai/dsh-session";
import SessionProjectionRegistry from "@deepseek-ai/dsh-session-projection";
import {
  codexSpeedProjection, DEFAULT_SPEED, FAST_MODE_SERVICE_TIER,
  normalizeSpeed, readAgentSpeed, setAgentSpeed, speedFromEvents,
} from "../lib/speed.js";

test("Codex speed defaults to Standard and folds the latest valid event", () => {
  assert.equal(speedFromEvents([]), undefined);
  assert.equal(normalizeSpeed(undefined), undefined);
  assert.equal(normalizeSpeed(" default "), "standard");
  assert.equal(normalizeSpeed("FAST"), "fast");
  assert.equal(normalizeSpeed("turbo"), undefined);
  assert.equal(speedFromEvents([
    { type: "codex/speed", data: { speed: "fast" } },
    { type: "other/event", data: {} },
    { type: "codex/speed", data: { speed: "standard" } },
  ]), "standard");
  assert.equal(DEFAULT_SPEED, "standard");
  assert.equal(FAST_MODE_SERVICE_TIER, "priority");
});

test("speed projection declares state and wire schemas required by the Host", () => {
  const state = codexSpeedProjection.init();
  assert.deepEqual(codexSpeedProjection.stateSchema.parse(state), { speed: "standard" });
  assert.deepEqual(codexSpeedProjection.wire.view(state), {
    currentValue: "standard",
    options: [{ value: "standard", name: "Standard" }, { value: "fast", name: "Fast" }],
  });
  const next = codexSpeedProjection.apply(state, { type: "codex/speed", data: { speed: "fast" } });
  assert.equal(codexSpeedProjection.wire.view(next).currentValue, "fast");
  assert.equal(codexSpeedProjection.apply(next, { type: "other/event", data: {} }), next);
  assert.throws(() => codexSpeedProjection.stateSchema.parse({ speed: "turbo" }), /invalid shape/);
  assert.throws(() => codexSpeedProjection.wire.viewSchema.parse({ currentValue: "turbo", options: [] }), /invalid shape/);
});

test("real Host projection reads speed without Session.events and restores it from history", async () => {
  const app = new Context();
  const projections = new SessionProjectionRegistry(app);
  projections.register(codexSpeedProjection);
  const session = Session.create("speed-test");
  const agent = { session };
  const services = { sessionProjections: projections };
  try {
    assert.equal(session.events, undefined);
    assert.equal(await readAgentSpeed(agent, services), "standard");
    const before = session.seq;
    assert.equal(await setAgentSpeed(agent, "fast", services), "fast");
    assert.equal(session.seq, before + 1);
    assert.equal(await setAgentSpeed(agent, "fast", services), "fast");
    assert.equal(session.seq, before + 1, "repeated speed does not append another event");
    assert.equal(projections.snapshot(session).values.codexSpeed.currentValue, "fast");
    const restored = Session.create(session.id, session.snapshotEvents(), session.header, session.inheritedEventCount);
    assert.equal(await readAgentSpeed({ session: restored }, services), "fast");
    assert.equal(await setAgentSpeed(agent, "default", services), "standard");
    await assert.rejects(setAgentSpeed(agent, "turbo", services), /must be standard or fast/);
  } finally {
    await app.fiber.dispose();
  }
});

test("missing projection falls back to the public session query", async () => {
  const events = [{ type: "codex/speed", data: { speed: "fast" } }];
  const session = { id: "query-session", append(type, data) { events.push({ type, data }); } };
  const services = { sessionQuery: {
    async readSession(id) {
      assert.equal(id, session.id);
      return { events: structuredClone(events) };
    },
  } };
  assert.equal(await readAgentSpeed({ session }, services), "fast");
  await setAgentSpeed({ session }, "standard", services);
  assert.equal(await readAgentSpeed({ session }, services), "standard");
});

test("unavailable or broken state services fail rather than silently resetting speed", async () => {
  const agent = { session: { id: "missing" } };
  await assert.rejects(readAgentSpeed(agent), /sessionProjections or sessionQuery/);
  await assert.rejects(readAgentSpeed(agent, { sessionQuery: {
    async readSession() { throw new Error("query failed"); },
  } }), /query failed/);
  await assert.rejects(readAgentSpeed(agent, { sessionProjections: {
    stateOf() { return { speed: "turbo" }; },
  } }), /invalid shape/);
});

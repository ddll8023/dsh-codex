/** 验证新版回放信封及 Host 截断工具调用后的元数据对齐。 */
import test from "node:test";
import assert from "node:assert/strict";
import { BlockAssembler } from "@deepseek-ai/dsh-llm";
import { readReplayState, toPiAssistant, toReplayState } from "../lib/replay.js";

/** 构造同时携带文本、推理和工具调用签名的 pi-ai 响应。 */
function response() {
  return {
    api: "openai-codex-responses",
    provider: "openai-codex",
    model: "gpt-5.4",
    responseModel: "gpt-5.4-resolved",
    responseId: "resp-test",
    stopReason: "toolUse",
    content: [
      { type: "text", text: "hello", textSignature: "text-signature" },
      { type: "thinking", thinking: "reason", thinkingSignature: "reason-signature", redacted: false },
      { type: "toolCall", id: "call-1", name: "weather", arguments: { city: "Paris" }, thoughtSignature: "tool-signature" },
    ],
  };
}

/** 构造对应的持久化 assistant 消息，附加插件自己的回放信封。 */
function history(native = response()) {
  return {
    role: "assistant",
    source: { kind: "model", provider: native.provider, model: native.model, replayState: toReplayState(native) },
    content: [
      { type: "text", text: "hello" },
      { type: "reasoning", text: "reason" },
      { type: "tool-call", id: "call-1", name: "weather", arguments: '{"city":"Paris"}' },
    ],
  };
}

test("replay envelope separates response metadata from per-block metadata", () => {
  const envelope = toReplayState(response());
  assert.deepEqual(Object.keys(envelope), ["response", "blocks"]);
  assert.equal(envelope.response.version, 2);
  assert.equal(envelope.response.responseId, "resp-test");
  assert.equal(envelope.blocks.length, 3);
  assert.equal(readReplayState(envelope), envelope);
});

test("assistant history round trip preserves response identity and signatures", () => {
  const native = response();
  const replayed = toPiAssistant(history(native));
  assert.deepEqual(replayed.content, native.content);
  for (const key of ["api", "provider", "model", "responseModel", "responseId", "stopReason"]) {
    assert.equal(replayed[key], native[key]);
  }
});

test("Host max-token truncation retains response metadata and aligned block signatures", () => {
  const native = response();
  native.stopReason = "length";
  const message = history(native);
  const assembler = new BlockAssembler();
  for (const [index, block] of message.content.entries()) {
    assembler.push({ type: "block-start", index, blockType: block.type });
    assembler.push({ type: "block-end", index, block });
  }
  assembler.push({ type: "finish", reason: { kind: "max-tokens" }, replayState: message.source.replayState });
  const saved = assembler.message({ provider: native.provider, model: native.model, replayState: assembler.replayState });
  assert.deepEqual(saved.content.map((block) => block.type), ["text", "reasoning"]);
  assert.equal(saved.source.replayState.response.responseId, "resp-test");
  assert.equal(saved.source.replayState.blocks.length, 2);
  assert.deepEqual(toPiAssistant(saved).content, native.content.slice(0, 2));
});

test("invalid envelope, identity mismatch and block mismatch fail explicitly", () => {
  const native = response();
  assert.throws(() => readReplayState({ kind: "pi-ai", version: 1, blocks: [] }), { code: "INVALID_REPLAY_STATE" });
  assert.throws(() => readReplayState({ response: null, blocks: [] }), { code: "INVALID_REPLAY_STATE" });
  const wrongVersion = toReplayState(native);
  wrongVersion.response.version = 999;
  assert.throws(() => readReplayState(wrongVersion), { code: "INVALID_REPLAY_STATE" });
  const wrongIdentity = history(native);
  wrongIdentity.source.model = "different-model";
  assert.throws(() => toPiAssistant(wrongIdentity), { code: "INVALID_REPLAY_STATE" });
  const wrongBlocks = history(native);
  wrongBlocks.content.pop();
  assert.throws(() => toPiAssistant(wrongBlocks), { code: "INVALID_REPLAY_STATE" });
});

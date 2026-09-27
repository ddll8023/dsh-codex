/** DSH 新版消息角色到 pi-ai 历史的契约测试；不发起网络请求。 */
import test from "node:test";
import assert from "node:assert/strict";
import { toPiContext } from "../lib/context.js";

/** 构造最小文本消息。 */
function textMessage(role, text) {
  return { role, content: [{ type: "text", text }] };
}

/** 构造匹配的一次 assistant 工具调用和独立工具结果。 */
function toolHistory() {
  return [
    {
      role: "assistant",
      source: { kind: "model", provider: "foreign", model: "foreign-model" },
      content: [{ type: "tool-call", id: "call-1", name: "weather", arguments: '{"city":"Paris"}' }],
    },
    {
      role: "tool",
      toolCallId: "call-1",
      source: { kind: "tool", callId: "call-1" },
      content: [{ type: "text", text: "service unavailable" }],
      isError: true,
    },
  ];
}

test("leading system message becomes systemPrompt when options.system is absent", () => {
  const result = toPiContext({ messages: [textMessage("system", "rules"), textMessage("user", "hello")] });
  assert.equal(result.systemPrompt, "rules");
  assert.deepEqual(result.messages, [{ role: "user", content: "hello", timestamp: 0 }]);
});

test("explicit system prompt takes precedence and preserves history", () => {
  for (const system of ["override", ""]) {
    const result = toPiContext({ system, messages: [textMessage("system", "history"), textMessage("user", "hello")] });
    assert.equal(result.systemPrompt, system);
    assert.equal(result.messages[0].content, "history");
    assert.equal(result.messages.length, 2);
  }
});

test("empty leading system text does not create an empty user message", () => {
  const result = toPiContext({ messages: [textMessage("system", ""), textMessage("user", "hello")] });
  assert.equal("systemPrompt" in result, false);
  assert.equal(result.messages.length, 1);
});

test("independent tool result preserves call id, name, error flag and text", () => {
  const result = toPiContext({ messages: toolHistory() });
  assert.deepEqual(result.messages[1], {
    role: "toolResult", toolCallId: "call-1", toolName: "weather",
    content: [{ type: "text", text: "service unavailable" }], isError: true, timestamp: 0,
  });
  assert.deepEqual(result.messages[0].content[0].arguments, { city: "Paris" });
});

test("attachment-enabled conversion preserves text-only tool result semantics", async () => {
  const messages = [textMessage("system", "rules"), ...toolHistory()];
  const expected = toPiContext({ messages });
  const result = await toPiContext({ messages }, {});
  assert.deepEqual(result, expected);
});

test("empty tool result remains a tool result without inventing a user turn", () => {
  const messages = toolHistory();
  messages[1].content = [];
  const result = toPiContext({ messages });
  assert.equal(result.messages.length, 2);
  assert.deepEqual(result.messages[1].content, [{ type: "text", text: "(no output)" }]);
});

test("unsupported roles and nested legacy tool results fail explicitly", () => {
  const cases = [
    textMessage("developer", "rules"),
    textMessage("unknown", "text"),
    { role: "user", content: [{ type: "tool-result", toolCallId: "old", content: [] }] },
    { role: "user", content: [{ type: "tool-addition", name: "extra" }] },
  ];
  for (const message of cases) {
    assert.throws(() => toPiContext({ messages: [message] }), { code: "UNSUPPORTED_CONTENT" });
  }
});

test("deferred tools are rejected rather than exposed as loaded tools", () => {
  assert.throws(() => toPiContext({ messages: [], tools: [{ name: "hidden", deferLoading: true }] }), {
    code: "UNSUPPORTED_CONTENT",
  });
});

/** 构造只用于请求图片契约测试的附件引用。 */
function imageRef() {
  return { attachmentId: "img-1", mediaType: "image/png", width: 4000, height: 2000, bytes: 4 };
}

test("user and tool images share one projected request image and keep tool identity", async () => {
  const ref = imageRef();
  const messages = [
    { role: "user", content: [{ type: "image", attachment: ref }] },
    ...toolHistory(),
  ];
  messages[2].content = [{ type: "image", attachment: ref }];
  const controller = new AbortController();
  const reads = [];
  const result = await toPiContext({ messages, signal: controller.signal }, {
    async readImageRequest(attachment, target, signal) {
      reads.push({ attachment, target, signal });
      return { width: target.width, height: target.height, mediaType: "image/png", bytes: 4, data: Uint8Array.from([0, 1, 2, 3]) };
    },
  }, { requestImagePolicy: { maxPixels: 2000000, maxBytes: 512000 } });
  assert.equal(reads.length, 1, "duplicate references are projected once per request");
  assert.deepEqual(reads[0].target, { width: 2000, height: 1000, maxBytes: 512000 });
  assert.equal(reads[0].signal, controller.signal);
  assert.equal(result.messages[2].role, "toolResult");
  assert.equal(result.messages[2].toolCallId, "call-1");
  assert.deepEqual(result.messages[2].content[1], { type: "image", mimeType: "image/png", data: "AAECAw==" });
});

test("offloaded images become placeholders without reading their bytes", async () => {
  const result = await toPiContext({ messages: [{ role: "user", content: [
    { type: "image", attachment: imageRef(), offloaded: true },
  ] }] }, {
    readImageRequest() { assert.fail("offloaded image must not be read"); },
  });
  assert.match(result.messages[0].content, /image omitted to fit request image limits/);
});

test("request image budget uses base64 bytes and requests Host offloading", async () => {
  await assert.rejects(toPiContext({ messages: [{ role: "user", content: [
    { type: "image", attachment: imageRef() },
  ] }] }, {
    async readImageRequest() {
      return { width: 1, height: 1, mediaType: "image/png", bytes: 4, data: Uint8Array.from([0, 1, 2, 3]) };
    },
  }, { maxRequestImageBytes: 4 }), (error) => {
    assert.equal(error.code, "IMAGE_OFFLOAD_REQUIRED");
    assert.equal(error.failure.offloadImages, 1);
    return true;
  });
});

test("aborted image conversion never starts an attachment read", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(toPiContext({ signal: controller.signal, messages: [{ role: "user", content: [
    { type: "image", attachment: imageRef() },
  ] }] }, {
    readImageRequest() { assert.fail("cancelled request must not read attachments"); },
  }), { name: "AbortError" });
});

test("cancellation during image projection prevents conversion", async () => {
  const controller = new AbortController();
  await assert.rejects(toPiContext({ signal: controller.signal, messages: [{ role: "user", content: [
    { type: "image", attachment: imageRef() },
  ] }] }, {
    async readImageRequest(_ref, _target, signal) {
      assert.equal(signal, controller.signal);
      controller.abort();
      return { width: 1, height: 1, mediaType: "image/png", bytes: 1, data: Uint8Array.from([0]) };
    },
  }), { name: "AbortError" });
});

/**
 * Harness request-history conversion into pi-ai's `Context` vocabulary.
 *
 * User images are loaded through the public durable `attachments` service and
 * converted to pi-ai image parts. Assistant image output remains unsupported:
 * the Codex Responses history format cannot replay a structured assistant
 * image block. Tool-result images use the same durable attachment path.
 *
 * @module dsh-codex/context
 */

import { contentHasImage } from "@deepseek-ai/dsh-llm";
import { toPiAssistant } from "./replay.js";

/** Join the text blocks of a harness message. */
export function flattenText(message) {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/** Flatten text recursively inside one tool result. */
export function toolResultText(blocks) {
  return blocks
    .map((block) =>
      block.type === "text" ? block.text : block.type === "tool-result" ? toolResultText(block.content) : "",
    )
    .join("");
}

/**
 * Convert durable harness image blocks to pi-ai image parts.
 *
 * `attachments.readImage()` verifies and returns the bytes behind the opaque
 * session reference. Only the base64 payload and verified media type are
 * handed to pi-ai; no storage path or bearer URL crosses the adapter.
 */
async function userContent(blocks, attachments) {
  const content = [];
  for (const block of blocks) {
    switch (block.type) {
      case "text":
        if (block.text.length > 0) content.push({ type: "text", text: block.text });
        break;
      case "image": {
        const stored = await attachments.readImage(block.attachment);
        content.push({
          type: "image",
          data: Buffer.from(stored.data).toString("base64"),
          mimeType: stored.ref.mediaType,
        });
        break;
      }
      case "tool-result": {
        const nested = await userContent(block.content, attachments);
        if (typeof nested === "string") {
          if (nested.length > 0) content.push({ type: "text", text: nested });
        } else {
          content.push(...nested);
        }
        break;
      }
      default:
        break;
    }
  }
  if (content.every((block) => block.type === "text")) return content.map((block) => block.text).join("");
  return content;
}

function toolsOf(options) {
  return options.tools?.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

/** Assemble the request-level pi-ai context envelope. */
export function piContext(options, messages) {
  const tools = toolsOf(options);
  return {
    ...(options.system !== undefined ? { systemPrompt: options.system } : {}),
    messages,
    ...(tools !== undefined && tools.length > 0 ? { tools } : {}),
  };
}

/** Convert a text-only conversation; image input is rejected without attachments. */
function textOnlyContext(options) {
  const toolNames = new Map();
  const messages = [];
  for (const message of options.messages) {
    if (contentHasImage(message.content)) {
      throw Object.assign(new Error("dsh-codex image input requires the durable attachment service"), {
        code: "UNSUPPORTED_CONTENT",
      });
    }
    if (message.role === "system") {
      messages.push({ role: "user", content: flattenText(message), timestamp: 0 });
      continue;
    }
    if (message.role === "assistant") {
      const assistant = toPiAssistant(message);
      for (const block of assistant.content) {
        if (block.type === "toolCall") toolNames.set(block.id, block.name);
      }
      messages.push(assistant);
      continue;
    }
    const text = flattenText(message);
    const results = message.content.filter((block) => block.type === "tool-result");
    if (text.length > 0 || results.length === 0) {
      messages.push({ role: "user", content: text, timestamp: 0 });
    }
    for (const result of results) {
      messages.push({
        role: "toolResult",
        toolCallId: result.toolCallId,
        toolName: toolNames.get(result.toolCallId) ?? "unknown",
        content: [{ type: "text", text: toolResultText(result.content) || "(no output)" }],
        isError: result.isError ?? false,
        timestamp: 0,
      });
    }
  }
  return piContext(options, messages);
}

/** Convert a conversation using the durable attachment service for images. */
async function contextWithImages(options, attachments) {
  const toolNames = new Map();
  const messages = [];
  for (const message of options.messages) {
    if (message.role === "system") {
      if (contentHasImage(message.content)) {
        throw Object.assign(new Error("dsh-codex cannot represent an image in a system message"), {
          code: "UNSUPPORTED_CONTENT",
        });
      }
      messages.push({ role: "user", content: flattenText(message), timestamp: 0 });
      continue;
    }
    if (message.role === "assistant") {
      const assistant = toPiAssistant(message);
      for (const block of assistant.content) {
        if (block.type === "toolCall") toolNames.set(block.id, block.name);
      }
      messages.push(assistant);
      continue;
    }
    const content = await userContent(message.content.filter((block) => block.type !== "tool-result"), attachments);
    const results = message.content.filter((block) => block.type === "tool-result");
    if (content.length > 0 || results.length === 0) {
      messages.push({ role: "user", content, timestamp: 0 });
    }
    for (const result of results) {
      const resultContent = await userContent(result.content, attachments);
      messages.push({
        role: "toolResult",
        toolCallId: result.toolCallId,
        toolName: toolNames.get(result.toolCallId) ?? "unknown",
        content: typeof resultContent === "string" ? [{ type: "text", text: resultContent || "(no output)" }] : resultContent,
        isError: result.isError ?? false,
        timestamp: 0,
      });
    }
  }
  return piContext(options, messages);
}

/**
 * Convert the harness conversation into pi-ai context.
 *
 * With no image content this remains synchronous. When an attachment store is
 * supplied for image content, the returned value is a Promise that resolves
 * after all durable images have been read and encoded.
 */
export function toPiContext(options, attachments) {
  return attachments === undefined ? textOnlyContext(options) : contextWithImages(options, attachments);
}

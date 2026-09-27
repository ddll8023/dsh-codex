/**
 * 将 DSH 0.1.7-rc.2 的独立消息角色转换为 pi-ai 请求历史。
 * 工具结果通过 role: "tool" 与 toolCallId 关联，不能降级为用户文本。
 * 图片经 Host 的请求图片投影接口生成，并遵循取消、预算和卸载标记。
 * @module dsh-codex/context
 */

import {
  contentHasImage, LlmError, IMAGE_OFFLOAD_REQUIRED_CODE,
  offloadedImageText, projectOffloadedImages, requestImageHandleText, requiredImageOffload,
} from "@deepseek-ai/dsh-llm";
import { requestImageDimensions } from "@deepseek-ai/dsh-attachment";
import { toPiAssistant } from "./replay.js";

/** 合并消息中的文本块。 */
export function flattenText(message) {
  return message.content.filter((block) => block.type === "text").map((block) => block.text).join("");
}

/** 合并独立工具结果消息的文本内容。 */
export function toolResultText(blocks) {
  return flattenText({ content: blocks });
}

/** 拒绝无法无损转换的角色和旧版嵌套工具结果，避免静默改变消息语义。 */
function assertSupportedHistory(messages) {
  for (const message of messages) {
    if (!["system", "user", "assistant", "tool"].includes(message.role)) {
      throw new LlmError(`dsh-codex does not support history role "${message.role}"`, "UNSUPPORTED_CONTENT");
    }
    if (message.content.some((block) => ["tool-addition", "tool-removal", "tool-result"].includes(block.type))) {
      throw new LlmError("dsh-codex does not support tool-change blocks or nested tool results", "UNSUPPORTED_CONTENT");
    }
    if (message.role !== "user" && message.role !== "tool" && contentHasImage(message.content)) {
      throw new LlmError(`dsh-codex cannot represent an image in a ${message.role} message`, "UNSUPPORTED_CONTENT");
    }
  }
}

/** options.system 优先；否则将首条 system 消息提取为系统提示词。 */
function splitSystemPrompt(options) {
  if (options.system !== undefined) return { system: options.system, messages: options.messages };
  const [first, ...rest] = options.messages;
  if (first?.role !== "system") return { system: undefined, messages: options.messages };
  return { system: flattenText(first) || undefined, messages: rest };
}

/** 转换已由 Host 校验并投影的图片；模型只收到预览字节及受控的附件说明。 */
function userContent(blocks, requestImages, resolveImageAccess) {
  const content = [];
  for (const block of blocks) {
    if (block.type === "text" && block.text.length > 0) {
      content.push({ type: "text", text: block.text });
    } else if (block.type === "image") {
      const version = requestImages.get(block.attachment.attachmentId);
      content.push({ type: "text", text: requestImageHandleText(block.attachment, version, resolveImageAccess(block.attachment)) });
      content.push({ type: "image", data: Buffer.from(version.data).toString("base64"), mimeType: version.mediaType });
    }
  }
  return content.every((block) => block.type === "text") ? content.map((block) => block.text).join("") : content;
}

/** 转换工具声明；不将尚未加载的工具伪装为普通工具。 */
function toolsOf(options) {
  if (options.tools?.some((tool) => tool.deferLoading === true)) {
    throw new LlmError("dsh-codex does not support deferred tool loading", "UNSUPPORTED_CONTENT");
  }
  return options.tools?.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }));
}

/** 组装已转换的历史与请求级系统提示词、工具声明。 */
export function piContext(options, messages) {
  const tools = toolsOf(options);
  return {
    ...(options.system !== undefined ? { systemPrompt: options.system } : {}),
    messages,
    ...(tools !== undefined && tools.length > 0 ? { tools } : {}),
  };
}

/** 转换 assistant 消息并记录后续工具结果需要的工具名称。 */
function collectAssistant(message, toolNames) {
  const assistant = toPiAssistant(message);
  for (const block of assistant.content) {
    if (block.type === "toolCall") toolNames.set(block.id, block.name);
  }
  return assistant;
}

/** 将独立工具结果消息转换为 pi-ai toolResult，不丢失关联 ID 和错误标记。 */
function toolResultOf(message, toolNames, content) {
  return {
    role: "toolResult",
    toolCallId: message.toolCallId,
    toolName: toolNames.get(message.toolCallId) ?? "unknown",
    content: typeof content === "string" ? [{ type: "text", text: content || "(no output)" }] : content,
    isError: message.isError ?? false,
    timestamp: 0,
  };
}

/** 转换纯文本历史；无附件服务时明确拒绝图片。 */
function textOnlyContext(options, split) {
  const toolNames = new Map();
  const messages = [];
  for (const message of split.messages) {
    if (contentHasImage(message.content)) {
      throw new LlmError("dsh-codex image input requires the durable attachment service", "UNSUPPORTED_CONTENT");
    }
    if (message.role === "assistant") messages.push(collectAssistant(message, toolNames));
    else if (message.role === "tool") messages.push(toolResultOf(message, toolNames, flattenText(message)));
    else messages.push({ role: "user", content: flattenText(message), timestamp: 0 });
  }
  return piContext({ ...options, system: split.system }, messages);
}

/** 按附件 ID 去重读取请求图片；已卸载图片不读取字节。 */
async function prepareImages(messages, attachments, policy, signal) {
  const refs = new Map();
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === "image" && block.offloaded !== true) refs.set(block.attachment.attachmentId, block.attachment);
    }
  }
  const images = new Map();
  for (const ref of refs.values()) {
    signal?.throwIfAborted();
    const target = { ...requestImageDimensions(ref.width, ref.height, policy.maxPixels), maxBytes: policy.maxBytes };
    const image = await attachments.readImageRequest(ref, target, signal);
    signal?.throwIfAborted();
    images.set(ref.attachmentId, image);
  }
  return images;
}

/** 转换带附件服务的历史，预算不足时交由 Host 卸载最旧图片后重试。 */
async function contextWithImages(options, attachments, split, imageOptions) {
  const {
    resolveImageAccess = () => undefined,
    requestImagePolicy = { maxPixels: 4194304, maxBytes: 1048576 },
    maxRequestImageBytes = 20971520,
  } = imageOptions;
  options.signal?.throwIfAborted();
  const requestImages = await prepareImages(split.messages, attachments, requestImagePolicy, options.signal);
  const offloadImages = requiredImageOffload(split.messages, {
    representation: "base64", maxBytes: maxRequestImageBytes,
  }, (block) => requestImages.get(block.attachment.attachmentId).bytes);
  if (offloadImages > 0) {
    throw new LlmError(`dsh-codex request images exceed the ${maxRequestImageBytes}-byte base64 bound`,
      IMAGE_OFFLOAD_REQUIRED_CODE, { offloadImages });
  }
  const exactMessages = projectOffloadedImages(split.messages, (ref) => offloadedImageText(ref, resolveImageAccess(ref)));
  const toolNames = new Map();
  const messages = [];
  for (const message of exactMessages) {
    if (message.role === "assistant") {
      messages.push(collectAssistant(message, toolNames));
      continue;
    }
    const content = userContent(message.content, requestImages, resolveImageAccess);
    messages.push(message.role === "tool"
      ? toolResultOf(message, toolNames, content)
      : { role: "user", content, timestamp: 0 });
  }
  return piContext({ ...options, system: split.system }, messages);
}

/** 转换请求历史；没有附件服务时同步返回，否则返回 Promise。 */
export function toPiContext(options, attachments, imageOptions = {}) {
  assertSupportedHistory(options.messages);
  const split = splitSystemPrompt(options);
  return attachments === undefined ? textOnlyContext(options, split) : contextWithImages(options, attachments, split, imageOptions);
}

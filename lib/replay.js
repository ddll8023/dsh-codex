/**
 * Durable pi-ai replay metadata and assistant-history reconstruction for
 * dsh-codex.
 *
 * Harness content stays the durable source for text and tool calls. This
 * module stores only the provider-native metadata needed to reconstruct a
 * pi-ai assistant message on a later request (signatures, response ids,
 * stop reason), so multi-turn Codex calls keep their continuity payloads
 * without the harness ever persisting provider-internal blobs.
 *
 * The replay state rides the `finish` chunk's `replayState` slot and the
 * assistant message `source.replayState`; only this adapter writes and reads
 * it (it is adapter-private by contract).
 *
 * @module dsh-codex/replay
 */

import { CallId } from "@deepseek-ai/dsh-llm";

/** Parse tool-call argument JSON; tolerate model malformations with {}. */
export function parseArguments(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return parsed;
  } catch {
    // fall through
  }
  return {};
}

/** The zero usage value pi-ai requires on historical assistant messages. */
export function emptyPiUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

/** Project a completed pi-ai assistant response into minimal replay state. */
export function toReplayState(message) {
  return {
    kind: "pi-ai",
    version: 1,
    api: message.api,
    provider: message.provider,
    model: message.model,
    ...(message.responseModel === undefined ? {} : { responseModel: message.responseModel }),
    ...(message.responseId === undefined ? {} : { responseId: message.responseId }),
    stopReason: message.stopReason,
    blocks: message.content.map((block) => {
      switch (block.type) {
        case "text":
          return { type: "text", ...(block.textSignature === undefined ? {} : { textSignature: block.textSignature }) };
        case "thinking":
          return {
            type: "reasoning",
            ...(block.thinkingSignature === undefined ? {} : { thinkingSignature: block.thinkingSignature }),
            ...(block.redacted === undefined ? {} : { redacted: block.redacted }),
          };
        case "toolCall":
          return { type: "tool-call", ...(block.thoughtSignature === undefined ? {} : { thoughtSignature: block.thoughtSignature }) };
        default:
          return { type: "unknown" };
      }
    }),
  };
}

function invalidReplay(message) {
  const error = new Error(`invalid dsh-codex replay state: ${message}`);
  error.code = "INVALID_REPLAY_STATE";
  return error;
}

/** Validate adapter-private replay state before it reaches pi-ai. */
export function readReplayState(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalidReplay("expected an object");
  const state = value;
  if (state.kind !== "pi-ai") throw invalidReplay("unknown state kind");
  if (state.version !== 1) throw invalidReplay(`unsupported version ${String(state.version)}`);
  for (const key of ["api", "provider", "model"]) {
    if (typeof state[key] !== "string" || state[key].length === 0) throw invalidReplay(`${key} must be a non-empty string`);
  }
  if (!["stop", "length", "toolUse", "error", "aborted"].includes(String(state.stopReason))) {
    throw invalidReplay("unknown stopReason");
  }
  if (state.responseModel !== undefined && typeof state.responseModel !== "string") throw invalidReplay("responseModel must be a string");
  if (state.responseId !== undefined && typeof state.responseId !== "string") throw invalidReplay("responseId must be a string");
  if (!Array.isArray(state.blocks)) throw invalidReplay("blocks must be an array");
  for (const [index, block] of state.blocks.entries()) {
    if (typeof block !== "object" || block === null || Array.isArray(block)) throw invalidReplay(`block ${index} must be an object`);
    if (!["text", "reasoning", "tool-call", "unknown"].includes(String(block.type))) throw invalidReplay(`block ${index} has an unknown type`);
    for (const signature of ["textSignature", "thinkingSignature", "thoughtSignature"]) {
      if (block[signature] !== undefined && typeof block[signature] !== "string") throw invalidReplay(`block ${index} ${signature} must be a string`);
    }
    if (block.redacted !== undefined && typeof block.redacted !== "boolean") throw invalidReplay(`block ${index} redacted must be boolean`);
  }
  return state;
}

/** Convert provider-neutral harness blocks into a foreign pi-ai assistant message. */
export function foreignAssistant(message) {
  const source = message.source.kind === "model" ? message.source : undefined;
  const content = [];
  for (const block of message.content) {
    switch (block.type) {
      case "text":
        content.push({ type: "text", text: block.text });
        break;
      case "reasoning":
        content.push({ type: "thinking", thinking: block.text });
        break;
      case "tool-call":
        content.push({ type: "toolCall", id: block.id, name: block.name, arguments: parseArguments(block.arguments) });
        break;
      case "image":
        throw Object.assign(new Error("dsh-codex history cannot represent structured assistant image output"), { code: "UNSUPPORTED_CONTENT" });
      default:
        break; // unknown merge-extended block types fall through
    }
  }
  return {
    role: "assistant",
    content,
    api: "dsh-foreign",
    provider: source?.provider ?? "dsh-foreign",
    model: source?.model ?? "dsh-foreign",
    usage: emptyPiUsage(),
    stopReason: content.some((piece) => piece.type === "toolCall") ? "toolUse" : "stop",
    timestamp: 0,
  };
}

/** Recombine durable harness content with validated replay metadata. */
export function replayedAssistant(message, source, rawState) {
  const state = readReplayState(rawState);
  if (state.provider !== source.provider) throw invalidReplay("provider does not match assistant source");
  if (state.model !== source.model) throw invalidReplay("model does not match assistant source");
  if (state.blocks.length !== message.content.length) throw invalidReplay("block count does not match assistant content");
  return {
    role: "assistant",
    content: message.content.map((block, index) => {
      const replay = state.blocks[index];
      if (replay === undefined || replay.type !== block.type) throw invalidReplay(`block ${index} does not match assistant content`);
      switch (block.type) {
        case "text":
          return {
            type: "text",
            text: block.text,
            ...(replay.type === "text" && replay.textSignature !== undefined ? { textSignature: replay.textSignature } : {}),
          };
        case "reasoning":
          return {
            type: "thinking",
            thinking: block.text,
            ...(replay.type === "reasoning" && replay.thinkingSignature !== undefined ? { thinkingSignature: replay.thinkingSignature } : {}),
            ...(replay.type === "reasoning" && replay.redacted !== undefined ? { redacted: replay.redacted } : {}),
          };
        case "tool-call":
          return {
            type: "toolCall",
            id: block.id,
            name: block.name,
            arguments: parseArguments(block.arguments),
            ...(replay.type === "tool-call" && replay.thoughtSignature !== undefined ? { thoughtSignature: replay.thoughtSignature } : {}),
          };
        default:
          throw invalidReplay(`block ${index} has an unsupported harness type`);
      }
    }),
    api: state.api,
    provider: state.provider,
    model: state.model,
    ...(state.responseModel === undefined ? {} : { responseModel: state.responseModel }),
    ...(state.responseId === undefined ? {} : { responseId: state.responseId }),
    usage: emptyPiUsage(),
    stopReason: state.stopReason,
    timestamp: 0,
  };
}

/** Convert one durable harness assistant message into pi-ai history. */
export function toPiAssistant(message) {
  const source = message.source;
  return source.kind !== "model" || source.replayState === undefined
    ? foreignAssistant(message)
    : replayedAssistant(message, source, source.replayState);
}

/** Brand an id as a CallId (re-export for convenience of the module family). */
export function toCallId(id) {
  return CallId(id);
}

/**
 * pi-ai assistant-event translation into the harness streaming protocol.
 *
 * pi-ai reports failures as terminal stream events; this module maps them into
 * harness `finish` chunks with stable provider-neutral codes, including the
 * Codex-specific usage-limit wording ("You have hit your ChatGPT usage limit")
 * which the shared classifier maps to the harness `QUOTA` code.
 *
 * @module dsh-codex/stream
 */

import {
  CallId,
  EMPTY_RESPONSE_CODE,
  LlmError,
  QUOTA_EXCEEDED_CODE,
  isContextWindowExceededError,
  isQuotaExceededError,
} from "@deepseek-ai/dsh-llm";
import { isContextOverflow } from "@earendil-works/pi-ai";
import { toReplayState } from "./replay.js";

/** Map pi-ai usage to harness disjoint counts. */
export function mapUsage(usage) {
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    ...(usage.cacheRead > 0 ? { cacheReadTokens: usage.cacheRead } : {}),
    ...(usage.cacheWrite > 0 ? { cacheWriteTokens: usage.cacheWrite } : {}),
    ...(usage.reasoning > 0 ? { reasoningTokens: usage.reasoning } : {}),
  };
}

/**
 * Classify a pi-ai error message into a stable harness code. Handles the
 * Codex-specific usage-limit phrasing (quota), auth, rate limit, invalid
 * request, server, timeout, and transport families.
 * @param message - pi-ai terminal error text.
 * @returns the harness code.
 */
export function classifyError(message) {
  if (/\b(?:401|403)\b/.test(message) || /expired|invalid.?token|unauthorized/i.test(message)) return "AUTH";
  if (isQuotaExceededError(message) || /usage[\s_-]?limit/i.test(message)) return QUOTA_EXCEEDED_CODE;
  if (/\b429\b|rate.?limit/i.test(message)) return "RATE_LIMIT";
  if (/\b400\b|invalid.?request/i.test(message)) return "INVALID_REQUEST";
  if (/\b5\d\d\b/.test(message)) return "SERVER";
  if (/\btime(?:d)?\s*out\b|timeout/i.test(message)) return "TIMEOUT";
  if (/stream ended (?:before|without)\b/i.test(message)) return "TRANSPORT";
  if (
    /\b(?:network|connection|socket|fetch)\b|\bECONN[A-Z]+\b/i.test(message) ||
    /\b(?:other side closed|HTTP2 request did not get a response|WebSocket closed unexpectedly)\b/i.test(message) ||
    /\bterminated\b|premature close/i.test(message)
  ) {
    return "TRANSPORT";
  }
  return "PI_AI_ERROR";
}

/**
 * Map a terminal pi-ai message to the harness finish reason.
 * @param message - the assistant message from a `done` or `error` event.
 * @param contextWindow - resolved catalog capacity for overflow detection.
 * @returns the mapped finish reason.
 */
export function mapStopReason(message, contextWindow) {
  const piAiOverflow = isContextOverflow(message, contextWindow);
  const harnessOverflow =
    message.stopReason === "error" && message.errorMessage !== undefined && isContextWindowExceededError(message.errorMessage);
  if (piAiOverflow || harnessOverflow) {
    return {
      kind: "error",
      failure: {
        message: message.errorMessage ?? `pi-ai detected context overflow for model "${message.model}"`,
        code: "CONTEXT_WINDOW_EXCEEDED",
      },
    };
  }
  switch (message.stopReason) {
    case "stop":
      if (message.content.length === 0) {
        return {
          kind: "error",
          failure: {
            message: `model "${message.model}" returned a completed response with no content`,
            code: EMPTY_RESPONSE_CODE,
          },
        };
      }
      return { kind: "stop" };
    case "length":
      return { kind: "max-tokens" };
    case "toolUse":
      return { kind: "tool-calls" };
    case "aborted":
      return {
        kind: "aborted",
        failure: { message: message.errorMessage ?? "pi-ai stream aborted", code: "ABORTED" },
      };
    case "error": {
      const text = message.errorMessage ?? "pi-ai stream error";
      return { kind: "error", failure: { message: text, code: classifyError(text) } };
    }
    default:
      return { kind: "error", failure: { message: `unexpected pi-ai stop reason "${message.stopReason}"`, code: "PI_AI_ERROR" } };
  }
}

/**
 * Translate the pi-ai event stream into harness StreamChunks.
 * @param events - one assistant turn's pi-ai event stream.
 * @param contextWindow - resolved catalog capacity.
 * @returns harness chunks, ending with `usage` then `finish`.
 */
export async function* toStreamChunks(events, contextWindow) {
  const toolIds = new Map();
  for await (const event of events) {
    switch (event.type) {
      case "start":
        break;
      case "text_start":
        yield { type: "block-start", index: event.contentIndex, blockType: "text" };
        break;
      case "text_delta":
        yield { type: "text-delta", index: event.contentIndex, text: event.delta };
        break;
      case "text_end":
        yield {
          type: "block-end",
          index: event.contentIndex,
          block: { type: "text", text: event.content },
        };
        break;
      case "thinking_start":
        yield { type: "block-start", index: event.contentIndex, blockType: "reasoning" };
        break;
      case "thinking_delta":
        yield { type: "reasoning-delta", index: event.contentIndex, text: event.delta };
        break;
      case "thinking_end":
        yield {
          type: "block-end",
          index: event.contentIndex,
          block: { type: "reasoning", text: event.content },
        };
        break;
      case "toolcall_start": {
        const partial = event.partial.content[event.contentIndex];
        const id = partial?.type === "toolCall" ? partial.id : "";
        const name = partial?.type === "toolCall" ? partial.name : "";
        toolIds.set(event.contentIndex, { id, name });
        yield { type: "block-start", index: event.contentIndex, blockType: "tool-call" };
        break;
      }
      case "toolcall_delta": {
        const known = toolIds.get(event.contentIndex);
        yield {
          type: "tool-call-delta",
          index: event.contentIndex,
          id: CallId(known?.id ?? ""),
          ...(known?.name !== undefined && known.name.length > 0 ? { name: known.name } : {}),
          argumentsDelta: event.delta,
        };
        break;
      }
      case "toolcall_end":
        yield {
          type: "block-end",
          index: event.contentIndex,
          block: {
            type: "tool-call",
            id: CallId(event.toolCall.id),
            name: event.toolCall.name,
            arguments: JSON.stringify(event.toolCall.arguments),
          },
        };
        break;
      case "done":
        yield { type: "usage", usage: mapUsage(event.message.usage) };
        yield {
          type: "finish",
          reason: mapStopReason(event.message, contextWindow),
          replayState: toReplayState(event.message),
        };
        return;
      case "error":
        yield { type: "usage", usage: mapUsage(event.error.usage) };
        yield { type: "finish", reason: mapStopReason(event.error, contextWindow) };
        return;
      default:
        break; // unknown pi-ai events are skipped; the terminal event still arrives
    }
  }
  throw new LlmError("pi-ai event stream ended without done/error", "STREAM_CLOSED");
}

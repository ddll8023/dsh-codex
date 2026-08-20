/**
 * `CodexAdapter`: the harness `LlmAdapter` for the `openai-codex` provider
 * route, backed by pi-ai's `openai-codex` provider (the Responses-API wire
 * implementation over `https://chatgpt.com/backend-api/codex/responses`).
 *
 * The adapter is transport-only: connection facts arrive through a thunk
 * resolved once per operation, the pi-ai `Models` collection owns auth and
 * streaming, and credentials are freshened (preemptive refresh ~5 min before
 * expiry) through the store before dispatch.
 *
 * @module dsh-codex/adapter
 */

import {
  LlmAdapter,
  LlmError,
  ReasoningEffortId,
  attributionHeaders,
  contentHasImage,
} from "@deepseek-ai/dsh-llm";
import { idleWatchdog, timeoutOf } from "@deepseek-ai/dsh-timeout";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { PROVIDER, PROVIDER_NAME } from "./constants.js";
import { toPiContext } from "./context.js";
import { createCodexPayloadTransformer } from "./web-search.js";
import { toStreamChunks } from "./stream.js";

/** Default maximum idle interval while an adapter stream read is outstanding. */
const STREAM_IDLE_TIMEOUT_CODE = "LLM_STREAM_IDLE_TIMEOUT";

/** The thinking levels pi-ai understands, in display order. */
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/** Validate an explicit harness/profile effort without invoking pi-ai's clamp. */
function resolveReasoningLevel(model, effort) {
  if (effort === undefined) return undefined;
  if (getSupportedThinkingLevels(model).some((level) => level === effort)) return effort;
  throw new LlmError(
    `pi-ai provider "${model.provider}" model "${model.id}" does not support reasoning effort "${effort}"`,
    "UNSUPPORTED_REASONING_EFFORT",
  );
}

/** The profile default this exact model can actually take, for DESCRIBING it. */
function describableReasoningLevel(model, effort) {
  if (effort === undefined) return undefined;
  return getSupportedThinkingLevels(model).some((level) => level === effort) ? effort : undefined;
}

/** Selectable reasoning efforts for one model, or nothing at all. */
function reasoningInfo(model, defaultLevel) {
  if (!model.reasoning) return {};
  return {
    reasoning: {
      efforts: getSupportedThinkingLevels(model).map((level) => ({
        id: ReasoningEffortId(level),
        name: `${level.charAt(0).toUpperCase()}${level.slice(1)}`,
      })),
      ...(defaultLevel === undefined ? {} : { defaultEffort: ReasoningEffortId(defaultLevel) }),
    },
  };
}

/** Merge deployment headers while removing case-insensitive attribution collisions. */
function requestHeaders(headers) {
  const attribution = attributionHeaders();
  const reserved = new Set(Object.keys(attribution).map((name) => name.toLowerCase()));
  return {
    ...Object.fromEntries(Object.entries(headers ?? {}).filter(([name]) => !reserved.has(name.toLowerCase()))),
    ...attribution,
  };
}

/** Polyfill for AbortSignal.any — not available on Node 18 / older runtimes. */
function anySignal(signals) {
  const valid = signals.filter((s) => s !== undefined && s !== null);
  if (valid.length === 0) return undefined;
  if (valid.length === 1) return valid[0];
  if (typeof AbortSignal.any === "function") return AbortSignal.any(valid);
  const ac = new AbortController();
  const onAbort = () => {
    const culprit = valid.find((s) => s.aborted);
    try { ac.abort(culprit?.reason); } catch { ac.abort(); }
  };
  for (const s of valid) {
    if (s.aborted) { onAbort(); break; }
    s.addEventListener("abort", onAbort, { once: true });
  }
  return ac.signal;
}

/**
 * The `openai-codex` adapter. One instance serves the single provider route.
 */
export class CodexAdapter extends LlmAdapter {
  constructor(config) {
    super();
    this.config = config; // { options(), models, freshen(), attachments? }
  }

  providerInfo(provider) {
    return { id: provider, name: PROVIDER_NAME };
  }

  providerRetryPolicy(_provider) {
    return this.config.options().retryPolicy;
  }

  listModels(provider) {
    return Promise.resolve().then(() => {
      const models = this.config.models();
      if (models.getProvider(provider) === undefined) throw new LlmError(`no adapter for provider "${provider}"`, "NO_ADAPTER");
      return models.getModels(provider).map((model) => {
        const override = this.config.options().models.find((entry) => entry.id === model.id);
        return {
          provider,
          id: model.id,
          name: override?.name ?? model.name,
          ...(override?.description === undefined ? {} : { description: override.description }),
          inputModalities: [...model.input],
        };
      });
    });
  }

  resolveModel(provider, model, _signal) {
    return Promise.resolve().then(() => {
      const connection = this.config.options();
      const resolved = this.config.models().getModel(provider, model);
      if (resolved === undefined) {
        return { provider, id: model, name: model, inputModalities: ["text"] };
      }
      const override = connection.models.find((entry) => entry.id === model);
      const defaultLevel = describableReasoningLevel(resolved, connection.reasoning);
      return {
        provider,
        id: model,
        name: override?.name ?? resolved.name,
        inputModalities: [...resolved.input],
        context: { contextWindow: override?.contextWindow ?? resolved.contextWindow },
        ...(override?.maxTokens === undefined ? {} : { defaultMaxTokens: override.maxTokens }),
        ...reasoningInfo(resolved, defaultLevel),
      };
    });
  }

  async *stream(options) {
    if (options.stop !== undefined) {
      throw new LlmError("dsh-codex does not support GenerateOptions.stop", "UNSUPPORTED_OPTION");
    }
    const connection = this.config.options();
    const models = this.config.models();
    const model = models.getModel(PROVIDER, options.model);
    if (model === undefined) {
      throw new LlmError(`dsh-codex provider "${PROVIDER}" has no configured model "${options.model}"`, "UNKNOWN_MODEL");
    }
    // Fail fast and clearly when no OAuth credential is stored: pi-ai would
    // otherwise report a generic "Provider is not configured".
    const configured = await models.checkAuth(PROVIDER);
    if (configured === undefined) {
      throw new LlmError(
        `dsh-codex: no OAuth credential for provider route "${PROVIDER}"; run /codex login (or /codex login --device) first`,
        "MISSING_CREDENTIAL",
      );
    }
    const reasoning = resolveReasoningLevel(model, options.reasoningEffort ?? connection.reasoning);
    const consumer = new AbortController();
    const upstream = anySignal([options.signal, consumer.signal]) ?? consumer.signal;
    const watchdog = idleWatchdog(upstream, connection.streamIdleTimeoutMs, STREAM_IDLE_TIMEOUT_CODE);
    try {
      const containsImage = options.messages.some((message) => contentHasImage(message.content));
      if (containsImage && !model.input.includes("image")) {
        throw new LlmError(`pi-ai model "${model.id}" does not support image input`, "UNSUPPORTED_CONTENT");
      }
      const attachments = containsImage ? this.config.attachments?.() : undefined;
      if (containsImage && attachments === undefined) {
        throw new LlmError("dsh-codex image input requires the durable attachment service", "UNSUPPORTED_CONTENT");
      }
      // Preemptive refresh: swap the token before dispatch when it is about to
      // expire (default 5 minutes). Failures keep the old credential and
      // surface as an AUTH finish chunk through the adapter boundary.
      await this.config.freshen();
      const context = await toPiContext(options, attachments);
      const onPayload = createCodexPayloadTransformer({
        tools: options.tools,
        nativeWebSearch: connection.nativeWebSearch,
        webSearchMode: connection.webSearchMode,
      });
      const streamOptions = {
        ...(reasoning === undefined || reasoning === "off" ? {} : { reasoning }),
        ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
        ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
        ...(options.sessionId === undefined ? {} : { sessionId: String(options.sessionId) }),
        signal: watchdog.signal,
        ...(onPayload === undefined ? {} : { onPayload }),
        headers: requestHeaders(connection.headers),
        transport: connection.transport,
        cacheRetention: connection.cacheRetention,
        ...(connection.timeoutMs === undefined ? {} : { timeoutMs: connection.timeoutMs }),
        ...(connection.websocketConnectTimeoutMs === undefined ? {} : { websocketConnectTimeoutMs: connection.websocketConnectTimeoutMs }),
        maxRetries: 0, // the harness owns retry policy through dsh-llm-retry
      };
      const iterator = toStreamChunks(
        models.streamSimple(model, context, streamOptions),
        model.contextWindow,
      )[Symbol.asyncIterator]();
      let exhausted = false;
      try {
        while (true) {
          const result = await watchdog.next(iterator);
          const timeout = timeoutOf(watchdog.signal, STREAM_IDLE_TIMEOUT_CODE);
          if (timeout !== undefined) throw timeout;
          if (result.done) {
            exhausted = true;
            return;
          }
          yield result.value;
        }
      } finally {
        if (!exhausted) {
          consumer.abort("dsh-codex stream consumer stopped");
          try {
            await iterator.return(undefined);
          } catch {
            // aborted transport teardown is expected
          }
        }
      }
    } catch (error) {
      if (timeoutOf(watchdog.signal, STREAM_IDLE_TIMEOUT_CODE) !== undefined) {
        throw new LlmError(`dsh-codex stream idle timeout after ${connection.streamIdleTimeoutMs}ms`, "TIMEOUT", { cause: error });
      }
      if (options.signal?.aborted) throw new LlmError("dsh-codex request aborted by caller", "ABORTED", { cause: error });
      throw error;
    } finally {
      consumer.abort("dsh-codex stream consumer stopped");
    }
  }
}

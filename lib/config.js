/**
 * dsh-codex configuration schema and resolution.
 *
 * Non-secret connection knobs only. Tokens NEVER live here: they are stored
 * through the credential seam under `OPENAI_CODEX_OAUTH`.
 *
 * The composition entry config is the base layer; the optional `llm-codex:`
 * user-settings section layers over it (per `installSettingsSection`
 * semantics), so a changed base URL, transport, or timeout reaches the next
 * request without restarting anything.
 *
 * @module dsh-codex/config
 */

import z from "@deepseek-ai/schemastery";
import { RetryPolicySchema, resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import { MAX_TIMER_DELAY_MS } from "@deepseek-ai/dsh-timeout";
import {
  DEFAULT_BASE_URL,
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
  DEFAULT_REFRESH_LEAD_MS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
} from "./constants.js";

/** Every pi-ai thinking level a profile may declare. */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

const catalogModel = z.object({
  id: z.string().required(),
  name: z.string(),
  description: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
});

/** Plugin configuration schema (also the `llm-codex` settings-section schema). */
export const Config = z.object({
  baseURL: z.string().default(DEFAULT_BASE_URL),
  transport: z.union(["sse", "websocket", "websocket-cached", "auto"]).default("sse"),
  cacheRetention: z.union(["none", "short", "long"]).default("short"),
  reasoning: z.union(THINKING_LEVELS),
  timeoutMs: z.natural(),
  websocketConnectTimeoutMs: z.natural(),
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS),
  refreshLeadTimeMs: z.number().min(0).max(MAX_TIMER_DELAY_MS).default(DEFAULT_REFRESH_LEAD_MS),
  headers: z.dict(z.string()),
  models: z.array(catalogModel).default([]),
  retryPolicy: RetryPolicySchema,
});

/** Validate and detach the advisory model overrides. */
function resolveModels(models) {
  const seen = new Set();
  return (models ?? []).map((model) => {
    if (model.id.length === 0) throw new Error("dsh-codex: catalog model ids must be non-empty");
    if (model.name !== undefined && model.name.length === 0) throw new Error(`dsh-codex: catalog model "${model.id}" has an empty name`);
    if (model.contextWindow !== undefined && (!Number.isInteger(model.contextWindow) || model.contextWindow <= 0)) {
      throw new Error(`dsh-codex: catalog model "${model.id}" contextWindow must be a positive integer`);
    }
    if (model.maxTokens !== undefined && (!Number.isInteger(model.maxTokens) || model.maxTokens <= 0)) {
      throw new Error(`dsh-codex: catalog model "${model.id}" maxTokens must be a positive integer`);
    }
    if (seen.has(model.id)) throw new Error(`dsh-codex: duplicate catalog model "${model.id}"`);
    seen.add(model.id);
    return {
      id: model.id,
      ...(model.name === undefined ? {} : { name: model.name }),
      ...(model.description === undefined ? {} : { description: model.description }),
      ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
      ...(model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens }),
    };
  });
}

/**
 * The one explicit resolve step from raw config to validated connection facts.
 * Programmatic construction may bypass Schemastery normalization, so every
 * default and bound is re-judged here.
 * @param config - raw plugin config or resolved settings snapshot.
 * @returns validated connection facts.
 */
export function resolveAdapterOptions(config) {
  const streamIdleTimeoutMs = config.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS;
  if (!Number.isFinite(streamIdleTimeoutMs) || streamIdleTimeoutMs <= 0 || streamIdleTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`dsh-codex: streamIdleTimeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`);
  }
  const refreshLeadTimeMs = config.refreshLeadTimeMs ?? DEFAULT_REFRESH_LEAD_MS;
  if (!Number.isFinite(refreshLeadTimeMs) || refreshLeadTimeMs < 0 || refreshLeadTimeMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`dsh-codex: refreshLeadTimeMs must be a finite number no greater than ${MAX_TIMER_DELAY_MS}`);
  }
  const baseURL = config.baseURL ?? DEFAULT_BASE_URL;
  if (baseURL.length === 0) throw new Error("dsh-codex: baseURL must not be empty");
  const reasoning = config.reasoning;
  if (reasoning !== undefined && !THINKING_LEVELS.includes(reasoning)) {
    throw new Error(`dsh-codex: reasoning must be one of ${THINKING_LEVELS.join(", ")}`);
  }
  return {
    baseURL,
    transport: config.transport ?? "sse",
    cacheRetention: config.cacheRetention ?? "short",
    reasoning,
    timeoutMs: config.timeoutMs,
    websocketConnectTimeoutMs: config.websocketConnectTimeoutMs,
    streamIdleTimeoutMs,
    refreshLeadTimeMs,
    headers: config.headers === undefined ? undefined : { ...config.headers },
    models: resolveModels(config.models),
    retryPolicy: resolveRetryPolicy(config.retryPolicy, "dsh-codex: retryPolicy"),
  };
}

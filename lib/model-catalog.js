/*
 * Account-specific Codex model catalog fetched from the ChatGPT Codex backend.
 *
 * The backend catalog is an undocumented Codex-client contract. It is kept
 * server-side, scoped to the stored account, and guarded by validation,
 * conditional caching, a timeout, and the bundled pi-ai catalog as fallback.
 *
 * @module dsh-codex/model-catalog
 */

import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
  DEFAULT_MODEL_CATALOG_CLIENT_VERSION,
  MODEL_CATALOG_CACHE_MS,
  MODEL_CATALOG_PATH,
  MODEL_CATALOG_TIMEOUT_MS,
  PROVIDER,
  WIRE_ORIGINATOR,
} from "./constants.js";
import { accountIdFromJwt } from "./credentials.js";

const REASONING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const ZERO_COST = Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

function finitePositive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function normalizeReasoningLevels(value, fallback) {
  if (!Array.isArray(value)) return fallback?.thinkingLevelMap;
  const levels = {};
  for (const item of value) {
    const raw = typeof item === "string" ? item : item?.effort;
    if (typeof raw !== "string") continue;
    const effort = raw.toLowerCase() === "none" ? "off" : raw.toLowerCase();
    if (!REASONING_LEVELS.has(effort)) continue;
    levels[effort] = raw.toLowerCase() === "none" ? "none" : raw;
  }
  return Object.keys(levels).length > 0 ? levels : undefined;
}

function modelSignature(models) {
  return JSON.stringify(models.map((model) => ({
    id: model.id,
    name: model.name,
    input: model.input,
    reasoning: model.reasoning,
    thinkingLevelMap: model.thinkingLevelMap,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
  })));
}

/** Convert the Codex endpoint response into pi-ai model records. */
export function mapCodexModelCatalog(payload, { baseURL, fallbackModels = [] } = {}) {
  if (!Array.isArray(payload?.models)) throw new TypeError("Codex model catalog response has no models array");
  const fallbackById = new Map(fallbackModels.map((model) => [model.id, model]));
  const seen = new Set();
  const mapped = [];

  for (const entry of payload.models) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
    if (entry.supported_in_api === false) continue;
    const id = typeof entry.slug === "string" ? entry.slug.trim() : "";
    if (id.length === 0 || /\s/.test(id) || seen.has(id)) continue;
    seen.add(id);

    const knownModel = fallbackById.get(id);
    const template = knownModel ?? fallbackModels[0];
    const contextWindow =
      finitePositive(entry.context_window) ??
      finitePositive(entry.max_context_window) ??
      finitePositive(knownModel?.contextWindow) ??
      DEFAULT_CONTEXT_WINDOW;
    const maxTokens = finitePositive(knownModel?.maxTokens) ?? Math.min(DEFAULT_MAX_TOKENS, contextWindow);
    const rawInput = Array.isArray(entry.input_modalities)
      ? entry.input_modalities
      : knownModel?.input ?? ["text"];
    const input = [...new Set(rawInput
      .filter((modality) => typeof modality === "string")
      .map((modality) => modality.toLowerCase())
      .filter((modality) => modality === "text" || modality === "image"))];
    const levels = normalizeReasoningLevels(entry.supported_reasoning_levels, knownModel);
    const model = {
      ...template,
      id,
      name: typeof entry.display_name === "string" && entry.display_name.length > 0 ? entry.display_name : id,
      api: "openai-codex-responses",
      provider: PROVIDER,
      baseUrl: baseURL,
      input: input.length > 0 ? input : ["text"],
      reasoning: Array.isArray(entry.supported_reasoning_levels)
        ? levels !== undefined
        : knownModel?.reasoning ?? false,
      cost: knownModel?.cost ?? { ...ZERO_COST },
      contextWindow,
      maxTokens,
    };
    if (levels === undefined) delete model.thinkingLevelMap;
    else model.thinkingLevelMap = levels;
    mapped.push(model);
  }

  if (mapped.length === 0) throw new TypeError("Codex model catalog response contains no supported models");
  return mapped;
}

/**
 * Fetch and cache the OAuth account's Codex model catalog.
 *
 * Cache entries are isolated by account, API base URL, and client version. A
 * failed request reuses that account's previous catalog, then the bundled
 * pi-ai catalog when no account-specific cache exists.
 */
export class CodexModelCatalog {
  constructor({
    store,
    fallbackModels = openaiCodexProvider().getModels(),
    fetchImpl = (...args) => globalThis.fetch(...args),
    now = () => Date.now(),
    cacheMs = MODEL_CATALOG_CACHE_MS,
    timeoutMs = MODEL_CATALOG_TIMEOUT_MS,
  }) {
    this.store = store;
    this.fallbackModels = fallbackModels;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.cacheMs = cacheMs;
    this.timeoutMs = timeoutMs;
    this.entries = new Map();
    this.inflight = new Map();
    this.models = fallbackModels;
    this.activeKey = "bundled";
    this.activeSignature = modelSignature(fallbackModels);
    this.revision = 0;
  }

  getModels() {
    return this.models;
  }

  activate(key, models) {
    const signature = modelSignature(models);
    if (key !== this.activeKey || signature !== this.activeSignature) this.revision += 1;
    this.activeKey = key;
    this.activeSignature = signature;
    this.models = models;
  }

  async refresh({
    baseURL,
    clientVersion = DEFAULT_MODEL_CATALOG_CLIENT_VERSION,
    force = false,
  } = {}) {
    let credential;
    try {
      credential = await this.store?.read(PROVIDER);
    } catch {
      credential = undefined;
    }
    const accountId = credential?.accountId ?? accountIdFromJwt(credential?.access);
    if (typeof credential?.access !== "string" || credential.access.length === 0 || !accountId) {
      this.activate("bundled", this.fallbackModels);
      return this.models;
    }

    const resolvedBaseURL = (baseURL ?? "https://chatgpt.com/backend-api").replace(/\/+$/, "");
    const key = JSON.stringify([accountId, resolvedBaseURL, clientVersion]);
    const cached = this.entries.get(key);
    if (!force && cached !== undefined && this.now() - cached.fetchedAt < this.cacheMs) {
      this.activate(key, cached.models);
      return this.models;
    }
    const pending = this.inflight.get(key);
    if (pending !== undefined) {
      await pending;
      const current = this.entries.get(key);
      this.activate(key, current?.models ?? this.fallbackModels);
      return this.models;
    }

    const request = this.fetchCatalog({
      key,
      cached,
      credential,
      accountId,
      baseURL: resolvedBaseURL,
      clientVersion,
    });
    this.inflight.set(key, request);
    try {
      await request;
    } finally {
      this.inflight.delete(key);
    }
    const current = this.entries.get(key);
    this.activate(key, current?.models ?? this.fallbackModels);
    return this.models;
  }

  async fetchCatalog({ key, cached, credential, accountId, baseURL, clientVersion }) {
    let timer;
    const controller = new AbortController();
    try {
      const url = new URL(`${baseURL}${MODEL_CATALOG_PATH}`);
      url.searchParams.set("client_version", clientVersion);
      const headers = {
        accept: "application/json",
        authorization: `Bearer ${credential.access}`,
        "chatgpt-account-id": accountId,
        originator: WIRE_ORIGINATOR,
        ...(cached?.etag === undefined ? {} : { "if-none-match": cached.etag }),
      };
      timer = setTimeout(() => controller.abort(new Error("Codex model catalog request timed out")), this.timeoutMs);
      const response = await this.fetchImpl(url.toString(), { method: "GET", headers, signal: controller.signal });
      const fetchedAt = this.now();
      if (response.status === 304 && cached !== undefined) {
        this.entries.set(key, { ...cached, fetchedAt });
        return;
      }
      if (!response.ok) throw new Error(`Codex model catalog returned HTTP ${response.status}`);
      const payload = await response.json();
      const models = mapCodexModelCatalog(payload, { baseURL, fallbackModels: this.fallbackModels });
      this.entries.set(key, {
        models,
        etag: response.headers?.get?.("etag") ?? undefined,
        fetchedAt,
      });
    } catch {
      // Keep a last-known account catalog on transient failures; otherwise
      // cache the bundled fallback briefly to avoid a request storm.
      this.entries.set(key, {
        models: cached?.models ?? this.fallbackModels,
        etag: cached?.etag,
        fetchedAt: this.now(),
      });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}

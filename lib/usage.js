/**
 * Codex account quota retrieval for dsh-codex.
 *
 * ChatGPT exposes the logged-in subscription usage through the undocumented
 * read-only `wham/usage` endpoint under the same backend host the Codex
 * Responses API uses (`GET {baseURL}/wham/usage`). The response carries the
 * rolling 5-hour window, the weekly window, and — for accounts with one — the
 * Spark plan's own 5-hour/weekly windows. Everything here is parsed
 * defensively: a shape change or failure degrades to "usage unavailable"
 * instead of breaking `/codex status`.
 *
 * The endpoint is read-only and needs only the OAuth access token the plugin
 * already stores; no new credential is introduced. Tokens never enter logs or
 * error messages.
 *
 * @module dsh-codex/usage
 */

import { DEFAULT_BASE_URL } from "./constants.js";
import { attributionHeaders } from "@deepseek-ai/dsh-llm";

/** Default timeout for one usage query (a slow quota endpoint must not hang status). */
export const DEFAULT_USAGE_TIMEOUT_MS = 5000;

/** The usage endpoint path appended to the configured base URL. */
export const USAGE_PATH = "/wham/usage";

/** Referer the ChatGPT settings page sends on this endpoint. */
const USAGE_REFERER = "https://chatgpt.com/codex/settings/usage";

/**
 * A single quota window (for example a primary or secondary limit window).
 * @typedef {Object} UsageWindow
 * @property {string} label - stable window role (`primary`, `secondary`, or Spark variant).
 * @property {number} [windowSeconds] - server-declared duration of the window.
 * @property {number} percentage - used percent (0..100).
 * @property {number} nextResetAt - epoch ms when the window resets.
 */

/**
 * Parse one `used_percent` / reset pair into a window, or `undefined` when the
 * window is absent or malformed. The server-declared duration is authoritative;
 * the role name must not be mistaken for a fixed five-hour window.
 */
function parseWindow(label, value, now) {
  const percentage = numberValue(value.used_percent);
  if (percentage === null) return undefined;
  const nextResetAt = resetAt(value, now);
  if (nextResetAt === undefined) return undefined;
  const windowSeconds = windowDurationSeconds(value);
  return {
    label,
    percentage,
    nextResetAt,
    ...(windowSeconds === undefined ? {} : { windowSeconds }),
  };
}

/** Read the server-declared quota duration in seconds. */
function windowDurationSeconds(value) {
  const seconds = numberValue(value.limit_window_seconds);
  return seconds !== null && seconds > 0 ? Math.round(seconds) : undefined;
}

/** Resolve the window reset time in epoch ms (string date, epoch s, or seconds-left). */
function resetAt(value, now) {
  const raw = value.reset_at;
  if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw < 10_000_000_000 ? raw * 1000 : raw;
  }
  const seconds = numberValue(value.reset_after_seconds);
  if (seconds !== null) return now + seconds * 1000;
  return undefined;
}

function numberValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringValue(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/**
 * Parse a `wham/usage` response body into quota windows plus the plan label.
 * @param data - the parsed JSON response.
 * @param now - reference clock (epoch ms), injectable for tests.
 * @returns {{ windows: UsageWindow[], planLabel?: string }}
 * @throws when no quota window could be parsed (defensive: treat as unavailable).
 */
export function parseUsageResponse(data, now = Date.now()) {
  const root = asRecord(data);
  const rateLimit = asRecord(root.rate_limit);
  const windows = [
    parseWindow("primary", asRecord(rateLimit.primary_window), now),
    parseWindow("secondary", asRecord(rateLimit.secondary_window), now),
    ...parseSparkWindows(root, now),
  ].filter((window) => window !== undefined);
  if (windows.length === 0) {
    throw new Error("codex usage response carries no quota windows");
  }
  const planLabel =
    stringValue(root.plan_type) ??
    stringValue(asRecord(root.account).plan_type) ??
    stringValue(asRecord(root.subscription).plan_type);
  return { windows, ...(planLabel === undefined ? {} : { planLabel }) };
}

/** Spark plan quotas live under `additional_rate_limits` (only some accounts). */
function parseSparkWindows(root, now) {
  const extra = asRecord(root.additional_rate_limits);
  const spark = Object.values(extra).find((it) =>
    stringValue(asRecord(it).limit_name)?.toLowerCase().includes("spark") === true,
  );
  if (spark === undefined) return [];
  const rateLimit = asRecord(asRecord(spark).rate_limit);
  return [
    parseWindow("spark primary", asRecord(rateLimit.primary_window), now),
    parseWindow("spark secondary", asRecord(rateLimit.secondary_window), now),
  ].filter((window) => window !== undefined);
}

/**
 * Fetch the current Codex account usage.
 * @param credential - the stored OAuth record `{ access, accountId? }`.
 * @param options - `{ baseURL?, timeoutMs?, signal? }`; baseURL defaults to the
 *   Codex backend host so a configured endpoint stays honored.
 * @returns the parsed usage snapshot.
 * @throws on non-2xx, timeout, abort, or an unparseable body.
 */
export async function fetchUsage(credential, options = {}) {
  const baseURL = (options.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_USAGE_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(new Error("codex usage query timed out")), timeoutMs);
  const signal = options.signal;
  const onAbort = () => controller.abort(signal?.reason);
  if (signal !== undefined && !signal.aborted) {
    signal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    const response = await fetch(`${baseURL}${USAGE_PATH}`, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${credential.access}`,
        referer: USAGE_REFERER,
        "x-openai-target-path": `/backend-api${USAGE_PATH}`,
        ...(credential.accountId === undefined ? {} : { "chatgpt-account-id": credential.accountId }),
        ...attributionHeaders(),
      },
    });
    if (!response.ok) {
      throw new Error(`codex usage query failed with HTTP ${response.status}`);
    }
    return parseUsageResponse(await response.json());
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}

/** Render a reset deadline like "3h 12m" / "42m" / "in 2s" / "now". */
export function describeReset(nextResetAt, now = Date.now()) {
  const ms = Math.max(0, nextResetAt - now);
  const minutes = Math.floor(ms / 60000);
  if (minutes <= 0) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

function describeWindow(window) {
  const prefix = window.label.startsWith("spark ") ? "spark " : "";
  const seconds = window.windowSeconds;
  if (seconds === 18_000) return `${prefix}5h`;
  if (seconds === 604_800) return `${prefix}week`;
  if (seconds !== undefined) return `${prefix}${describeWindowDuration(seconds)}`;
  return window.label;
}

function describeWindowDuration(seconds) {
  if (seconds % 604_800 === 0) return `${seconds / 604_800}w`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

/**
 * Format one usage snapshot as a compact status line.
 * @param snapshot - `parseUsageResponse` output.
 * @returns e.g. `Usage: [Plus] 5h 43% (reset 2h 5m) · week 10% (reset Fri)`.
 */
export function formatUsageSummary(snapshot, now = Date.now()) {
  const head = snapshot.planLabel === undefined ? "Usage:" : `Usage: [${snapshot.planLabel}]`;
  const parts = snapshot.windows.map((window) => {
    const pct = Math.round(window.percentage);
    return `${describeWindow(window)} ${pct}% (reset ${describeReset(window.nextResetAt, now)})`;
  });
  return `${head} ${parts.join(" · ")}`;
}
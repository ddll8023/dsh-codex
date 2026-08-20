/**
 * dsh-codex shared constants.
 *
 * Provider identity, wire defaults, credential namespace, and OAuth timing
 * policy. Everything here is plugin-owned; nothing reaches the harness core.
 *
 * @module dsh-codex/constants
 */

/** The single provider route this plugin registers on `ctx.llm`. */
export const PROVIDER = "openai-codex";

/** Provider display name shown in pickers and diagnostics. */
export const PROVIDER_NAME = "OpenAI Codex";

/** Default endpoint per the Codex Responses API contract. */
export const DEFAULT_BASE_URL = "https://chatgpt.com/backend-api";

/** Request path appended to the base URL. */
export const RESPONSES_PATH = "/codex/responses";

/**
 * Credential-reference namespace inside the harness credential seam. The seam
 * stores ref -> string; OAuth records are persisted as one JSON document under
 * this ref. The ref must be a POSIX identifier (the seam's `credentialRef`
 * rule) — `openai-codex` cannot be a ref literal, so the plugin's own
 * namespace is `OPENAI_CODEX_OAUTH`, documented in README.
 */
export const OAUTH_REF = "OPENAI_CODEX_OAUTH";

/** OAuth token "about to expire" lead time: refresh when <= 5 minutes remain. */
export const DEFAULT_REFRESH_LEAD_MS = 5 * 60 * 1000;

/** Background refresh interval; also the timer cadence for preemptive refresh. */
export const DEFAULT_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

/** Default maximum idle interval while an adapter stream read is outstanding. */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/** Host usage cache TTL (covers command + settings Remote dedup). */
export const USAGE_CACHE_MS = 30_000;

/** Client stale threshold for visibility-based re-sync. */
export const USAGE_STALE_MS = 30_000;

/** Client polling backoff for in-flight login. */
export const LOGIN_POLL_INITIAL_MS = 2000;
export const LOGIN_POLL_MAX_MS = 10_000;
export const LOGIN_POLL_BACKOFF = 1.5;
export const LOGIN_POLL_HIDDEN_MS = 5000;

/** Default context capacity for a model neither the catalog nor config sizes. */
export const DEFAULT_CONTEXT_WINDOW = 128000;

/** Default output cap for a model neither the catalog nor config declares. */
export const DEFAULT_MAX_TOKENS = 128000;

/** JWT claim path carrying the ChatGPT account id (per the Codex protocol). */
export const JWT_ACCOUNT_CLAIM = "https://api.openai.com/auth";

/**
 * `originator` identity sent on Codex requests. Reusing pi-ai's provider, the
 * value is pi-ai's own marker ("pi"); see README protocol notes.
 */
export const WIRE_ORIGINATOR = "pi";

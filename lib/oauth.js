/**
 * OAuth login orchestration for dsh-codex.
 *
 * The actual PKCE/device flows belong to pi-ai's `openai-codex` provider
 * (authorization-code + PKCE with random state validated by its local callback
 * server on http://localhost:1455/auth/callback, plus the headless device-code
 * flow). This module adapts pi-ai's `AuthInteraction` surface to the harness
 * command registry:
 *
 * - `prompt` answers pi-ai's login-method select from the command flags and
 *   parks the manual-code prompt open until the flow settles or aborts, so a
 *   browser-callback login never depends on interactive paste.
 * - `notify` collects the auth URL / device code so the command can render it
 *   immediately while the flow continues in the background.
 *
 * Login runs detached from the command turn: the handler returns the URL/code
 * right away and the flow finishes when the callback lands (or fails with a
 * status-visible error). Tokens are persisted through the credential seam;
 * nothing is printed, logged, or stored in session events.
 *
 * @module dsh-codex/oauth
 */

import { PROVIDER, PROVIDER_NAME } from "./constants.js";
import { fetchUsage, formatUsageSummary } from "./usage.js";

/** Render a human duration like "3 minutes" / "under a minute" / "expired". */
export function describeExpiry(expires) {
  const ms = expires - Date.now();
  if (ms <= 0) return "expired";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${Math.floor(hours / 24)} day${Math.floor(hours / 24) === 1 ? "" : "s"}`;
}

/**
 * Parse the raw input of `/codex <args>`.
 * @param rawInput - raw text after the command name (leading whitespace included).
 * @returns { command, flags, rest } - first word (or "") plus flag set and remaining words.
 */
export function parseCodexInput(rawInput) {
  const words = rawInput.trim().split(/\s+/).filter((word) => word.length > 0);
  const command = words[0] ?? "";
  const flags = new Set(words.filter((word) => word.startsWith("--")));
  const rest = words.filter((word) => !word.startsWith("--"));
  return { command, flags, rest };
}

/**
 * Build the pi-ai `AuthInteraction` for one login run.
 * @param method - "browser" or "device_code" (from the command flags).
 * @param signal - plugin-owned cancellation; the command-turn signal must NOT
 *   be used because the flow outlives the turn.
 * @param onNotify - sink for progress events (URLs, device codes).
 * @returns the interaction object pi-ai's login expects.
 */
export function codexInteraction(method, signal, onNotify) {
  const notify = (event) => {
    try {
      onNotify?.(event);
    } catch {
      // a broken sink must never kill the login flow
    }
  };
  return {
    signal,
    async prompt(prompt) {
      if (prompt.type === "select") {
        // pi-ai asks browser vs device_code; answer from the command flags.
        return method === "device_code" ? "device_code" : "browser";
      }
      if (prompt.type === "manual_code") {
        // Park open: the browser callback resolves the flow; either signal
        // (the flow's own manual-prompt abort, or the plugin's login abort)
        // cancels it.
        return new Promise((_resolve, reject) => {
          const onAbort = () => {
            prompt.signal?.removeEventListener("abort", onAbort);
            signal?.removeEventListener("abort", onAbort);
            reject(new Error("login cancelled"));
          };
          if (signal?.aborted || prompt.signal?.aborted) {
            onAbort();
            return;
          }
          prompt.signal?.addEventListener("abort", onAbort, { once: true });
          signal?.addEventListener("abort", onAbort, { once: true });
        });
      }
      // text/secret prompts are not used by the Codex flow; refuse loudly.
      throw new Error(`dsh-codex: unexpected login prompt type "${prompt.type}"`);
    },
    notify,
  };
}

/**
 * Run one login flow through pi-ai's Models, persisting the credential.
 * @param models - pi-ai Models collection owning the openai-codex provider.
 * @param method - "browser" | "device_code".
 * @param signal - plugin-owned AbortSignal.
 * @param onNotify - optional sink for pi-ai progress events (auth URL, device code).
 * @returns the persisted credential.
 */
export async function runLogin(models, method, signal, onNotify) {
  const interaction = codexInteraction(method, signal, onNotify);
  return models.login(PROVIDER, "oauth", interaction);
}

/**
 * Log the user out by deleting the stored credential.
 * @param models - pi-ai Models collection.
 */
export async function runLogout(models) {
  await models.logout(PROVIDER);
}

/**
 * Describe the current account usage for `/codex status` / `/codex usage`.
 *
 * Never throws: any failure (endpoint unavailable, non-2xx, unparseable body,
 * token expiry race) degrades to an explicit "unavailable" line so the login
 * status itself always renders. The quota endpoint is read-only and requires
 * only the stored OAuth access token.
 * @param models - pi-ai Models collection.
 * @param store - the credential store.
 * @returns a usage line, or `undefined` when not logged in.
 */
export async function describeUsage(models, store) {
  const record = await store.read(PROVIDER).catch(() => undefined);
  if (record === undefined) return undefined;
  try {
    const provider = models.getProvider(PROVIDER);
    return formatUsageSummary(await fetchUsage(record, { baseURL: provider?.baseUrl }));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return `Usage: unavailable (${detail})`;
  }
}

/**
 * Build a human-readable `/codex status` report. Never includes tokens.
 * @param models - pi-ai Models collection.
 * @param store - the credential store (for reading account/expiry metadata).
 * @param pending - in-flight login record (from the plugin), if any.
 * @returns the report text.
 */
export async function describeStatus(models, store, pending) {
  const lines = [];
  if (pending !== undefined) {
    lines.push(`Login in progress (${pending.method === "device_code" ? "device code" : "browser"} flow).`);
    if (pending.url !== undefined) lines.push(`Open: ${pending.url}`);
    if (pending.userCode !== undefined) lines.push(`Device code: ${pending.userCode} — verify at ${pending.verificationUri}`);
    if (pending.error !== undefined) lines.push(`Last login attempt failed: ${pending.error}`);
  }
  const credential = await models.checkAuth(PROVIDER);
  if (credential === undefined) {
    lines.push(`${PROVIDER_NAME}: not logged in. Run /codex login (or /codex login --device on headless machines).`);
    return lines.join("\n");
  }
  const record = await store.read(PROVIDER).catch(() => undefined);
  lines.push(`${PROVIDER_NAME}: logged in (OAuth).`);
  lines.push(`Account: ${record?.accountId ?? "unknown"}`);
  lines.push(`Token expires in ${describeExpiry(record?.expires ?? 0)}; refresh is automatic.`);
  const usage = await describeUsage(models, store);
  if (usage !== undefined) lines.push(usage);
  return lines.join("\n");
}

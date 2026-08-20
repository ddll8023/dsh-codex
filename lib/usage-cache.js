/**
 * Host-side usage cache with inflight dedup.
 * Coalesces concurrent `wham/usage` fetches into one promise and caches for
 * USAGE_CACHE_MS. Used by both /codex commands and codexAccount Remote.
 *
 * @module dsh-codex/usage-cache
 */

import { USAGE_CACHE_MS } from "./constants.js";
import { fetchUsage } from "./usage.js";

export function createUsageCache({ store, models, providerId, safeMessage }) {
  let cache = null; // { at, value }
  let inflight = null;

  async function get() {
    if (cache && Date.now() - cache.at < USAGE_CACHE_MS) return cache.value;
    if (inflight) return inflight;
    inflight = (async () => {
      const record = await store.read(providerId).catch(() => undefined);
      if (record === undefined) return { status: "not_logged_in" };
      try {
        const provider = models().getProvider(providerId);
        const usage = await fetchUsage(record, { baseURL: provider?.baseUrl });
        const value = { status: "ok", ...usage, fetchedAt: Date.now() };
        cache = { at: Date.now(), value };
        return value;
      } catch (error) {
        const value = { status: "unavailable", message: safeMessage(error, "usage unavailable"), fetchedAt: Date.now() };
        cache = { at: Date.now(), value };
        return value;
      }
    })();
    try { return await inflight; } finally { inflight = null; }
  }

  function invalidate() { cache = null; inflight = null; }

  return { get, invalidate, _peek: () => ({ cache, inflight }) };
}

/**
 * pi-ai `Models` collection construction for dsh-codex.
 *
 * Each configuration snapshot owns one immutable collection: pi-ai's
 * `openai-codex` provider (the Codex Responses wire implementation) rebuilt
 * with the configured base URL applied to every catalog model. A
 * configuration change builds a NEW collection rather than mutating the one
 * in use, because `Models.streamSimple()` is lazy — it resolves the provider
 * when the stream is first consumed — so an operation captures the snapshot
 * it started under.
 *
 * The credential store is shared across snapshots: it is the plugin's own
 * seam-backed store, so rotated tokens persist regardless of which collection
 * a request ran under.
 *
 * @module dsh-codex/models
 */

import { createModels } from "@earendil-works/pi-ai";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { PROVIDER } from "./constants.js";

/**
 * Build a fresh `Models` collection for one connection snapshot.
 * @param store - the plugin's credential store (shared across snapshots).
 * @param baseURL - configured endpoint (defaults to the catalog's).
 * @returns a MutableModels collection holding the openai-codex provider.
 */
export function buildModels(store, baseURL) {
  const base = openaiCodexProvider();
  const models = createModels({ credentials: store });
  if (baseURL === undefined || baseURL === base.baseUrl) {
    models.setProvider(base);
    return models;
  }
  // Rebuild with the configured endpoint on every catalog model. Requests
  // resolve their URL from model.baseUrl, so this is the one knob that moves
  // the wire target.
  const provider = {
    ...base,
    baseUrl: baseURL,
    getModels: () => base.getModels().map((model) => (model.baseUrl === baseURL ? model : { ...model, baseUrl: baseURL })),
  };
  models.setProvider(provider);
  return models;
}

export { PROVIDER };

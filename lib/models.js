/**
 * pi-ai `Models` collection construction for dsh-codex.
 *
 * Each connection/catalog snapshot owns one immutable collection: pi-ai's
 * `openai-codex` provider supplies the Codex Responses wire implementation,
 * while the model records come from the account catalog (or the bundled
 * catalog fallback). Every record is pinned to the configured base URL. A
 * configuration or catalog change builds a NEW collection rather than
 * mutating the one in use, because `Models.streamSimple()` is lazy — it
 * resolves the provider when the stream is first consumed — so an operation
 * captures the snapshot it started under.
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
 * @param baseURL - configured endpoint (defaults to the pi-ai provider's).
 * @param catalogModels - account-specific model records; omitted for the
 *   bundled pi-ai catalog.
 * @returns a MutableModels collection holding the openai-codex provider.
 */
export function buildModels(store, baseURL, catalogModels) {
  const base = openaiCodexProvider();
  const targetBaseURL = baseURL ?? base.baseUrl;
  const selectedModels = catalogModels ?? base.getModels();
  const models = createModels({ credentials: store });
  // The directory only supplies model metadata. Never let a catalog response
  // redirect OAuth credentials or requests to a server-controlled base URL.
  const provider = {
    ...base,
    baseUrl: targetBaseURL,
    getModels: () => selectedModels.map((model) => (
      model.baseUrl === targetBaseURL ? model : { ...model, baseUrl: targetBaseURL }
    )),
  };
  models.setProvider(provider);
  return models;
}

export { PROVIDER };

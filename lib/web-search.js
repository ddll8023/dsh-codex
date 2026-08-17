/**
 * Request-local translation from Harness `web_search` to the Codex Responses
 * hosted Web Search tool.
 *
 * This module deliberately has no Harness Web Runtime dependency. The caller
 * supplies the current turn's tool schemas, and the returned `onPayload`
 * callback only rewrites the Codex request that is about to be sent.
 *
 * @module dsh-codex/web-search
 */

/** Modes implemented by the public Codex Responses request format. */
export const CODEX_WEB_SEARCH_MODES = ["live", "cached", "indexed", "disabled"];

const WEB_SEARCH_NAME = "web_search";

/** Whether the current Harness turn exposes the ordinary web_search function. */
export function hasHarnessWebSearch(tools) {
  return Array.isArray(tools) && tools.some((tool) => tool?.name === WEB_SEARCH_NAME);
}

/** Build the hosted tool shape accepted by the Codex Responses backend. */
export function hostedWebSearchTool(mode) {
  switch (mode) {
    case "live":
      return { type: "web_search", external_web_access: true };
    case "cached":
      return { type: "web_search", external_web_access: false };
    case "indexed":
      return { type: "web_search", external_web_access: true, indexed_web_access: true };
    case "disabled":
      return undefined;
    default:
      throw new Error(`dsh-codex: unsupported webSearchMode "${String(mode)}"`);
  }
}

/**
 * Rewrite one final Codex Responses payload.
 *
 * `undefined` means no change. A Harness web_search permission is required
 * before this function can add the hosted tool; configuration alone never
 * grants network access to a turn.
 */
export function transformCodexPayload(body, { nativeWebSearch = true, webSearchMode = "live", harnessTools } = {}) {
  if (!nativeWebSearch || webSearchMode === "disabled" || !hasHarnessWebSearch(harnessTools)) return undefined;
  if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;

  const hosted = hostedWebSearchTool(webSearchMode);
  if (hosted === undefined) return undefined;

  const tools = Array.isArray(body.tools) ? body.tools : [];
  const nextTools = [];
  let hostedInserted = false;
  for (const tool of tools) {
    if (tool?.type === "function" && tool.name === WEB_SEARCH_NAME) continue;
    if (tool?.type === "web_search") {
      if (!hostedInserted) {
        nextTools.push(hosted);
        hostedInserted = true;
      }
      continue;
    }
    nextTools.push(tool);
  }
  if (!hostedInserted) nextTools.push(hosted);

  return { ...body, tools: nextTools };
}

/**
 * Create pi-ai's `onPayload` hook for one immutable Harness turn.
 * Returns `undefined` when no hook is needed, so ordinary Codex requests keep
 * pi-ai's original payload byte-for-byte equivalent.
 */
export function createCodexPayloadTransformer({ tools, nativeWebSearch = true, webSearchMode = "live" } = {}) {
  if (!nativeWebSearch || webSearchMode === "disabled" || !hasHarnessWebSearch(tools)) return undefined;
  return (body) => transformCodexPayload(body, { nativeWebSearch, webSearchMode, harnessTools: tools });
}

export { WEB_SEARCH_NAME };

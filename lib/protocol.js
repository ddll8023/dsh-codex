/**
 * Shared Typert descriptors for dsh-codex Host Remotes.
 *
 * Single source of truth for `codexUsage` and `codexAccount` wire contracts.
 * Host (account-remote.js / usage-remote.js) and Web (client.js) import from
 * here so typeSymbol / schema drift is impossible.
 *
 * @module dsh-codex/protocol
 */

function strict(schema, typeSymbol, parse) {
  return { mode: "strict", typeSymbol, schema: { parse } };
}

function assertAccountStatus(v) {
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw new TypeError("account status must be object");
  if (typeof v.loggedIn !== "boolean") throw new TypeError("loggedIn must be boolean");
  if (v.pending !== undefined && v.pending !== null) {
    if (typeof v.pending !== "object" || Array.isArray(v.pending)) throw new TypeError("pending must be object");
    if (typeof v.pending.method !== "string") throw new TypeError("pending.method must be string");
  }
  return v;
}

function assertUsageResult(v) {
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw new TypeError("usage must be object");
  if (v.status !== "ok" && v.status !== "not_logged_in" && v.status !== "unavailable") throw new TypeError("invalid status");
  return v;
}

function assertLoginInput(v) {
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw new TypeError("login input must be object");
  if (v.method !== "browser" && v.method !== "device_code") throw new TypeError("invalid login method");
  return v;
}

export const CODEX_USAGE_REMOTE = {
  package: "dsh-codex",
  descriptors: [
    {
      id: "dsh-codex#codexUsage/get",
      service: "codexUsage",
      namespace: "codexUsage",
      method: "get",
      invocation: { kind: "direct" },
      parameters: [],
      result: strict({ parse: assertUsageResult }, "dsh-codex#CodexUsageResult", assertUsageResult),
    },
  ],
};

export const CODEX_ACCOUNT_REMOTE = {
  package: "dsh-codex",
  descriptors: [
    {
      id: "dsh-codex#codexAccount/getStatus",
      service: "codexAccount",
      namespace: "codexAccount",
      method: "getStatus",
      invocation: { kind: "direct" },
      parameters: [],
      result: strict({ parse: assertAccountStatus }, "dsh-codex#CodexAccountResult", assertAccountStatus),
    },
    {
      id: "dsh-codex#codexAccount/startLogin",
      service: "codexAccount",
      namespace: "codexAccount",
      method: "startLogin",
      invocation: { kind: "direct" },
      parameters: [{ name: "input", wire: "input", source: "json", codec: strict({ parse: assertLoginInput }, "dsh-codex#CodexLoginInput", assertLoginInput) }],
      result: strict({ parse: (v) => v }, "dsh-codex#CodexAccountResult", (v) => v),
    },
    {
      id: "dsh-codex#codexAccount/cancelLogin",
      service: "codexAccount",
      namespace: "codexAccount",
      method: "cancelLogin",
      invocation: { kind: "direct" },
      parameters: [],
      result: strict({ parse: (v) => v }, "dsh-codex#CodexAccountResult", (v) => v),
    },
    {
      id: "dsh-codex#codexAccount/logout",
      service: "codexAccount",
      namespace: "codexAccount",
      method: "logout",
      invocation: { kind: "direct" },
      parameters: [],
      result: strict({ parse: (v) => v }, "dsh-codex#CodexAccountResult", (v) => v),
    },
    {
      id: "dsh-codex#codexAccount/refreshUsage",
      service: "codexAccount",
      namespace: "codexAccount",
      method: "refreshUsage",
      invocation: { kind: "direct" },
      parameters: [],
      result: strict({ parse: assertUsageResult }, "dsh-codex#CodexUsageResult", assertUsageResult),
    },
  ],
};

export const CODEX_REMOTE = {
  package: "dsh-codex",
  descriptors: [...CODEX_USAGE_REMOTE.descriptors, ...CODEX_ACCOUNT_REMOTE.descriptors],
};

export { assertAccountStatus, assertLoginInput, assertUsageResult };

/**
 * Credential persistence for dsh-codex.
 *
 * The plugin stores OAuth records through the harness credential seam
 * (`ctx.credentials`, provided by `dsh-credentials-local`): one JSON document
 * under the `OPENAI_CODEX_OAUTH` reference. The seam is the plugin API's own
 * credential store — the file lives at `$DSH_HOME/.credentials.yaml`, is
 * created/replaced at mode 0600, hot-reloads, and serializes writes — so the
 * plugin never invents its own secret file and never touches the token store
 * of any other provider. DeepSeek API keys stay untouched under their own
 * refs; nothing here can read or write them.
 *
 * The seam stores strings only, so the record is JSON. The stored shape is
 * exactly pi-ai's OAuth credential (pi-ai reads it back through the
 * `CredentialStore` contract):
 *
 * ```json
 * { "type": "oauth", "access": "...", "refresh": "...",
 *   "expires": 1750000000000, "accountId": "user-..." }
 * ```
 *
 * `accountId` is resolved from the JWT claim
 * `https://api.openai.com/auth.chatgpt_account_id` at login/refresh time and
 * persisted beside the tokens; it is used only for the `chatgpt-account-id`
 * request header (pi-ai derives it from the access token itself) and for
 * `/codex status` output. Tokens never enter logs, session events, settings,
 * or error messages.
 *
 * @module dsh-codex/credentials
 */

import { OAUTH_REF } from "./constants.js";

/** Stable machine code for credential-record failures. */
const INVALID_RECORD_CODE = "INVALID_CREDENTIAL_RECORD";

/**
 * Extract the ChatGPT account id from an access-token JWT payload claim
 * `https://api.openai.com/auth.chatgpt_account_id`. Returns `undefined` when
 * the token is not a JWT or the claim is absent — never throws, so a malformed
 * token surfaces as a missing account rather than an opaque crash.
 * @param accessToken - the raw access token.
 * @returns the account id, or `undefined`.
 */
export function accountIdFromJwt(accessToken) {
  if (typeof accessToken !== "string") return undefined;
  const parts = accessToken.split(".");
  if (parts.length !== 3) return undefined;
  try {
    // atob is a Node/browser global; tolerate missing padding per JWT base64url.
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded));
    const auth = payload?.["https://api.openai.com/auth"];
    const id = auth?.chatgpt_account_id;
    return typeof id === "string" && id.length > 0 ? id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Validate a raw credential record read from the seam. The seam guarantees a
 * string; the plugin guarantees the JSON shape. Anything else is treated as
 * absent (a corrupt record must not crash requests — it reads as "not logged
 * in", and the login command overwrites it).
 * @param raw - the raw stored string, or `undefined`.
 * @returns the parsed pi-ai OAuth credential, or `undefined`.
 */
export function parseStoredCredential(raw) {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value;
  if (record.type !== "oauth") return undefined;
  if (typeof record.access !== "string" || record.access.length === 0) return undefined;
  if (typeof record.refresh !== "string" || record.refresh.length === 0) return undefined;
  if (typeof record.expires !== "number" || !Number.isFinite(record.expires)) return undefined;
  return record;
}

/**
 * Render a validated credential record for the seam (JSON string). The seam
 * refuses empty strings; a record always carries tokens.
 * @param credential - pi-ai OAuth credential.
 * @returns the JSON string to store.
 */
export function renderStoredCredential(credential) {
  return JSON.stringify(credential);
}

/**
 * The harness credential seam adapter used by dsh-codex, implementing pi-ai's
 * `CredentialStore` contract (`read` / `list` / `modify` / `delete`) over
 * `ctx.credentials`. `modify` serializes per provider id through a promise
 * chain, so concurrent refresh requests run one at a time — the second caller
 * sees the first caller's rotated token and skips its own refresh (the
 * double-checked-refresh pattern pi-ai relies on).
 */
export class SeamCredentialStore {
  constructor(ctx, ref = OAUTH_REF) {
    this.ctx = ctx;
    this.ref = ref;
    this.chains = new Map();
  }

  /** The credentials service, or `undefined` when the seam is not mounted. */
  seam() {
    return this.ctx.get("credentials");
  }

  /** Serialize one operation per provider id. */
  enqueue(providerId, operation) {
    const tail = this.chains.get(providerId) ?? Promise.resolve();
    const next = tail.then(operation, operation);
    this.chains.set(providerId, next.then(() => undefined, () => undefined));
    return next;
  }

  async read(providerId) {
    void providerId; // one record per plugin; provider id is informational
    const seam = this.seam();
    if (seam === undefined) return undefined;
    const hit = await seam.resolve(this.ref);
    return hit === undefined ? undefined : parseStoredCredential(hit.value);
  }

  async list() {
    const seam = this.seam();
    if (seam === undefined) return [];
    const hit = await seam.resolve(this.ref);
    return hit === undefined ? [] : [{ providerId: "openai-codex", type: "oauth" }];
  }

  async modify(providerId, fn) {
    return this.enqueue(providerId, async () => {
      const seam = this.seam();
      if (seam === undefined) {
        throw new Error("dsh-codex: the credentials service is not mounted; cannot persist OAuth tokens");
      }
      const current = parseStoredCredential((await seam.resolve(this.ref))?.value);
      const next = await fn(current);
      if (next === undefined || next === current) return current ?? undefined;
      if (next.type !== "oauth") {
        throw new TypeError(`dsh-codex: modify must return an oauth credential, got ${String(next.type)}`);
      }
      const rendered = renderStoredCredential(next);
      await seam.set(this.ref, rendered);
      return next;
    });
  }

  async delete(providerId) {
    return this.enqueue(providerId, async () => {
      const seam = this.seam();
      if (seam === undefined) return;
      await seam.unset(this.ref);
    });
  }
}

/**
 * Refresh an OAuth credential before it is "about to expire", using pi-ai's
 * own refresh implementation under the store lock (double-checked: the second
 * concurrent caller sees the rotated token and does nothing). On refresh
 * failure the stored credential is left untouched and the error propagates
 * with a clear message.
 * @param store - the credential store.
 * @param oauth - pi-ai's OAuthAuth for the provider (`.refresh`).
 * @param leadMs - refresh when `expires - now <= leadMs`.
 * @returns the freshened credential, or `undefined` when nothing was stored.
 */
export async function freshenCredential(store, oauth, leadMs) {
  const post = await store.modify("openai-codex", async (current) => {
    if (current === undefined) return undefined;
    if (Date.now() + leadMs < current.expires) return undefined; // still fresh
    try {
      const refreshed = await oauth.refresh(current);
      if (refreshed.accountId === undefined) {
        refreshed.accountId = accountIdFromJwt(refreshed.access);
      }
      return refreshed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const wrapped = new Error(
        `dsh-codex: OAuth token refresh failed; keeping the previous credential — ${message}`,
        { cause: error },
      );
      wrapped.code = "AUTH";
      throw wrapped;
    }
  });
  return post;
}

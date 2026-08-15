import test from "node:test";
import assert from "node:assert/strict";
import { freshenCredential } from "../lib/credentials.js";
import { SeamCredentialStore } from "../lib/credentials.js";
import { fakeCredentialsService, makeCredential } from "./helpers.js";

function makeStore(initial) {
  const seam = fakeCredentialsService(
    initial === undefined ? {} : { OPENAI_CODEX_OAUTH: JSON.stringify(initial) },
  );
  const ctx = { get: (name) => (name === "credentials" ? seam : undefined) };
  return { store: new SeamCredentialStore(ctx), seam };
}

function makeOAuth(overrides = {}) {
  let refreshCalls = 0;
  return {
    name: "OpenAI (ChatGPT Plus/Pro)",
    refreshCalls: () => refreshCalls,
    async refresh(credential) {
      refreshCalls += 1;
      if (overrides.fail) throw new Error(overrides.fail);
      return { ...credential, access: `rotated-${refreshCalls}`, expires: Date.now() + 3600_000 };
    },
    async toAuth(credential) {
      return { apiKey: credential.access };
    },
  };
}

test("freshen skips a token that is not about to expire", async () => {
  const credential = makeCredential({ expires: Date.now() + 2 * 3600_000 });
  const { store } = makeStore(credential);
  const oauth = makeOAuth();
  const post = await freshenCredential(store, oauth, 5 * 60_000);
  assert.deepEqual(post, credential);
  assert.equal(oauth.refreshCalls(), 0);
});

test("freshen refreshes a token within the lead time and persists the rotation", async () => {
  const credential = makeCredential({ expires: Date.now() + 60_000 });
  const { store } = makeStore(credential);
  const oauth = makeOAuth();
  const post = await freshenCredential(store, oauth, 5 * 60_000);
  assert.equal(oauth.refreshCalls(), 1);
  assert.equal(post.access, "rotated-1");
  assert.equal(post.expires > Date.now() + 3_000_000, true);
  const stored = await store.read("openai-codex");
  assert.equal(stored.access, "rotated-1");
});

test("concurrent freshen calls refresh exactly once (double-checked under the lock)", async () => {
  const credential = makeCredential({ expires: Date.now() + 60_000 });
  const { store } = makeStore(credential);
  const oauth = makeOAuth();
  const results = await Promise.all([
    freshenCredential(store, oauth, 5 * 60_000),
    freshenCredential(store, oauth, 5 * 60_000),
    freshenCredential(store, oauth, 5 * 60_000),
  ]);
  assert.equal(oauth.refreshCalls(), 1);
  for (const post of results) assert.equal(post.access, "rotated-1");
  const stored = await store.read("openai-codex");
  assert.equal(stored.access, "rotated-1");
});

test("refresh failure keeps the previous credential and reports a clear AUTH error", async () => {
  const credential = makeCredential({ expires: Date.now() + 60_000 });
  const { store, seam } = makeStore(credential);
  const oauth = makeOAuth({ fail: "invalid_grant" });
  await assert.rejects(
    () => freshenCredential(store, oauth, 5 * 60_000),
    (error) => {
      assert.match(error.message, /refresh failed/i);
      assert.match(error.message, /keeping the previous credential/i);
      assert.equal(error.code, "AUTH");
      return true;
    },
  );
  // The stored credential is untouched.
  assert.equal(seam.values.get("OPENAI_CODEX_OAUTH"), JSON.stringify(credential));
  assert.deepEqual(await store.read("openai-codex"), credential);
});

test("freshen with no stored credential is a no-op", async () => {
  const { store } = makeStore();
  const oauth = makeOAuth();
  const post = await freshenCredential(store, oauth, 5 * 60_000);
  assert.equal(post, undefined);
  assert.equal(oauth.refreshCalls(), 0);
});

test("freshen backfills accountId when neither the stored nor refreshed record has one", async () => {
  const credential = makeCredential({ accountId: undefined, expires: Date.now() + 60_000 });
  const { store } = makeStore(credential);
  let calls = 0;
  const oauth = {
    async refresh(current) {
      calls += 1;
      return { ...current, access: "token-without-account", expires: Date.now() + 3600_000 };
    },
  };
  const post = await freshenCredential(store, oauth, 5 * 60_000);
  assert.equal(calls, 1);
  assert.equal(post.access, "token-without-account");
  // Not a JWT, so the backfill finds nothing — and does not invent a value.
  assert.equal(post.accountId, undefined);
});

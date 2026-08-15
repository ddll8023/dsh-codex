import test from "node:test";
import assert from "node:assert/strict";
import { SeamCredentialStore, parseStoredCredential, renderStoredCredential, accountIdFromJwt } from "../lib/credentials.js";
import { OAUTH_REF } from "../lib/constants.js";
import { fakeCredentialsService, makeCredential, makeAccessToken } from "./helpers.js";

test("accountIdFromJwt reads the chatgpt_account_id claim", () => {
  const token = makeAccessToken("user-abc123");
  assert.equal(accountIdFromJwt(token), "user-abc123");
});

test("accountIdFromJwt returns undefined for malformed or claim-less tokens", () => {
  assert.equal(accountIdFromJwt("not-a-jwt"), undefined);
  assert.equal(accountIdFromJwt("a.b.c"), undefined);
  assert.equal(accountIdFromJwt(undefined), undefined);
  const noClaim = makeAccessToken().split(".")[0] + "." + Buffer.from(JSON.stringify({ sub: "x" })).toString("base64url") + ".sig";
  assert.equal(accountIdFromJwt(noClaim), undefined);
});

test("parseStoredCredential accepts a valid record and rejects corrupt ones", () => {
  const credential = makeCredential();
  const parsed = parseStoredCredential(renderStoredCredential(credential));
  assert.equal(parsed.type, "oauth");
  assert.equal(parsed.accountId, "user-test123");
  assert.equal(typeof parsed.access, "string");
  assert.equal(typeof parsed.refresh, "string");

  assert.equal(parseStoredCredential(undefined), undefined);
  assert.equal(parseStoredCredential(""), undefined);
  assert.equal(parseStoredCredential("{not json"), undefined);
  assert.equal(parseStoredCredential(JSON.stringify({ type: "api_key", key: "x" })), undefined);
  assert.equal(parseStoredCredential(JSON.stringify({ type: "oauth", access: "", refresh: "r", expires: 1 })), undefined);
  assert.equal(parseStoredCredential(JSON.stringify({ type: "oauth", access: "a", refresh: "r", expires: "soon" })), undefined);
});

test("SeamCredentialStore read/modify/delete round-trip through the seam", async () => {
  const seam = fakeCredentialsService();
  const ctx = { get: (name) => (name === "credentials" ? seam : undefined) };
  const store = new SeamCredentialStore(ctx);
  assert.equal(await store.read("openai-codex"), undefined);
  assert.deepEqual(await store.list(), []);

  const credential = makeCredential();
  const written = await store.modify("openai-codex", async () => credential);
  assert.equal(written, credential);
  assert.equal(seam.values.get(OAUTH_REF), renderStoredCredential(credential));
  assert.deepEqual(await store.list(), [{ providerId: "openai-codex", type: "oauth" }]);
  assert.deepEqual(await store.read("openai-codex"), credential);

  // modify returning undefined leaves the entry unchanged
  await store.modify("openai-codex", async () => undefined);
  assert.deepEqual(await store.read("openai-codex"), credential);

  await store.delete("openai-codex");
  assert.equal(await store.read("openai-codex"), undefined);
  assert.equal(seam.values.has(OAUTH_REF), false);
});

test("SeamCredentialStore serializes concurrent modify calls", async () => {
  const seam = fakeCredentialsService();
  const ctx = { get: (name) => (name === "credentials" ? seam : undefined) };
  const store = new SeamCredentialStore(ctx);
  const order = [];
  const results = await Promise.all(
    [1, 2, 3].map((n) =>
      store.modify("openai-codex", async (current) => {
        order.push(`start-${n}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push(`end-${n}`);
        return { type: "oauth", access: `a${n}`, refresh: `r${n}`, expires: Date.now() + 1000, accountId: `u${n}` };
      }),
    ),
  );
  assert.equal(order.filter((step) => step.startsWith("start-")).length, 3);
  // Writes land in completion order because each fn runs to completion before
  // the next starts (per-provider promise chain).
  assert.equal(order[0], "start-1");
  assert.equal(order[5], "end-3");
  const final = await store.read("openai-codex");
  assert.equal(final.access, "a3");
});

test("SeamCredentialStore refuses when the credentials service is absent", async () => {
  const ctx = { get: () => undefined };
  const store = new SeamCredentialStore(ctx);
  await assert.rejects(() => store.modify("openai-codex", async (current) => current ?? makeCredential()), /credentials service is not mounted/);
  assert.equal(await store.read("openai-codex"), undefined);
});

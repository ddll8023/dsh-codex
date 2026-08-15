import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { SeamCredentialStore } from "../lib/credentials.js";
import { runLogin } from "../lib/oauth.js";
import { buildModels } from "../lib/models.js";
import { fakeCredentialsService, mockFetch, jsonResponse, makeAccessToken } from "./helpers.js";

const DEVICE_USER_CODE_URL = "https://auth.openai.com/api/accounts/deviceauth/usercode";
const DEVICE_TOKEN_URL = "https://auth.openai.com/api/accounts/deviceauth/token";
const TOKEN_URL = "https://auth.openai.com/oauth/token";

function makeStore(initial = {}) {
  const seam = fakeCredentialsService(initial);
  const ctx = { get: (name) => (name === "credentials" ? seam : undefined) };
  return { store: new SeamCredentialStore(ctx), seam };
}

test("device-code login persists an OAuth credential with accountId (mock HTTP)", async () => {
  const { store } = makeStore();
  const models = buildModels(store, undefined);
  let polls = 0;
  const { restore } = mockFetch(({ url }) => {
    if (url === DEVICE_USER_CODE_URL) {
      return jsonResponse(200, { device_auth_id: "da-1", user_code: "ABCD-EFGH", interval: "0.01" });
    }
    if (url === DEVICE_TOKEN_URL) {
      polls += 1;
      if (polls === 1) {
        return new Response("", { status: 403 }); // authorization pending
      }
      return jsonResponse(200, { authorization_code: "auth-code-device", code_verifier: "verifier-1" });
    }
    if (url === TOKEN_URL) {
      return jsonResponse(200, {
        access_token: makeAccessToken("user-oauth-device"),
        refresh_token: "refresh-device",
        expires_in: 3600,
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  try {
    const notified = [];
    const credential = await runLogin(models, "device_code", new AbortController().signal, (event) => notified.push(event));
    assert.equal(credential.type, "oauth");
    assert.equal(credential.accountId, "user-oauth-device");
    assert.equal(credential.refresh, "refresh-device");
    assert.ok(credential.expires > Date.now());
    const stored = await store.read("openai-codex");
    assert.equal(stored.access, credential.access);
    assert.equal(stored.accountId, "user-oauth-device");
    const deviceEvent = notified.find((event) => event.type === "device_code");
    assert.ok(deviceEvent, "device_code notify event emitted");
    assert.equal(deviceEvent.userCode, "ABCD-EFGH");
    assert.equal(deviceEvent.verificationUri, "https://auth.openai.com/codex/device");
  } finally {
    restore();
  }
});

test("token response validation rejects a response missing required fields", async () => {
  const { store } = makeStore();
  const models = buildModels(store, undefined);
  let polls = 0;
  const { restore } = mockFetch(({ url }) => {
    if (url === DEVICE_USER_CODE_URL) {
      return jsonResponse(200, { device_auth_id: "da-2", user_code: "WXYZ-1234", interval: "0.01" });
    }
    if (url === DEVICE_TOKEN_URL) {
      polls += 1;
      if (polls === 1) return new Response("", { status: 403 });
      return jsonResponse(200, { authorization_code: "auth-code-2", code_verifier: "verifier-2" });
    }
    if (url === TOKEN_URL) {
      return jsonResponse(200, { access_token: "only-access" }); // no refresh_token, no expires_in
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  try {
    await assert.rejects(
      () => runLogin(models, "device_code", new AbortController().signal),
      /token exchange response missing fields/,
    );
    assert.equal(await store.read("openai-codex"), undefined);
  } finally {
    restore();
  }
});

test("browser login: PKCE authorize URL + state-validated local callback (real loopback server)", async (t) => {
  // Probe whether the loopback port is free; skip gracefully when busy.
  const port = 1455;
  const probe = await new Promise((resolve) => {
    const server = http.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
  if (!probe) {
    t.skip("port 1455 is busy; cannot run the loopback callback test");
    return;
  }

  const { store } = makeStore();
  const models = buildModels(store, undefined);
  const { restore } = mockFetch(({ url }) => {
    if (url === TOKEN_URL) {
      return jsonResponse(200, {
        access_token: makeAccessToken("user-oauth-browser"),
        refresh_token: "refresh-browser",
        expires_in: 3600,
      });
    }
    if (url.startsWith("http://127.0.0.1:") || url.startsWith("http://localhost:")) {
      return undefined; // loopback callback bypasses the mock
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  try {
    const notified = [];
    const flow = runLogin(models, "browser", new AbortController().signal, (event) => notified.push(event));
    // Wait for the auth URL event, then drive the callback.
    const authUrl = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no auth_url notify within timeout")), 5000);
      const check = () => {
        const event = notified.find((entry) => entry.type === "auth_url");
        if (event !== undefined) {
          clearTimeout(timer);
          resolve(event.url);
        }
      };
      const interval = setInterval(check, 10);
      check();
      flow.then(() => clearInterval(interval), () => clearInterval(interval));
    });
    assert.ok(authUrl.startsWith("https://auth.openai.com/oauth/authorize?"), "authorize URL emitted");
    const parsed = new URL(authUrl);
    assert.ok(parsed.searchParams.has("code_challenge"), "PKCE code_challenge present");
    assert.equal(parsed.searchParams.get("code_challenge_method"), "S256");
    const state = parsed.searchParams.get("state");
    assert.ok(state, "random state present");

    // Wrong state must be refused by the local callback server.
    const wrong = await fetch(`http://127.0.0.1:${port}/auth/callback?state=wrong-state&code=x`);
    assert.equal(wrong.status, 400);
    assert.match(await wrong.text(), /State mismatch/);

    // Correct state + code completes the flow.
    const right = await fetch(`http://127.0.0.1:${port}/auth/callback?state=${encodeURIComponent(state)}&code=auth-code-browser`);
    assert.equal(right.status, 200);

    const credential = await flow;
    assert.equal(credential.accountId, "user-oauth-browser");
    assert.equal(credential.refresh, "refresh-browser");
    const stored = await store.read("openai-codex");
    assert.equal(stored.access, credential.access);
  } finally {
    restore();
  }
});

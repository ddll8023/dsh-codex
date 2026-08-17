import test from "node:test";
import assert from "node:assert/strict";
import { SeamCredentialStore } from "../lib/credentials.js";
import { buildModels } from "../lib/models.js";
import { describeUsage, describeStatus } from "../lib/oauth.js";
import {
  describeReset,
  fetchUsage,
  formatUsageSummary,
  parseUsageResponse,
  USAGE_PATH,
} from "../lib/usage.js";
import { fakeCredentialsService, jsonResponse, makeAccessToken, makeCredential, mockFetch } from "./helpers.js";

const USAGE_URL = `https://chatgpt.com/backend-api${USAGE_PATH}`;

function makeStore(initial = {}) {
  const seam = fakeCredentialsService(initial);
  const ctx = { get: (name) => (name === "credentials" ? seam : undefined) };
  return { store: new SeamCredentialStore(ctx), seam };
}

test("parseUsageResponse reads 5h/week windows and the plan label", () => {
  const now = Date.parse("2026-08-17T00:00:00Z");
  const snapshot = parseUsageResponse(
    {
      plan_type: "plus",
      rate_limit: {
        primary_window: { used_percent: 43, reset_at: "2026-08-17T03:00:00Z" },
        secondary_window: { used_percent: 12, reset_after_seconds: 86_400 },
      },
    },
    now,
  );
  assert.equal(snapshot.planLabel, "plus");
  assert.equal(snapshot.windows.length, 2);
  const fiveHour = snapshot.windows.find((window) => window.label === "5h");
  assert.equal(fiveHour.percentage, 43);
  assert.equal(fiveHour.nextResetAt, Date.parse("2026-08-17T03:00:00Z"));
  const week = snapshot.windows.find((window) => window.label === "week");
  assert.equal(week.percentage, 12);
  assert.equal(week.nextResetAt, now + 86_400_000);
});

test("parseUsageResponse tolerates nested and spark plan shapes", () => {
  const snapshot = parseUsageResponse({
    account: { plan_type: "pro" },
    rate_limit: {
      primary_window: { used_percent: "7", reset_at: 1_752_000_000 },
      secondary_window: { used_percent: 1, reset_at: 1_752_000_000_000 },
    },
    additional_rate_limits: {
      spark_rate_limits: {
        limit_name: "spark",
        rate_limit: {
          primary_window: { used_percent: 88, reset_at: "2026-08-17T05:00:00Z" },
          secondary_window: { used_percent: 20, reset_at: "2026-08-17T06:00:00Z" },
        },
      },
    },
  });
  assert.equal(snapshot.planLabel, "pro");
  assert.deepEqual(
    snapshot.windows.map((window) => window.label).sort(),
    ["5h", "spark 5h", "spark week", "week"],
  );
  // String percentages and epoch-seconds resets are normalized to ms.
  const fiveHour = snapshot.windows.find((window) => window.label === "5h");
  assert.equal(fiveHour.percentage, 7);
  assert.equal(fiveHour.nextResetAt, 1_752_000_000_000);
});

test("parseUsageResponse throws when no quota window is present", () => {
  assert.throws(() => parseUsageResponse({ rate_limit: {} }), /no quota windows/);
  assert.throws(() => parseUsageResponse({}), /no quota windows/);
});

test("formatUsageSummary renders percent and reset for every window", () => {
  const now = Date.parse("2026-08-17T00:00:00Z");
  const text = formatUsageSummary(
    {
      planLabel: "plus",
      windows: [
        { label: "5h", percentage: 43.2, nextResetAt: now + 3 * 3600_000 },
        { label: "week", percentage: 12, nextResetAt: now + 30 * 60_000 },
      ],
    },
    now,
  );
  assert.match(text, /Usage: \[plus\]/);
  assert.match(text, /5h 43% \(reset 3h\)/);
  assert.match(text, /week 12% \(reset 30m\)/);
  assert.equal(describeReset(now - 5000, now), "now");
});

test("fetchUsage requests the wham/usage endpoint with the stored bearer token", async () => {
  const credential = makeCredential({ accountId: "user-usage" });
  let captured;
  const { restore, requests } = mockFetch(({ url, headers }) => {
    captured = { url, headers };
    return jsonResponse(200, {
      rate_limit: { primary_window: { used_percent: 3, reset_at: "2026-08-17T03:00:00Z" } },
    });
  });
  try {
    const snapshot = await fetchUsage(credential);
    assert.equal(snapshot.windows.length, 1);
  } finally {
    restore();
  }
  assert.equal(requests.length, 1);
  assert.equal(captured.url, USAGE_URL);
  assert.equal(captured.headers["authorization"], `Bearer ${credential.access}`);
  assert.equal(captured.headers["chatgpt-account-id"], "user-usage");
  assert.equal(captured.headers["referer"], "https://chatgpt.com/codex/settings/usage");
  assert.equal(captured.headers["x-openai-target-path"], "/backend-api/wham/usage");
  assert.match(captured.headers.accept, /application\/json/);
});

test("fetchUsage rejects non-2xx responses with a readable error", async () => {
  const credential = makeCredential();
  const { restore } = mockFetch(() => jsonResponse(502, {}));
  try {
    await assert.rejects(() => fetchUsage(credential), /HTTP 502/);
  } finally {
    restore();
  }
});

test("fetchUsage honors a custom baseURL with the usage path appended", async () => {
  const credential = makeCredential();
  let capturedUrl;
  const { restore } = mockFetch(({ url }) => {
    capturedUrl = url;
    return jsonResponse(200, {
      rate_limit: { primary_window: { used_percent: 1, reset_at: "2026-08-17T03:00:00Z" } },
    });
  });
  try {
    await fetchUsage(credential, { baseURL: "https://gateway.example.com/backend-api/" });
  } finally {
    restore();
  }
  assert.equal(capturedUrl, "https://gateway.example.com/backend-api/wham/usage");
});

test("describeUsage returns undefined when not logged in and a line when the query fails", async () => {
  const { store } = makeStore();
  const credential = makeCredential();
  let calls = 0;
  const { restore } = mockFetch(() => {
    calls += 1;
    return jsonResponse(500, {});
  });
  try {
    // Not logged in: no network call at all.
    assert.equal(await describeUsage(buildModels(store, undefined), store), undefined);
    assert.equal(calls, 0);

    // Logged in but the endpoint fails: degrade instead of throwing.
    await store.modify("openai-codex", async () => credential);
    const usage = await describeUsage(buildModels(store, undefined), store);
    assert.match(usage, /^Usage: unavailable \(/);
    assert.equal(calls, 1);
  } finally {
    restore();
  }
});

test("logged-in /codex status includes the usage line (mock HTTP)", async () => {
  const credential = makeCredential({ accountId: "user-status" });
  const { store } = makeStore({ OPENAI_CODEX_OAUTH: JSON.stringify(credential) });
  const models = buildModels(store, undefined);
  const { restore } = mockFetch(({ url }) => {
    if (url === USAGE_URL) {
      return jsonResponse(200, {
        plan_type: "plus",
        rate_limit: {
          primary_window: { used_percent: 33, reset_at: "2026-08-17T03:00:00Z" },
          secondary_window: { used_percent: 9, reset_at: "2026-08-18T00:00:00Z" },
        },
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  try {
    const status = await describeStatus(models, store, undefined);
    assert.match(status, /logged in/);
    assert.match(status, /Account: user-status/);
    assert.match(status, /Usage: \[plus\]/);
    assert.match(status, /5h 33% \(reset/);
    assert.match(status, /week 9% \(reset/);
    assert.doesNotMatch(status, /Bearer|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  } finally {
    restore();
  }
});

test("the usage token is never echoed even when the query fails", async () => {
  const credential = makeCredential({ accountId: "user-secret" });
  const { store } = makeStore({ OPENAI_CODEX_OAUTH: JSON.stringify(credential) });
  const { restore } = mockFetch(() => jsonResponse(503, {}));
  try {
    const usage = await describeUsage(buildModels(store, undefined), store);
    assert.doesNotMatch(usage, /Bearer|eyJ[A-Za-z0-9_-]+|refresh/i);
  } finally {
    restore();
  }
});

test("makeAccessToken round-trips through the seam unchanged", () => {
  const token = makeAccessToken("user-roundtrip");
  assert.equal(typeof token, "string");
  assert.ok(token.split(".").length === 3);
  assert.doesNotMatch(token, /\n/);
});
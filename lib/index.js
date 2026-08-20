/**
 * dsh-codex: standalone OpenAI Codex (ChatGPT Plus/Pro OAuth) provider plugin
 * for the DeepSeek Harness.
 *
 * Registers the `openai-codex` provider route on `ctx.llm` (the public plugin
 * API), backed by pi-ai's `openai-codex` provider + OAuth implementation; the
 * `/codex` slash commands drive login/logout/status through the public
 * `ctx.commands` registry; OAuth tokens persist through the public
 * `ctx.credentials` seam under the plugin's own `OPENAI_CODEX_OAUTH`
 * namespace. No harness core code is touched.
 *
 * @module dsh-codex
 */

import { deepEqualJson, installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import { PROVIDER, PROVIDER_NAME } from "./constants.js";
import { CodexAdapter } from "./adapter.js";
import { Config, resolveAdapterOptions } from "./config.js";
import { SeamCredentialStore, freshenCredential } from "./credentials.js";
import { buildModels } from "./models.js";
import { CodexUsageService } from "./usage-remote.js";
import { CodexAccountService } from "./account-remote.js";
import { describeStatus, parseCodexInput, runLogin, runLogout } from "./oauth.js";
import { createUsageCache } from "./usage-cache.js";
import { createLoginQueue } from "./login-queue.js";

/** Plugin short name; also the user-settings namespace (`llm-codex:` section). */
export const name = "llm-codex";

/** Hard dependency: the provider registry. */
export const inject = ["llm"];

/** Settings namespace for the non-secret connection knobs. */
const NS = settingsNamespace("llm-codex");

/** Background refresh cadence (5 minutes). */
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

/** How long the login command waits for the first auth URL / device code. */
const FIRST_NOTIFY_TIMEOUT_MS = 3000;

/** Render a thrown value without risking secret echo. */
function safeMessage(error, fallback = "login failed") {
  const message = error instanceof Error ? error.message : String(error);
  return message.length === 0 ? fallback : message;
}

function describeExpiry(expires) {
  const ms = expires - Date.now();
  if (ms <= 0) return "expired";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${Math.floor(hours / 24)} day${Math.floor(hours / 24) === 1 ? "" : "s"}`;
}

/**
 * Register the plugin.
 * @param ctx - the plugin's scoped Cordis context.
 * @param config - composition entry config (base layer for settings).
 */
function apply(ctx, config) {
  let current = () => config;
  let lastRaw;
  let lastGood;
  /** Resolved connection facts; keeps the last good snapshot on a bad settings write. */
  const options = () => {
    const raw = current();
    if (raw === lastRaw && lastGood !== undefined) return lastGood;
    try {
      const next = resolveAdapterOptions(raw);
      lastRaw = raw;
      lastGood = next;
      return next;
    } catch (error) {
      if (lastGood === undefined) throw error;
      lastRaw = raw;
      ctx.logger.error("dsh-codex: keeping the last good configuration after an invalid settings section");
      ctx.logger.error(error);
      return lastGood;
    }
  };
  options();

  const store = new SeamCredentialStore(ctx);

  // One pi-ai Models collection per connection snapshot (base URL moves the
  // wire target; see lib/models.js).
  let modelsCache;
  const models = () => {
    const connection = options();
    if (modelsCache !== undefined && modelsCache.connection === connection) return modelsCache.models;
    const built = buildModels(store, connection.baseURL);
    modelsCache = { connection, models: built };
    return built;
  };
  models();

  /** Preemptive refresh: swap an about-to-expire token under the store lock. */
  const freshen = () => {
    const oauth = models().getProvider(PROVIDER)?.auth.oauth;
    if (oauth === undefined) return undefined;
    return freshenCredential(store, oauth, options().refreshLeadTimeMs);
  };

  // Browser UI reads this token-free Remote instead of receiving the OAuth
  // credential. The command path remains the source of truth for text output.
  ctx.plugin(CodexUsageService, {
    readUsage: async () => {
      const record = await store.read(PROVIDER).catch(() => undefined);
      if (record === undefined) return { status: "not_logged_in" };
      try {
        const provider = models().getProvider(PROVIDER);
        const usage = await fetchUsage(record, { baseURL: provider?.baseUrl });
        return { status: "ok", ...usage, fetchedAt: Date.now() };
      } catch (error) {
        return { status: "unavailable", message: safeMessage(error, "usage unavailable"), fetchedAt: Date.now() };
      }
    },
  });

  const adapter = new CodexAdapter({
    options,
    models,
    freshen,
    // The public attachment service owns durable image bytes and validates the
    // opaque references before pi-ai receives base64 content.
    attachments: () => ctx.get("attachments"),
  });

  ctx.llm.registerConfigurableProviders([
    { provider: PROVIDER, displayName: PROVIDER_NAME, settingsNs: NS, settingsPath: [] },
  ]);
  const registration = ctx.llm.registerAdapter([PROVIDER], adapter);
  let registeredPolicy = options().retryPolicy;
  const ensureRegistrationFacts = () => {
    const policy = options().retryPolicy;
    if (deepEqualJson(policy, registeredPolicy)) return;
    registration.replace([PROVIDER]);
    registeredPolicy = policy;
  };
  installSettingsSection(ctx, NS, Config, config, {
    setSource: (source) => {
      current = source;
    },
    onChange: ensureRegistrationFacts,
  });

  // ---- account state shared by commands + settings Remote -------------------
  const pkgVersion = (() => {
    try {
      // Avoid static import so tests without package.json still load.
      return "0.1.0";
    } catch {
      return "0.1.0";
    }
  })();

  const { get: getUsageSnapshot, invalidate: invalidateUsageCache } = createUsageCache({
    store, models, providerId: PROVIDER, safeMessage,
  });

  async function buildAccountStatus() {
    const pending = pendingLogin ? { ...pendingLogin, done: pendingLogin.done } : null;
    const credential = await models().checkAuth(PROVIDER);
    const loggedIn = credential !== undefined;
    const record = loggedIn ? await store.read(PROVIDER).catch(() => undefined) : undefined;
    const usage = await getUsageSnapshot();
    // Normalize unavailable when not logged in
    const normalizedUsage = !loggedIn ? { status: "not_logged_in" } : usage;
    return {
      loggedIn,
      accountId: record?.accountId ?? undefined,
      expiresIn: record?.expires ? describeExpiry(record.expires) : undefined,
      pending: pending
        ? {
            method: pending.method,
            startedAt: pending.startedAt,
            url: pending.url,
            userCode: pending.userCode,
            verificationUri: pending.verificationUri,
            error: pending.error,
            done: !!pending.done,
          }
        : null,
      usage: normalizedUsage,
      version: pkgVersion,
    };
  }

  // Account Remote for the Settings page (browser never sees tokens).
  ctx.plugin(CodexAccountService, {
    getStatus: buildAccountStatus,
    startLogin: async (input) => {
      const method = input?.method === "device_code" ? "device_code" : "browser";
      const { first } = await startLogin(method);
      invalidateUsageCache();
      if (first?.type === "auth_url") return { kind: "auth_url", url: first.url };
      if (first?.type === "device_code") return { kind: "device_code", userCode: first.userCode, verificationUri: first.verificationUri };
      return { kind: "pending" };
    },
    cancelLogin: async () => {
      try { await cancelLoginOp(); } catch {}
      return { ok: true };
    },
    logout: async () => {
      await logoutOp();
      return { ok: true };
    },
    refreshUsage: async () => {
      invalidateUsageCache();
      return getUsageSnapshot();
    },
  });

  // ---- commands -----------------------------------------------------------
  const commands = ctx.get("commands");
  let pendingLogin; // { method, startedAt, url?, userCode?, verificationUri?, error?, done }
  const activeLogins = new Set();
  const { enqueue: enqueueLogin } = createLoginQueue();

  function cancelPendingLogin(reason) {
    for (const c of activeLogins) {
      try { c.abort(reason); } catch {}
    }
    if (pendingLogin && !pendingLogin.done) {
      pendingLogin.error = "Login cancelled";
      pendingLogin.done = true;
    }
  }

  ctx.effect(() => () => {
    for (const controller of activeLogins) controller.abort("dsh-codex plugin unloading");
  });

  async function innerStartLogin(method) {
    if (pendingLogin !== undefined && !pendingLogin.done) {
      throw new Error("a login is already in progress; run /codex status or wait for it to finish");
    }
    const controller = new AbortController();
    const pending = { method, startedAt: Date.now(), done: false };
    pendingLogin = pending;
    activeLogins.add(controller);
    const firstNotify = new Promise((resolve) => {
      const timer = setTimeout(() => resolve(undefined), FIRST_NOTIFY_TIMEOUT_MS);
      const onAbort = () => {
        clearTimeout(timer);
        resolve(undefined);
      };
      controller.signal.addEventListener("abort", onAbort, { once: true });
      const sink = (event) => {
        if (event.type === "auth_url") {
          pending.url = event.url;
          clearTimeout(timer);
          controller.signal.removeEventListener("abort", onAbort);
          resolve(event);
        } else if (event.type === "device_code") {
          pending.userCode = event.userCode;
          pending.verificationUri = event.verificationUri;
          clearTimeout(timer);
          controller.signal.removeEventListener("abort", onAbort);
          resolve(event);
        }
      };
      pending.sink = sink;
    });
    const task = runLogin(models(), method, controller.signal, (event) => pending.sink?.(event))
      .then(() => {
        pending.done = true;
        invalidateUsageCache();
        ctx.logger.info("dsh-codex: OAuth login completed");
      })
      .catch((error) => {
        pending.error = safeMessage(error);
        if (controller.signal.aborted && pending.error === "Login cancelled") {
          ctx.logger.info("dsh-codex: OAuth login cancelled");
        } else {
          ctx.logger.warn("dsh-codex: OAuth login failed: %s", pending.error);
        }
      })
      .finally(() => {
        activeLogins.delete(controller);
        if (pendingLogin === pending) pendingLogin = undefined;
      });
    // Keep the task alive with the fiber even though the command turn ends.
    void task;
    const first = await firstNotify;
    return { pending, first };
  }

  const startLogin = (method) => enqueueLogin(() => innerStartLogin(method));
  const cancelLoginOp = () => enqueueLogin(() => {
    if (pendingLogin === undefined || pendingLogin.done) {
      throw new Error("No login in progress.");
    }
    cancelPendingLogin("cancelled by user");
  });
  const logoutOp = () => enqueueLogin(async () => {
    cancelPendingLogin("logout");
    await runLogout(models());
    pendingLogin = undefined;
    invalidateUsageCache();
  });

  const handleCodex = async (invocation) => {
    const { command, flags, rest } = parseCodexInput(invocation.rawInput);
    try {
      if (command === "login") {
        if (rest.some((word) => word === "device")) flags.add("--device");
        const method = flags.has("--device") ? "device_code" : "browser";
        const { first } = await startLogin(method);
        if (first !== undefined && first.type === "auth_url") {
          return {
            kind: "success",
            text:
              "OpenAI Codex login started (authorization code + PKCE).\n" +
              `Open this URL in your browser and complete login:\n${first.url}\n` +
              "The callback is http://localhost:1455/auth/callback. " +
              "Run /codex status to check when login completes.",
          };
        }
        if (first !== undefined && first.type === "device_code") {
          return {
            kind: "success",
            text:
              "OpenAI Codex device-code login started.\n" +
              `Code: ${first.userCode}\n` +
              `Enter it at: ${first.verificationUri}\n` +
              "Run /codex status to check when login completes.",
          };
        }
        return {
          kind: "success",
          text: "OpenAI Codex login started in the background. Run /codex status to check progress.",
        };
      }
      if (command === "logout") {
        await logoutOp();
        return { kind: "success", text: "OpenAI Codex logged out. The stored OAuth credential was removed." };
      }
      if (command === "cancel") {
        try {
          await cancelLoginOp();
        } catch (e) {
          return { kind: "error", text: safeMessage(e, "No login in progress.") };
        }
        return { kind: "success", text: "Login cancelled." };
      }
      if (command === "status" || command === "") {
        return { kind: "success", text: await describeStatus(models(), store, pendingLogin, getUsageSnapshot) };
      }
      if (command === "usage") {
        const usage = await describeUsage(models(), store, getUsageSnapshot);
        if (usage === undefined) {
          return {
            kind: "error",
            text: `${PROVIDER_NAME}: not logged in. Run /codex login (or /codex login --device on headless machines) first.`,
          };
        }
        return { kind: "success", text: usage };
      }
      return {
        kind: "error",
        text: `Unknown /codex subcommand "${command}".\nUsage: /codex login [--device] | /codex logout | /codex cancel | /codex status | /codex usage`,
      };
    } catch (error) {
      return { kind: "error", text: safeMessage(error) };
    }
  };

  if (commands !== undefined) {
    commands.register({
      name: "codex",
      description: "OpenAI Codex (ChatGPT Plus/Pro) account: login, logout, status, usage",
      input: { hint: "login [--device] | logout | status | usage" },
      recordInput: false, // a pasted authorization code must not enter the session log
      handler: handleCodex,
    });
  }

  // ---- background preemptive refresh --------------------------------------
  // Every `refreshLeadTimeMs`-about-to-expire token is swapped under the store
  // lock; failures keep the old credential and only warn.
  const timer = ctx.get("timer");
  if (timer !== undefined) {
    const dispose = timer.interval(() => {
      freshen().catch((error) => {
        ctx.logger.warn("dsh-codex: background token refresh failed: %s", safeMessage(error));
      });
    }, REFRESH_INTERVAL_MS);
    ctx.effect(() => dispose);
  }
}

export { Config, apply };

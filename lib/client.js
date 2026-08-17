window.__ModuleLoader__.load({
  id: "dsh-codex",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require("react");

    const NS = "codex";
    const PROVIDER = "openai-codex";
    const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

    const zh = {
      "usage.aria": "Codex 账户用量",
      "usage.loading": "Codex 用量加载中…",
      "usage.notLoggedIn": "Codex 未登录",
      "usage.unavailable": "Codex 用量不可用",
      "usage.summary": "Codex 用量：{summary}",
      "usage.details": "查看 Codex 用量详情",
      "usage.refresh": "刷新",
      "usage.refreshing": "刷新中…",
      "usage.loginHint": "请先运行 /codex login",
      "usage.error": "查询失败：{message}",
      "usage.reset": "重置 {value}",
      "usage.plan": "账户：{plan}",
      "usage.noWindows": "暂无配额窗口",
      "usage.now": "现在",
    };
    const en = {
      "usage.aria": "Codex account usage",
      "usage.loading": "Loading Codex usage…",
      "usage.notLoggedIn": "Codex not logged in",
      "usage.unavailable": "Codex usage unavailable",
      "usage.summary": "Codex usage: {summary}",
      "usage.details": "View Codex usage details",
      "usage.refresh": "Refresh",
      "usage.refreshing": "Refreshing…",
      "usage.loginHint": "Run /codex login first",
      "usage.error": "Query failed: {message}",
      "usage.reset": "reset {value}",
      "usage.plan": "Account: {plan}",
      "usage.noWindows": "No quota windows",
      "usage.now": "now",
    };

    const css = `
      .dsh-codex-usage-dock {
        box-sizing: border-box;
        position: relative;
        width: 100%;
        max-width: var(--dsh-chat-content-width, 748px);
        margin: 0 auto;
        padding: 0 16px 4px;
        color: var(--dsw-alias-label-tertiary);
        font-size: 12px;
        line-height: 20px;
        text-align: center;
      }
      .dsh-codex-usage-dock[data-compact="true"] {
        width: auto;
        max-width: min(360px, calc(100% - 32px));
        align-self: flex-end;
        margin: calc(-24px - var(--dsh-composer-stack-gap, 12px)) 16px 0 auto;
        padding: 0;
        z-index: 2;
        text-align: right;
      }
      .dsh-codex-usage-summary {
        max-width: 100%;
        color: var(--dsw-alias-label-tertiary);
        cursor: pointer;
        background: transparent;
        border: 0;
        border-radius: 6px;
        padding: 2px 6px;
        font: inherit;
        line-height: inherit;
        white-space: nowrap;
      }
      .dsh-codex-usage-summary:hover {
        color: var(--dsw-alias-label-secondary);
        background: var(--dsw-alias-interactive-bg-hover);
      }
      .dsh-codex-usage-summary:focus-visible,
      .dsh-codex-usage-refresh:focus-visible {
        outline: 2px solid var(--dsw-alias-border-l3);
        outline-offset: 1px;
      }
      .dsh-codex-usage-summary[data-error="true"] {
        color: var(--dsw-alias-state-error-primary);
      }
      .dsh-codex-usage-panel {
        box-sizing: border-box;
        position: absolute;
        right: 0;
        bottom: calc(100% + 8px);
        z-index: 100;
        width: min(360px, calc(100vw - 32px));
        max-width: none;
        margin: 0;
        padding: 10px 12px;
        color: var(--dsw-alias-label-primary);
        text-align: left;
        background: var(--dsw-specific-menu);
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 10px;
        box-shadow: var(--dsw-shadow-lv2);
      }
      @media (max-width: 640px) {
        .dsh-codex-usage-dock[data-compact="true"] {
          width: 100%;
          max-width: var(--dsh-chat-content-width, 748px);
          align-self: auto;
          margin: 0 auto;
          padding: 0 16px 4px;
          text-align: center;
        }
      }
      .dsh-codex-usage-panel-header,
      .dsh-codex-usage-row,
      .dsh-codex-usage-actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .dsh-codex-usage-panel-header {
        margin-bottom: 6px;
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
      }
      .dsh-codex-usage-list {
        margin: 0;
        padding: 0;
      }
      .dsh-codex-usage-row {
        min-height: 24px;
        border-top: 1px solid var(--dsw-alias-border-l1);
      }
      .dsh-codex-usage-row dt {
        color: var(--dsw-alias-label-secondary);
      }
      .dsh-codex-usage-row dd {
        margin: 0;
        color: var(--dsw-alias-label-primary);
        font-variant-numeric: tabular-nums;
      }
      .dsh-codex-usage-error,
      .dsh-codex-usage-hint {
        margin: 6px 0 0;
        color: var(--dsw-alias-state-error-primary);
      }
      .dsh-codex-usage-hint {
        color: var(--dsw-alias-label-tertiary);
      }
      .dsh-codex-usage-actions {
        justify-content: flex-end;
        margin-top: 8px;
      }
      .dsh-codex-usage-refresh {
        color: var(--dsw-alias-label-secondary);
        cursor: pointer;
        background: var(--dsw-alias-interactive-bg-hover);
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 6px;
        padding: 3px 8px;
        font: inherit;
      }
      .dsh-codex-usage-refresh:disabled {
        color: var(--dsw-alias-label-dimmed);
        cursor: default;
      }
    `;
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"dsh-codex-usage\"]") === null) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-codex";
      tag.dataset.pluginCss = "dsh-codex-usage";
      tag.textContent = css;
      document.head.appendChild(tag);
    }

    function strictSchema(parse) {
      return {
        mode: "strict",
        typeSymbol: "dsh-codex#CodexUsageResult",
        schema: { parse },
      };
    }

    function assertUsageResult(value) {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("Codex usage result must be an object");
      }
      if (value.status !== "ok" && value.status !== "not_logged_in" && value.status !== "unavailable") {
        throw new TypeError("Codex usage result has an invalid status");
      }
      if (value.status === "ok") {
        if (!Array.isArray(value.windows)) throw new TypeError("Codex usage result has no windows");
        for (const window of value.windows) {
          if (
            window === null ||
            typeof window !== "object" ||
            typeof window.label !== "string" ||
            typeof window.percentage !== "number" ||
            !Number.isFinite(window.percentage) ||
            typeof window.nextResetAt !== "number" ||
            !Number.isFinite(window.nextResetAt)
          ) {
            throw new TypeError("Codex usage result contains an invalid quota window");
          }
        }
      }
      if (value.status === "unavailable" && value.message !== undefined && typeof value.message !== "string") {
        throw new TypeError("Codex usage result has an invalid error message");
      }
      return value;
    }

    const CODEX_USAGE_REMOTE = {
      package: "dsh-codex",
      descriptors: [
        {
          id: "dsh-codex#codexUsage/get",
          service: "codexUsage",
          namespace: "codexUsage",
          method: "get",
          invocation: { kind: "direct" },
          parameters: [],
          result: strictSchema(assertUsageResult),
        },
      ],
    };

    class UsageStore {
      constructor(remote) {
        this.remote = remote;
        this.state = Object.freeze({ status: "idle", snapshot: null, message: null, fetchedAt: 0 });
        this.listeners = new Set();
        this.inflight = null;
        this.timer = null;
      }

      getSnapshot = () => this.state;

      subscribe = (listener) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      };

      setState(next) {
        this.state = Object.freeze({ ...this.state, ...next });
        for (const listener of this.listeners) listener();
      }

      ensure() {
        const stale = this.state.fetchedAt === 0 || Date.now() - this.state.fetchedAt >= REFRESH_INTERVAL_MS;
        if (this.inflight === null && (this.state.status === "idle" || stale)) this.refresh();
        if (this.timer === null) {
          this.timer = setInterval(() => {
            if (this.listeners.size > 0) this.refresh();
          }, REFRESH_INTERVAL_MS);
        }
      }

      refresh() {
        if (this.inflight !== null) return this.inflight;
        this.setState({ status: "loading", message: null });
        this.inflight = Promise.resolve()
          .then(() => this.remote.get())
          .then((result) => {
            if (!result?.ok) {
              this.setState({ status: "unavailable", message: result?.error?.message ?? "remote request failed", fetchedAt: Date.now() });
              return;
            }
            const value = result.value;
            if (value.status === "ok") {
              this.setState({ status: "ok", snapshot: value, message: null, fetchedAt: value.fetchedAt ?? Date.now() });
            } else {
              this.setState({ status: value.status, snapshot: null, message: value.message ?? null, fetchedAt: value.fetchedAt ?? Date.now() });
            }
          })
          .catch((error) => {
            this.setState({ status: "unavailable", message: error instanceof Error ? error.message : String(error), fetchedAt: Date.now() });
          })
          .finally(() => {
            this.inflight = null;
          });
        return this.inflight;
      }

      dispose() {
        if (this.timer !== null) clearInterval(this.timer);
        this.timer = null;
        this.listeners.clear();
      }
    }

    function resetLabel(nextResetAt, now, t) {
      const minutes = Math.floor(Math.max(0, nextResetAt - now) / 60000);
      if (minutes <= 0) return t("usage.now");
      if (minutes < 60) return `${minutes}m`;
      const hours = Math.floor(minutes / 60);
      const rest = minutes % 60;
      return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
    }

    function windowLabel(label) {
      if (label === "week") return "week";
      return label;
    }

    function hasVisibleStatsLine(settledNodes, usage, projected) {
      if (projected?.steps > 0) return true;
      if (projected == null && settledNodes.some((node) => node.kind === "assistant")) return true;
      if (usage != null) {
        const billedInput = (usage.uncachedInputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
        if (billedInput > 0 || (usage.outputTokens ?? 0) > 0) return true;
      }
      return false;
    }

    function CodexUsageDock({ sessionId, modelStore, usageStore, t, useSession, useProjection }) {
      const modelState = React.useSyncExternalStore(modelStore.subscribe, modelStore.getSnapshot, modelStore.getSnapshot);
      const usageState = React.useSyncExternalStore(usageStore.subscribe, usageStore.getSnapshot, usageStore.getSnapshot);
      const settledNodes = useSession((state) => state.chat.legacy.nodes);
      const usage = useProjection("tokenUsage");
      const projected = useProjection("sessionStats");
      const [expanded, setExpanded] = React.useState(false);
      const [now, setNow] = React.useState(Date.now());
      const isCodex = modelState.current?.provider === PROVIDER;
      const compact = hasVisibleStatsLine(settledNodes, usage, projected);

      React.useEffect(() => {
        if (!isCodex) {
          setExpanded(false);
          return undefined;
        }
        usageStore.ensure();
        const timer = setInterval(() => setNow(Date.now()), 30 * 1000);
        return () => clearInterval(timer);
      }, [isCodex, usageStore]);

      if (!isCodex) return null;

      const snapshot = usageState.snapshot;
      const windows = snapshot?.windows ?? [];
      const summary = windows
        .slice(0, 2)
        .map((window) => `${windowLabel(window.label)} ${Math.round(window.percentage)}%`)
        .join(" · ");
      const label =
        usageState.status === "loading" && snapshot === null
          ? t("usage.loading")
          : usageState.status === "not_logged_in"
            ? t("usage.notLoggedIn")
            : usageState.status === "unavailable" && snapshot === null
              ? t("usage.unavailable")
              : t("usage.summary", { summary: summary || t("usage.noWindows") });
      const error = usageState.status === "unavailable" ? usageState.message : null;
      const panelId = `dsh-codex-usage-panel-${String(sessionId ?? "session").replace(/[^a-zA-Z0-9_-]/g, "-")}`;

      return React.createElement(
        "div",
        { className: "dsh-codex-usage-dock", "data-compact": compact ? "true" : undefined },
        React.createElement(
          "button",
          {
            type: "button",
            className: "dsh-codex-usage-summary",
            "aria-label": t("usage.aria"),
            "aria-expanded": expanded,
            "aria-controls": expanded ? panelId : undefined,
            "data-error": error !== null || undefined,
            title: t("usage.details"),
            onClick: () => setExpanded((value) => !value),
          },
          label,
        ),
        expanded &&
          React.createElement(
            "div",
            { id: panelId, className: "dsh-codex-usage-panel", role: "status", "aria-live": "polite" },
            React.createElement(
              "div",
              { className: "dsh-codex-usage-panel-header" },
              React.createElement("span", null, snapshot?.planLabel ? t("usage.plan", { plan: snapshot.planLabel }) : t("usage.aria")),
              React.createElement("span", null, usageState.status === "loading" ? t("usage.refreshing") : ""),
            ),
            windows.length > 0
              ? React.createElement(
                  "dl",
                  { className: "dsh-codex-usage-list" },
                  windows.map((window) =>
                    React.createElement(
                      "div",
                      { className: "dsh-codex-usage-row", key: window.label },
                      React.createElement("dt", null, window.label),
                      React.createElement("dd", null, `${Math.round(window.percentage)}% · ${t("usage.reset", { value: resetLabel(window.nextResetAt, now, t) })}`),
                    ),
                  ),
                )
              : null,
            usageState.status === "not_logged_in" && React.createElement("p", { className: "dsh-codex-usage-hint" }, t("usage.loginHint")),
            usageState.status === "unavailable" && React.createElement("p", { className: "dsh-codex-usage-error" }, t("usage.error", { message: error ?? "unknown error" })),
            React.createElement(
              "div",
              { className: "dsh-codex-usage-actions" },
              React.createElement(
                "button",
                {
                  type: "button",
                  className: "dsh-codex-usage-refresh",
                  disabled: usageState.status === "loading",
                  onClick: () => usageStore.refresh(),
                },
                usageState.status === "loading" ? t("usage.refreshing") : t("usage.refresh"),
              ),
            ),
          ),
      );
    }

    const inject = ["slots", "remote", "locale", "modelDirectories"];

    async function apply(ctx) {
      await ctx.inject(inject, async (scope) => {
        scope.effect(() => scope.locale.register(NS, { zh, en }), "dsh-codex: usage UI dictionaries");
        const disposeRemote = await scope.remote.$mount(CODEX_USAGE_REMOTE);
        const usageRemote = scope.get("remote.codexUsage");
        if (usageRemote === undefined) {
          await disposeRemote();
          throw new Error("dsh-codex: usage Remote did not mount");
        }
        const usageStore = new UsageStore(usageRemote);
        scope.effect(() => async () => {
          usageStore.dispose();
          await disposeRemote();
        }, "dsh-codex: usage UI cleanup");
        const t = scope.locale.bind(NS);
        scope.slots.inject("conversation.composer.dock", () =>
          scope.slots.register(
            {
              name: "conversation.composer.dock",
              id: "codex-usage",
              order: 10,
              locale: NS,
              inject: (sessionId) => {
                const directory = scope.modelDirectories.directoryFor(sessionId);
                return { modelStore: directory.store, usageStore };
              },
            },
            CodexUsageDock,
          ),
        );
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});

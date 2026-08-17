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
      "usage.aria": "Codex 用量",
      "usage.loading": "Codex 用量加载中…",
      "usage.notLoggedIn": "Codex 未登录",
      "usage.unavailable": "Codex 用量暂不可用",
      "usage.summary": "Codex 用量：{summary}",
      "usage.summaryStale": "Codex 用量：{summary}（数据已过期）",
      "usage.summaryUpdating": "Codex 用量：{summary}（更新中…）",
      "usage.details": "查看 Codex 用量详情",
      "usage.dialogTitle": "Codex 用量详情",
      "usage.close": "关闭 Codex 用量详情",
      "usage.refresh": "刷新",
      "usage.refreshing": "刷新中…",
      "usage.loginHint": "请先运行 /codex login",
      "usage.error": "查询失败：{message}",
      "usage.reset": "距重置 {value}",
      "usage.resetAt": "重置于 {value}",
      "usage.used": "已用 {value}%",
      "usage.remaining": "剩余 {value}%",
      "usage.plan": "套餐：{plan}",
      "usage.planPlus": "Plus",
      "usage.planPro": "Pro",
      "usage.noWindows": "暂无配额窗口",
      "usage.now": "现在",
      "usage.updated": "更新于 {value}",
      "usage.updatedNow": "刚刚",
      "usage.updatedMinutes": "{value} 分钟前",
      "usage.updating": "更新中…",
      "usage.stale": "数据已过期",
      "usage.minutes": "{value} 分钟",
      "usage.hours": "{value} 小时",
      "usage.hoursMinutes": "{hours} 小时 {minutes} 分",
      "usage.window5h": "5 小时窗口",
      "usage.windowWeek": "本周窗口",
      "usage.windowSpark5h": "Spark 5 小时窗口",
      "usage.windowSparkWeek": "Spark 本周窗口",
      "usage.windowPrimary": "主要窗口",
      "usage.windowSecondary": "次要窗口",
      "usage.windowSparkPrimary": "Spark 主要窗口",
      "usage.windowSparkSecondary": "Spark 次要窗口",
      "usage.windowDuration": "{value} 窗口",
      "usage.windowSparkDuration": "Spark {value} 窗口",
      "usage.durationWeeks": "{value} 周",
      "usage.durationDays": "{value} 天",
      "usage.durationHours": "{value} 小时",
      "usage.durationMinutes": "{value} 分钟",
      "usage.durationSeconds": "{value} 秒",
      "usage.windowUnknown": "{label} 窗口",
    };
    const en = {
      "usage.aria": "Codex usage",
      "usage.loading": "Loading Codex usage…",
      "usage.notLoggedIn": "Codex not logged in",
      "usage.unavailable": "Codex usage unavailable",
      "usage.summary": "Codex usage: {summary}",
      "usage.summaryStale": "Codex usage: {summary} (data is stale)",
      "usage.summaryUpdating": "Codex usage: {summary} (updating…)",
      "usage.details": "View Codex usage details",
      "usage.dialogTitle": "Codex usage details",
      "usage.close": "Close Codex usage details",
      "usage.refresh": "Refresh",
      "usage.refreshing": "Refreshing…",
      "usage.loginHint": "Run /codex login first",
      "usage.error": "Query failed: {message}",
      "usage.reset": "resets in {value}",
      "usage.resetAt": "resets at {value}",
      "usage.used": "used {value}%",
      "usage.remaining": "remaining {value}%",
      "usage.plan": "Plan: {plan}",
      "usage.planPlus": "Plus",
      "usage.planPro": "Pro",
      "usage.noWindows": "No quota windows",
      "usage.now": "now",
      "usage.updated": "Updated {value}",
      "usage.updatedNow": "just now",
      "usage.updatedMinutes": "{value} min ago",
      "usage.updating": "Updating…",
      "usage.stale": "data is stale",
      "usage.minutes": "{value} min",
      "usage.hours": "{value}h",
      "usage.hoursMinutes": "{hours}h {minutes}m",
      "usage.window5h": "5-hour window",
      "usage.windowWeek": "Weekly window",
      "usage.windowSpark5h": "Spark 5-hour window",
      "usage.windowSparkWeek": "Spark weekly window",
      "usage.windowPrimary": "Primary window",
      "usage.windowSecondary": "Secondary window",
      "usage.windowSparkPrimary": "Spark primary window",
      "usage.windowSparkSecondary": "Spark secondary window",
      "usage.windowDuration": "{value} window",
      "usage.windowSparkDuration": "Spark {value} window",
      "usage.durationWeeks": "{value}w",
      "usage.durationDays": "{value}d",
      "usage.durationHours": "{value}h",
      "usage.durationMinutes": "{value}m",
      "usage.durationSeconds": "{value}s",
      "usage.windowUnknown": "{label} window",
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
        position: absolute;
        right: 16px;
        bottom: 0;
        width: auto;
        max-width: min(360px, calc(100% - 32px));
        margin: 0;
        padding: 0;
        z-index: 2;
        text-align: right;
      }
      .dsh-codex-usage-summary {
        display: inline-flex;
        align-items: center;
        gap: 6px;
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
      .dsh-codex-usage-refresh:focus-visible,
      .dsh-codex-usage-close:focus-visible {
        outline: 2px solid var(--dsw-alias-border-l3);
        outline-offset: 1px;
      }
      .dsh-codex-usage-summary[data-error="true"] {
        color: var(--dsw-alias-state-error-primary);
      }
      .dsh-codex-usage-summary[data-stale="true"] {
        color: var(--dsw-alias-state-warning-primary, var(--dsw-alias-label-secondary));
      }
      .dsh-codex-usage-summary[data-updating="true"] {
        cursor: progress;
      }
      .dsh-codex-usage-panel {
        box-sizing: border-box;
        position: fixed;
        z-index: 1000;
        width: min(360px, calc(100vw - 32px));
        max-height: min(60vh, 420px);
        overflow: auto;
        padding: 12px;
        color: var(--dsw-alias-label-primary);
        text-align: left;
        background: var(--dsw-specific-menu);
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 12px;
        box-shadow: var(--dsw-shadow-lv2);
      }
      .dsh-codex-usage-panel[data-positioned="false"] {
        visibility: hidden;
      }
      .dsh-codex-usage-panel-header {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        margin-bottom: 8px;
      }
      .dsh-codex-usage-panel-heading {
        min-width: 0;
        color: var(--dsw-alias-label-primary);
        font-size: 13px;
        font-weight: 600;
        line-height: 20px;
      }
      .dsh-codex-usage-panel-status {
        min-width: 0;
        margin-left: auto;
        color: var(--dsw-alias-label-tertiary);
        font-size: 11px;
        line-height: 18px;
        text-align: right;
      }
      .dsh-codex-usage-close {
        flex: none;
        width: 24px;
        height: 24px;
        color: var(--dsw-alias-label-tertiary);
        cursor: pointer;
        background: transparent;
        border: 0;
        border-radius: 6px;
        font: inherit;
        font-size: 18px;
        line-height: 20px;
      }
      .dsh-codex-usage-close:hover {
        color: var(--dsw-alias-label-primary);
        background: var(--dsw-alias-interactive-bg-hover);
      }
      .dsh-codex-usage-list {
        margin: 0;
        padding: 0;
      }
      .dsh-codex-usage-row {
        padding: 8px 0;
        border-top: 1px solid var(--dsw-alias-border-l1);
      }
      .dsh-codex-usage-row-main {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
      }
      .dsh-codex-usage-row dt {
        min-width: 0;
        color: var(--dsw-alias-label-secondary);
        line-height: 20px;
      }
      .dsh-codex-usage-row dd {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 4px 8px;
        margin: 0;
        color: var(--dsw-alias-label-primary);
        font-variant-numeric: tabular-nums;
        line-height: 20px;
        text-align: right;
      }
      .dsh-codex-usage-row-meta {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 4px 8px;
        margin-top: 3px;
        color: var(--dsw-alias-label-tertiary);
        font-size: 11px;
        line-height: 18px;
        text-align: right;
      }
      .dsh-codex-usage-meter {
        height: 4px;
        margin-top: 6px;
        overflow: hidden;
        background: var(--dsw-alias-interactive-bg-hover);
        border-radius: 999px;
      }
      .dsh-codex-usage-meter > span {
        display: block;
        width: 0;
        height: 100%;
        background: var(--dsw-alias-label-secondary);
        border-radius: inherit;
      }
      .dsh-codex-usage-error,
      .dsh-codex-usage-hint {
        margin: 8px 0 0;
        line-height: 18px;
      }
      .dsh-codex-usage-error {
        color: var(--dsw-alias-state-error-primary);
      }
      .dsh-codex-usage-hint {
        color: var(--dsw-alias-label-tertiary);
      }
      .dsh-codex-usage-actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-top: 8px;
        color: var(--dsw-alias-label-tertiary);
        font-size: 11px;
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
      @media (max-width: 640px) {
        .dsh-codex-usage-dock[data-compact="true"] {
          position: relative;
          right: auto;
          bottom: auto;
          width: 100%;
          max-width: var(--dsh-chat-content-width, 748px);
          margin: 0 auto;
          padding: 0 16px 4px;
          text-align: center;
        }
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
            !Number.isFinite(window.nextResetAt) ||
            (window.windowSeconds !== undefined && (typeof window.windowSeconds !== "number" || !Number.isFinite(window.windowSeconds) || window.windowSeconds <= 0))
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
        this.state = Object.freeze({ status: "idle", snapshot: null, message: null, fetchedAt: 0, stale: false });
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
        this.setState({ status: "loading", message: null, stale: this.state.snapshot !== null });
        this.inflight = Promise.resolve()
          .then(() => this.remote.get())
          .then((result) => {
            if (!result?.ok) {
              this.setState({
                status: "unavailable",
                message: result?.error?.message ?? "remote request failed",
                fetchedAt: Date.now(),
                stale: this.state.snapshot !== null,
              });
              return;
            }
            const value = result.value;
            if (value.status === "ok") {
              this.setState({ status: "ok", snapshot: value, message: null, fetchedAt: value.fetchedAt ?? Date.now(), stale: false });
            } else {
              this.setState({ status: value.status, snapshot: null, message: value.message ?? null, fetchedAt: value.fetchedAt ?? Date.now(), stale: false });
            }
          })
          .catch((error) => {
            this.setState({
              status: "unavailable",
              message: error instanceof Error ? error.message : String(error),
              fetchedAt: Date.now(),
              stale: this.state.snapshot !== null,
            });
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
      if (minutes < 60) return t("usage.minutes", { value: minutes });
      const hours = Math.floor(minutes / 60);
      const rest = minutes % 60;
      return rest === 0 ? t("usage.hours", { value: hours }) : t("usage.hoursMinutes", { hours, minutes: rest });
    }

    function resetDateLabel(nextResetAt) {
      try {
        return new Intl.DateTimeFormat(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(nextResetAt));
      } catch {
        return "";
      }
    }

    function windowDurationLabel(seconds, t) {
      if (seconds % 604_800 === 0) return t("usage.durationWeeks", { value: seconds / 604_800 });
      if (seconds % 86_400 === 0) return t("usage.durationDays", { value: seconds / 86_400 });
      if (seconds % 3_600 === 0) return t("usage.durationHours", { value: seconds / 3_600 });
      if (seconds % 60 === 0) return t("usage.durationMinutes", { value: seconds / 60 });
      return t("usage.durationSeconds", { value: seconds });
    }

    function windowLabel(window, t) {
      const label = window.label;
      const spark = label.startsWith("spark ");
      const role = spark ? label.slice("spark ".length) : label;
      const seconds = Number(window.windowSeconds);
      if (Number.isFinite(seconds) && seconds > 0) {
        if (seconds === 18_000) return t(spark ? "usage.windowSpark5h" : "usage.window5h");
        if (seconds === 604_800) return t(spark ? "usage.windowSparkWeek" : "usage.windowWeek");
        const value = windowDurationLabel(seconds, t);
        return t(spark ? "usage.windowSparkDuration" : "usage.windowDuration", { value });
      }
      const keys = {
        primary: spark ? "usage.windowSparkPrimary" : "usage.windowPrimary",
        secondary: spark ? "usage.windowSparkSecondary" : "usage.windowSecondary",
      };
      return t(keys[role] ?? "usage.windowUnknown", { label });
    }

    function planLabel(plan, t) {
      const normalized = String(plan).toLowerCase();
      if (normalized === "plus") return t("usage.planPlus");
      if (normalized === "pro") return t("usage.planPro");
      return plan;
    }

    function updatedLabel(fetchedAt, now, t) {
      if (!fetchedAt) return "";
      const minutes = Math.floor(Math.max(0, now - fetchedAt) / 60000);
      return minutes <= 0 ? t("usage.updatedNow") : t("usage.updatedMinutes", { value: minutes });
    }

    function percentage(value) {
      return Math.min(100, Math.max(0, Math.round(value)));
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
      const [panelPosition, setPanelPosition] = React.useState(null);
      const summaryRef = React.useRef(null);
      const panelRef = React.useRef(null);
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

      React.useLayoutEffect(() => {
        if (!expanded) {
          setPanelPosition(null);
          return undefined;
        }
        const updatePosition = () => {
          const anchor = summaryRef.current;
          if (anchor === null) return;
          const rect = anchor.getBoundingClientRect();
          const openAbove = rect.top >= 220;
          const available = openAbove ? rect.top : window.innerHeight - rect.bottom;
          const position = {
            right: Math.max(16, window.innerWidth - rect.right),
            maxHeight: Math.max(140, Math.min(420, available - 24)),
          };
          if (openAbove) {
            position.bottom = Math.max(16, window.innerHeight - rect.top + 8);
          } else {
            position.top = Math.min(window.innerHeight - 160, rect.bottom + 8);
          }
          setPanelPosition(position);
        };
        const onPointerDown = (event) => {
          if (!summaryRef.current?.contains(event.target) && !panelRef.current?.contains(event.target)) setExpanded(false);
        };
        const onKeyDown = (event) => {
          if (event.key === "Escape") {
            setExpanded(false);
            summaryRef.current?.focus();
          }
        };
        updatePosition();
        window.addEventListener("resize", updatePosition);
        window.addEventListener("scroll", updatePosition, true);
        document.addEventListener("pointerdown", onPointerDown, true);
        document.addEventListener("keydown", onKeyDown);
        return () => {
          window.removeEventListener("resize", updatePosition);
          window.removeEventListener("scroll", updatePosition, true);
          document.removeEventListener("pointerdown", onPointerDown, true);
          document.removeEventListener("keydown", onKeyDown);
        };
      }, [expanded]);

      if (!isCodex) return null;

      const snapshot = usageState.snapshot;
      const windows = snapshot?.windows ?? [];
      const stale = usageState.stale === true;
      const updating = usageState.status === "loading" && snapshot !== null;
      const summary = windows
        .slice(0, 2)
        .map((window) => `${windowLabel(window, t)} · ${t("usage.used", { value: percentage(window.percentage) })}`)
        .join(" · ");
      const label =
        usageState.status === "loading" && snapshot === null
          ? t("usage.loading")
          : usageState.status === "not_logged_in"
            ? t("usage.notLoggedIn")
            : usageState.status === "unavailable" && snapshot === null
              ? t("usage.unavailable")
              : t(updating ? "usage.summaryUpdating" : stale ? "usage.summaryStale" : "usage.summary", { summary: summary || t("usage.noWindows") });
      const error = usageState.status === "unavailable" ? usageState.message : null;
      const panelId = `dsh-codex-usage-panel-${String(sessionId ?? "session").replace(/[^a-zA-Z0-9_-]/g, "-")}`;
      const panelTitleId = `${panelId}-title`;
      const updated = snapshot === null ? "" : updatedLabel(snapshot.fetchedAt ?? usageState.fetchedAt, now, t);
      const panelStatus = usageState.status === "loading" ? t("usage.updating") : stale ? t("usage.stale") : updated ? t("usage.updated", { value: updated }) : "";

      return React.createElement(
        "div",
        { className: "dsh-codex-usage-dock", "data-compact": compact ? "true" : undefined },
        React.createElement(
          "button",
          {
            ref: summaryRef,
            type: "button",
            className: "dsh-codex-usage-summary",
            "aria-label": label,
            "aria-expanded": expanded,
            "aria-controls": expanded ? panelId : undefined,
            "data-error": error !== null || undefined,
            "data-stale": stale || undefined,
            "data-updating": updating || undefined,
            title: t("usage.details"),
            onClick: () => setExpanded((value) => !value),
          },
          label,
        ),
        expanded &&
          React.createElement(
            "div",
            {
              ref: panelRef,
              id: panelId,
              className: "dsh-codex-usage-panel",
              role: "dialog",
              "aria-modal": "false",
              "aria-labelledby": panelTitleId,
              "data-positioned": panelPosition === null ? "false" : "true",
              style: panelPosition ?? undefined,
            },
            React.createElement(
              "div",
              { className: "dsh-codex-usage-panel-header" },
              React.createElement("strong", { id: panelTitleId, className: "dsh-codex-usage-panel-heading" }, t("usage.dialogTitle")),
              React.createElement("span", { className: "dsh-codex-usage-panel-status" }, panelStatus),
              React.createElement(
                "button",
                {
                  type: "button",
                  className: "dsh-codex-usage-close",
                  "aria-label": t("usage.close"),
                  onClick: () => {
                    setExpanded(false);
                    summaryRef.current?.focus();
                  },
                },
                "×",
              ),
            ),
            snapshot?.planLabel && React.createElement("p", { className: "dsh-codex-usage-hint" }, t("usage.plan", { plan: planLabel(snapshot.planLabel, t) })),
            windows.length > 0
              ? React.createElement(
                  "dl",
                  { className: "dsh-codex-usage-list" },
                  windows.map((window) => {
                    const used = percentage(window.percentage);
                    const remaining = 100 - used;
                    const reset = resetLabel(window.nextResetAt, now, t);
                    const resetAt = resetDateLabel(window.nextResetAt);
                    return React.createElement(
                      "div",
                      { className: "dsh-codex-usage-row", key: window.label },
                      React.createElement(
                        "div",
                        { className: "dsh-codex-usage-row-main" },
                        React.createElement("dt", null, windowLabel(window, t)),
                        React.createElement("dd", null, t("usage.used", { value: used })),
                      ),
                      React.createElement(
                        "div",
                        {
                          className: "dsh-codex-usage-meter",
                          role: "progressbar",
                          "aria-label": `${windowLabel(window, t)} ${t("usage.used", { value: used })}`,
                          "aria-valuemin": 0,
                          "aria-valuemax": 100,
                          "aria-valuenow": used,
                        },
                        React.createElement("span", { style: { width: `${used}%` } }),
                      ),
                      React.createElement(
                        "div",
                        { className: "dsh-codex-usage-row-meta" },
                        React.createElement("span", null, t("usage.remaining", { value: remaining })),
                        React.createElement("span", null, t("usage.reset", { value: reset })),
                        resetAt && React.createElement("span", null, t("usage.resetAt", { value: resetAt })),
                      ),
                    );
                  }),
                )
              : null,
            usageState.status === "not_logged_in" && React.createElement("p", { className: "dsh-codex-usage-hint" }, t("usage.loginHint")),
            usageState.status === "unavailable" && React.createElement("p", { className: "dsh-codex-usage-error", role: "status", "aria-live": "polite" }, t("usage.error", { message: error ?? "unknown error" })),
            React.createElement(
              "div",
              { className: "dsh-codex-usage-actions" },
              React.createElement("span", null, snapshot && updated ? t("usage.updated", { value: updated }) : ""),
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

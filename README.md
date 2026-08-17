# dsh-codex

> 给 DeepSeek Harness（DSH）接入 OpenAI Codex（ChatGPT Plus/Pro OAuth）账号。安装后模型选择器中会出现 OpenAI Codex Provider，可直接使用 Codex 模型。

- Provider 路由：`openai-codex`
- API 类型：`openai-codex-responses`（Codex Responses API，不是 `/v1/chat/completions`）
- 兼容版本：DSH `>= 0.1.0-rc.6`
- License：MIT

## 功能特性

- 通过 ChatGPT Plus/Pro OAuth 接入 Codex 模型，不依赖 DeepSeek API Key。
- 支持浏览器 OAuth 登录和 Device Code 无浏览器登录。
- 模型选择器自动发现 Codex 模型，支持文本流、工具调用和图片输入（仅限模型目录声明支持 image 的模型）。
- 支持 Codex Native Web Search：`openai-codex` 当前 turn 暴露 `web_search` 时，自动转换为 Codex Responses hosted `web_search`。
- 凭证使用 DSH 自身凭证服务保存，自动刷新、不写入日志。
- **用量显示**：`/codex status` 与 `/codex usage` 展示当前账号配额（5 小时窗口、每周窗口、Spark 子额度），来自 ChatGPT 的 `wham/usage` 只读端点，无需额外凭证。
- **Codex 原生网络搜索**：默认启用，直接在请求中注入 Responses API 的 `web_search` 内置工具（与官方 Codex CLI 同机制），模型在回复流内完成联网搜索，不再依赖 DeepSeek 搜索后端。

## 安装与启用

### 方式 A（推荐）：`dsh plugin`

```bash
# 直接从 GitHub 安装（推荐）
dsh plugin --profile web add github:ddll8023/dsh-codex

# 或先 clone 到本地，再安装本地路径
git clone https://github.com/ddll8023/dsh-codex.git
dsh plugin --profile web add /绝对路径/dsh-codex

# 已发布到 npm registry 后也可使用包名：
dsh plugin --profile web add dsh-codex
```

`dsh plugin` 需要 `pnpm`（可通过 `corepack enable pnpm` 启用）。安装后重启 `dsh web`，插件随 profile 启动。

### 方式 B：手动

1. 将插件包放入 `$DSH_HOME/profiles/web/node_modules/dsh-codex`（或执行 `npm install <路径>`）。
2. 在 `$DSH_HOME/profiles/web/package.json` 的 `dsh.profile.bundles` 追加 `"dsh-codex"`。
3. 重启 `dsh web`。

### 验证是否启用

```bash
dsh --profile web --dump-config | grep -A2 llm-codex
# - id: llm-codex
#   name: dsh-codex
```

启用后模型选择器中会出现 **OpenAI Codex** Provider 及其模型（gpt-5.3-codex-spark、gpt-5.4、gpt-5.4-mini、gpt-5.5、gpt-5.6-luna 等，来自 pi-ai 的 Codex 目录）。

## 登录与使用

| 命令 | 说明 |
| --- | --- |
| `/codex login` | 浏览器 OAuth 登录（Authorization Code + PKCE，回调 `http://localhost:1455/auth/callback`）。命令返回授权 URL，在浏览器完成登录即可，流程在后台继续。 |
| `/codex login --device` | 无浏览器环境的 Device Code 流程（显示设备码与验证 URL）。 |
| `/codex logout` | 删除本地 OAuth 凭证。 |
| `/codex status` | 登录状态、账号（accountId）、token 有效期（不显示任何 token），以及当前配额用量。 |
| `/codex usage` | 只查询并显示当前账号配额用量（5h / 每周 / Spark 子额度，含重置倒计时）。 |

登录后在模型选择器中选择 `openai-codex` 下的任意 Codex 模型即可对话；支持文本流、工具调用和图片输入，事件格式与现有 Provider 一致。

### 用量显示

`/codex status` 与 `/codex usage` 调用 ChatGPT 的只读配额端点（`GET {baseURL}/wham/usage`，请求头 `referer: https://chatgpt.com/codex/settings/usage` 与 `x-openai-target-path`），使用插件已存储的 OAuth token 认证，不引入新凭证。输出形如：

```
Usage: [plus] 5h 43% (reset 2h 5m) · week 12% (reset 4d 1h)
```

端点不可达、返回非 2xx 或响应形状变化时，用量行降级为 `Usage: unavailable (原因)`，不影响登录状态本身；token 永不出现在输出中。

### Web UI 用量显示

选择 `openai-codex` 模型后，聊天输入框下方会显示 Codex 用量摘要；点击摘要可展开 5h、每周和 Spark 子额度的重置时间，并可手动刷新。未选择 Codex 时该行不显示。浏览器只通过 Host Remote 获取脱敏后的配额窗口，OAuth token 不离开服务端凭证层。

## Codex 原生网络搜索

Codex 会话默认启用网络搜索：与 DeepSeek 的搜索后端无关，也不额外消耗一次请求——搜索由 Codex 后端在**同一个响应流内**完成（`web_search_call` 事件，最终答案文本正常流出），与官方 Codex CLI 启用 web search 的机制一致。

- 搜索仍遵循 Harness 原有的 `web_search` 工具语义：使用 `openai-codex` 时，插件在发送 Codex Responses 请求前通过 pi-ai 的 `onPayload` 做 request-local 转换——删除普通 function `web_search`，保留其他工具，并追加 Codex hosted `{ type: "web_search", ... }`。
- **只有当前 turn 的 `options.tools` 确实包含 `web_search` 时才转换**（权限门控）；没有该工具时不会额外授予联网能力，配置本身无法给一个 turn 开通网络访问。
- 使用 DeepSeek、Claude、Gemini 等其它 Provider 时，仍是 `dsh-tool-web → ctx.web → Harness 配置的搜索后端`；插件不修改 `ctx.web.searchProvider`、`DSH_WEB_SEARCH_PROVIDER`、Exa、Perplexity 或 DeepSeek Search，无需为 Codex 配置 Harness Search Provider。
- 模型自主判断何时搜索（时间敏感/事实性问题会触发），无需手动切换；内置搜索事件在 pi-ai 中被安全忽略，harness 侧表现为普通文本回复。

默认配置 `nativeWebSearch: true`、`webSearchMode: live`。Codex 公开 Responses 请求格式支持以下模式：

- `live`：`{ type: "web_search", external_web_access: true }`
- `cached`：`{ type: "web_search", external_web_access: false }`
- `indexed`：`{ type: "web_search", external_web_access: true, indexed_web_access: true }`
- `disabled`：不注入 hosted search，等同于关闭本 turn 的原生搜索（退回函数工具路径）

是否可用仍取决于实际 Codex 后端、模型与 ChatGPT 账号能力；不支持时不会静默切换到第三方 Search Provider。

### 配置（可选，非密钥）

```yaml
# $DSH_HOME/settings.yaml 的 llm-codex 段，或 cordis.patch.yml 中该行的 config
llm-codex:
  baseURL: https://chatgpt.com/backend-api   # 端点（默认）
  transport: sse                             # sse | websocket | websocket-cached | auto
  cacheRetention: short                      # none | short | long
  nativeWebSearch: true                       # true=启用 Codex 原生网络搜索（默认）；false=退回 harness web_search 函数工具
  webSearchMode: live                         # live | cached | indexed | disabled
  refreshLeadTimeMs: 300000                  # 提前刷新阈值
  streamIdleTimeoutMs: 300000
  retryPolicy:
    mode: normal
    maxRetries: 2
```

## 安全与凭证

- 凭证保存在 DSH 自身凭证服务（`ctx.credentials`，即 `$DSH_HOME/.credentials.yaml`，文件权限 0600，热加载、串行写入）的插件命名空间 `OPENAI_CODEX_OAUTH` 下，一条 JSON 记录：`{type, access, refresh, expires, accountId}`。
- `accountId` 从 access token JWT 的 `https://api.openai.com/auth.chatgpt_account_id` 声明解析，仅用于请求头 `chatgpt-account-id` 与 `/codex status` 展示。
- 刷新策略：剩余约 5 分钟（`refreshLeadTimeMs`，默认 300000ms）时提前刷新；后台每 5 分钟检查一次 + 每次请求前检查；并发刷新由凭证存储的按 provider 串行队列 + 双检锁保证只刷新一次；刷新失败保留旧凭证并返回明确错误（`AUTH`）。
- token 永不进入日志、session 事件、telemetry 或错误信息；`/codex` 命令设置 `recordInput: false`，防止粘贴的授权码落入会话日志。
- DeepSeek 的 API key 在 `DEEPSEEK_API_KEY` 等自有 ref 下，二者互不干扰；Codex token 永远不会被 DeepSeek 请求使用。

## 兼容性与风险

- **`originator` 固定为 `"pi"`**：请求头与 OAuth authorize URL 的 `originator` 由 pi-ai 的 codex 实现硬编码（`originator: "pi"`，即 pi-ai 自身的标识）。插件复用该实现，因此无法在不复制协议的情况下改写为其它值；ChatGPT 后端可能按 originator 做白名单/风控，改动有风险，故保持 pi-ai 官方值。
- **User-Agent** 由 pi-ai codex 传输层设置（`pi (platform; arch)`），会覆盖 harness 默认 attribution 的 UA；attribution 头仍按契约传入（与 dsh-llm-pi-ai 行为一致）。
- Codex 后端协议为社区逆向/维护（pi-ai 维护），`chatgpt.com/backend-api` 的字段、限流、风控可能随 ChatGPT 前端变化；若后端收紧，需要 pi-ai 升级适配。
- 当前 `@earendil-works/pi-ai@0.82.1` 的 `openai-codex-responses` 已能透传 hosted search 请求，但 `openai-responses-shared` 会忽略 `web_search_call` 事件，并丢弃 `output_text.annotations`；由于 pi-ai 与 Harness `StreamChunk` 当前没有结构化 citation 字段，source metadata 不能在插件层完整恢复。普通文本流和未知搜索事件仍会继续到终态。
- 浏览器流程依赖本地 `127.0.0.1:1455` 端口可用；端口被占用时 pi-ai 会走手工粘贴授权码的降级路径，本插件在 Web GUI 下以错误信息提示。
- 用量上限（quota）等错误映射基于消息文本分类，OpenAI 侧文案变化可能影响分类（回退为 `PI_AI_ERROR`，不影响请求本身）。
- 用量查询依赖未公开的 `wham/usage` 端点：只读、不需要额外权限，但字段/限流可能随 ChatGPT 前端变化；失败时降级为「用量不可用」，不影响对话。
- 原生网络搜索依赖 pi-ai 的 `onPayload` 请求钩子与 Codex 后端对内置 `web_search` 工具的支持（官方 Codex CLI 同机制）；后端收紧时搜索可能静默失效（模型只输出其已有知识），不会报错。

## 开发与测试

### 插件文件

```
dsh-codex/
├── package.json          # 插件清单：dsh.bundle/dsh.client 声明、依赖、测试脚本
├── cordis.patch.yml      # 插件清单：bundle patch（注册 llm-codex 一行）
├── lib/
│   ├── index.js          # 插件入口：注册 Provider/命令/设置/timer
│   ├── constants.js      # 常量：Provider id、默认地址、凭证命名空间
│   ├── config.js         # 配置 schema（baseURL/transport/nativeWebSearch/webSearchMode/refreshLeadTime/retryPolicy…）
│   ├── models.js         # pi-ai Models 集合构建（含 baseURL 重定向）
│   ├── credentials.js    # 凭证存储：credentials seam 适配 + 提前刷新（双检锁）
│   ├── oauth.js          # /codex 命令的登录/登出/状态/用量编排与交互适配
│   ├── usage.js          # wham/usage 配额端点拉取、解析与格式化（5h/周/Spark）
│   ├── usage-remote.js   # Host Remote：向 Web UI 提供脱敏用量快照
│   ├── client.js         # Web UI：conversation.composer.dock 用量摘要与详情
│   ├── adapter.js        # CodexAdapter（dsh LlmAdapter 实现，onPayload 挂载原生 web_search 转换）
│   ├── context.js        # harness 消息 → pi-ai Context
│   ├── web-search.js     # request-local Hosted Web Search payload 转换（权限门控 + 模式）
│   ├── replay.js         # pi-ai 回放状态（多轮签名透传）
│   └── stream.js         # pi-ai 事件 → harness StreamChunk
└── test/                 # 插件自身测试（mock HTTP，不执行真实登录）
    ├── helpers.js
    ├── credentials.test.js
    ├── refresh.test.js
    ├── oauth.test.js
    ├── adapter.test.js
    ├── web-search.test.js
    ├── usage.test.js
    ├── usage-remote.test.js
    ├── client.test.js
    ├── package.test.js
    └── plugin.test.js
```

### 运行测试

```bash
cd dsh-codex
npm test
```

测试覆盖（53 项，全绿）：

- Codex Native Web Search：权限存在时 function → hosted 转换、其他工具保留、无权限不注入、配置关闭、live/cached/indexed/disabled 模式
- `web_search_call`/未知搜索事件与带 annotation 的文本流不崩溃；不支持搜索错误映射为 `CODEX_WEB_SEARCH_UNSUPPORTED`
- JWT accountId 解析（含缺失/畸形 token）
- 凭证记录的校验与存取（credentials seam 往返、损坏记录、并发 modify 串行化）
- 提前刷新：阈值判断、旋转持久化、并发只刷新一次、失败保留旧凭证并报 `AUTH`
- OAuth：Device Code 全流程（mock auth.openai.com）、token 响应字段校验、浏览器流程（PKCE `code_challenge` 校验、错误 state 被回调服务器拒绝、正确 state 完成登录）
- Codex 请求头与请求体：`Authorization: Bearer`、`chatgpt-account-id`、`originator`、`openai-beta: responses=experimental`、`instructions/input/tools/stream`
- SSE 文本流与 tool call 流到 harness StreamChunk 的翻译（含 usage、finish）
- 图片附件读取与 Responses `input_image` 请求体转换；不支持图片的文本模型仍返回 `UNSUPPORTED_CONTENT`
- 无凭证 → `MISSING_CREDENTIAL`；未知模型 → `UNKNOWN_MODEL`；用量上限 → `QUOTA`
- 原生网络搜索：权限存在时 function → hosted 转换、其他工具保留、无权限不注入、`nativeWebSearch:false` 保留函数工具、live/cached/indexed/disabled 模式、无效模式配置被拒绝
- 用量：`wham/usage` 请求头/URL、5h/周/Spark 窗口解析、缺失窗口报错、失败降级「不可用」、输出不含 token、`/codex usage` 子命令与登录后 `status` 的用量行
- 插件加载/卸载：Provider 路由、可配置 Provider 目录、命令注册与卸载清理
- 真实 harness boot 验证（dsh-app-boot + loader + 真实服务）

### 尚未验证的部分

- 真实 ChatGPT 账号登录（按约束未执行；OAuth 各环节在 mock HTTP 下验证）。
- `wham/usage` 端点与原生 web_search 行为需真实账号验证（协议形状来自社区逆向与官方 Codex CLI 同机制，mock 覆盖了请求/解析/降级路径）。
- `transport: websocket*`：默认走 SSE；websocket 路径未在 mock 中覆盖。
- 与最新 pi-ai 目录的模型清单同步（模型来自 pi-ai 目录，非本插件固化）。

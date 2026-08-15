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
- 凭证使用 DSH 自身凭证服务保存，自动刷新、不写入日志。

## 安装与启用

### 方式 A（推荐）：`dsh plugin`

```bash
# 在插件目录外执行；dsh 会 forward 给 pnpm 并自动把声明了 dsh.bundle 的包加入
# 该 profile 的 bundle 层
dsh plugin --profile web add /绝对路径/dsh-codex
# 或已发布到 registry 后：
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
| `/codex status` | 登录状态、账号（accountId）、token 有效期（不显示任何 token）。 |

登录后在模型选择器中选择 `openai-codex` 下的任意 Codex 模型即可对话；支持文本流、工具调用和图片输入，事件格式与现有 Provider 一致。

### 配置（可选，非密钥）

```yaml
# $DSH_HOME/settings.yaml 的 llm-codex 段，或 cordis.patch.yml 中该行的 config
llm-codex:
  baseURL: https://chatgpt.com/backend-api   # 端点（默认）
  transport: sse                             # sse | websocket | websocket-cached | auto
  cacheRetention: short                      # none | short | long
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
- 浏览器流程依赖本地 `127.0.0.1:1455` 端口可用；端口被占用时 pi-ai 会走手工粘贴授权码的降级路径，本插件在 Web GUI 下以错误信息提示。
- 用量上限（quota）等错误映射基于消息文本分类，OpenAI 侧文案变化可能影响分类（回退为 `PI_AI_ERROR`，不影响请求本身）。

## 开发与测试

### 插件文件

```
dsh-codex/
├── package.json          # 插件清单：dsh.bundle 声明、依赖、测试脚本
├── cordis.patch.yml      # 插件清单：bundle patch（注册 llm-codex 一行）
├── lib/
│   ├── index.js          # 插件入口：注册 Provider/命令/设置/timer
│   ├── constants.js      # 常量：Provider id、默认地址、凭证命名空间
│   ├── config.js         # 配置 schema（baseURL/transport/refreshLeadTime/retryPolicy…）
│   ├── models.js         # pi-ai Models 集合构建（含 baseURL 重定向）
│   ├── credentials.js    # 凭证存储：credentials seam 适配 + 提前刷新（双检锁）
│   ├── oauth.js          # /codex 命令的登录/登出/状态编排与交互适配
│   ├── adapter.js        # CodexAdapter（dsh LlmAdapter 实现）
│   ├── context.js        # harness 消息 → pi-ai Context
│   ├── replay.js         # pi-ai 回放状态（多轮签名透传）
│   └── stream.js         # pi-ai 事件 → harness StreamChunk
└── test/                 # 插件自身测试（mock HTTP，不执行真实登录）
    ├── helpers.js
    ├── credentials.test.js
    ├── refresh.test.js
    ├── oauth.test.js
    ├── adapter.test.js
    └── plugin.test.js
```

### 运行测试

```bash
cd dsh-codex
npm test
```

测试覆盖（29 项，全绿）：

- JWT accountId 解析（含缺失/畸形 token）
- 凭证记录的校验与存取（credentials seam 往返、损坏记录、并发 modify 串行化）
- 提前刷新：阈值判断、旋转持久化、并发只刷新一次、失败保留旧凭证并报 `AUTH`
- OAuth：Device Code 全流程（mock auth.openai.com）、token 响应字段校验、浏览器流程（PKCE `code_challenge` 校验、错误 state 被回调服务器拒绝、正确 state 完成登录）
- Codex 请求头与请求体：`Authorization: Bearer`、`chatgpt-account-id`、`originator`、`openai-beta: responses=experimental`、`instructions/input/tools/stream`
- SSE 文本流与 tool call 流到 harness StreamChunk 的翻译（含 usage、finish）
- 图片附件读取与 Responses `input_image` 请求体转换；不支持图片的文本模型仍返回 `UNSUPPORTED_CONTENT`
- 无凭证 → `MISSING_CREDENTIAL`；未知模型 → `UNKNOWN_MODEL`；用量上限 → `QUOTA`
- 插件加载/卸载：Provider 路由、可配置 Provider 目录、命令注册与卸载清理
- 真实 harness boot 验证（dsh-app-boot + loader + 真实服务）

### 尚未验证的部分

- 真实 ChatGPT 账号登录（按约束未执行；OAuth 各环节在 mock HTTP 下验证）。
- `transport: websocket*`：默认走 SSE；websocket 路径未在 mock 中覆盖。
- 与最新 pi-ai 目录的模型清单同步（模型来自 pi-ai 目录，非本插件固化）。

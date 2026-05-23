| 变量 | 目的 |
| --- | --- |
| `ANTHROPIC_API_KEY` | 作为 `X-Api-Key` 标头发送的 API 密钥。设置后，即使您已登录，此密钥也会用于替代您的 Claude Pro、Max、Team 或 Enterprise 订阅。在非交互模式（`-p`）中，存在时始终使用该密钥。在交互模式中，系统会提示您在密钥覆盖订阅之前批准一次。要改用您的订阅，请运行 `unset ANTHROPIC_API_KEY` |
| `ANTHROPIC_AUTH_TOKEN` | `Authorization` 标头的自定义值（您在此处设置的值将以 `Bearer ` 为前缀） |
| `ANTHROPIC_AWS_API_KEY` | [Claude Platform on AWS](https://code.claude.com/zh-CN/claude-platform-on-aws) 的工作区 API 密钥，在 AWS 控制台中生成。作为 `x-api-key` 发送，优先于 AWS SigV4 |
| `ANTHROPIC_AWS_BASE_URL` | 覆盖 [Claude Platform on AWS](https://code.claude.com/zh-CN/claude-platform-on-aws) 端点 URL。用于自定义区域或通过 [LLM 网关](https://code.claude.com/zh-CN/llm-gateway)路由时。默认为 `https://aws-external-anthropic.{AWS_REGION}.api.aws` |
| `ANTHROPIC_AWS_WORKSPACE_ID` | [Claude Platform on AWS](https://code.claude.com/zh-CN/claude-platform-on-aws) 所需。在每个请求中作为 `anthropic-workspace-id` 标头发送 |
| `ANTHROPIC_BASE_URL` | 覆盖 API 端点以通过代理或网关路由请求。设置为非第一方主机时， [MCP 工具搜索](https://code.claude.com/zh-CN/mcp#scale-with-mcp-tool-search)默认禁用。如果您的代理转发 `tool_reference` 块，请设置 `ENABLE_TOOL_SEARCH=true` |
| `ANTHROPIC_BEDROCK_BASE_URL` | 覆盖 Bedrock 端点 URL。用于自定义 Bedrock 端点或通过 [LLM 网关](https://code.claude.com/zh-CN/llm-gateway)路由时。请参阅 [Amazon Bedrock](https://code.claude.com/zh-CN/amazon-bedrock) |
| `ANTHROPIC_BEDROCK_MANTLE_BASE_URL` | 覆盖 Bedrock Mantle 端点 URL。请参阅 [Mantle 端点](https://code.claude.com/zh-CN/amazon-bedrock#use-the-mantle-endpoint) |
| `ANTHROPIC_BEDROCK_SERVICE_TIER` | Bedrock [服务层](https://docs.aws.amazon.com/bedrock/latest/userguide/service-tiers-inference.html)（`default`、`flex` 或 `priority`）。作为 `X-Amzn-Bedrock-Service-Tier` 标头发送。请参阅 [Amazon Bedrock](https://code.claude.com/zh-CN/amazon-bedrock#service-tiers) |
| `ANTHROPIC_BETAS` | 逗号分隔的其他 `anthropic-beta` 标头值列表，以包含在 API 请求中。Claude Code 已发送其需要的 beta 标头；使用此选项可在 Claude Code 添加原生支持之前选择加入 [Anthropic API beta](https://platform.claude.com/docs/en/api/beta-headers)。与需要 API 密钥身份验证的 [`--betas` 标志](https://code.claude.com/zh-CN/cli-reference#cli-flags)不同，此变量适用于所有身份验证方法，包括 Claude.ai 订阅 |
| `ANTHROPIC_CUSTOM_HEADERS` | 要添加到请求的自定义标头（`Name: Value` 格式，多个标头用换行符分隔） |
| `ANTHROPIC_CUSTOM_MODEL_OPTION` | 要在 `/model` 选择器中添加为自定义条目的模型 ID。使用此选项可以使非标准或网关特定的模型可选择，而无需替换内置别名。请参阅 [模型配置](https://code.claude.com/zh-CN/model-config#add-a-custom-model-option) |
| `ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION` | `/model` 选择器中自定义模型条目的显示描述。未设置时默认为 `Custom model ()` |
| `ANTHROPIC_CUSTOM_MODEL_OPTION_NAME` | `/model` 选择器中自定义模型条目的显示名称。未设置时默认为模型 ID |
| `ANTHROPIC_CUSTOM_MODEL_OPTION_SUPPORTED_CAPABILITIES` | 请参阅 [模型配置](https://code.claude.com/zh-CN/model-config#customize-pinned-model-display-and-capabilities) |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | 请参阅 [模型配置](https://code.claude.com/zh-CN/model-config#environment-variables) |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION` | 请参阅 [模型配置](https://code.claude.com/zh-CN/model-config#customize-pinned-model-display-and-capabilities) |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME` | 请参阅 [模型配置](https://code.claude.com/zh-CN/model-config#customize-pinned-model-display-and-capabilities) |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES` | 请参阅 [模型配置](https://code.claude.com/zh-CN/model-config#customize-pinned-model-display-and-capabilities) |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | 请参阅 [模型配置](https://code.claude.com/zh-CN/model-config#environment-variables) |
| `ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION` | 请参阅 [模型配置](https://code.claude.com/zh-CN/model-config#customize-pinned-model-display-and-capabilities) |
| `ANTHROPIC_DEFAULT_OPUS_MODEL_NAME` | 请参阅 [模型配置](https://code.claude.com/zh-CN/model-config#customize-pinned-model-display-and-capabilities) |
| `ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES` | 请参阅 [模型配置](https://code.claude.com/zh-CN/model-config#customize-pinned-model-display-and-capabilities) |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | 请参阅 [模型配置](https://code.claude.com/zh-CN/model-config#environment-variables) |
| `ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION` | 请参阅 [模型配置](https://code.claude.com/zh-CN/model-config#customize-pinned-model-display-and-capabilities) |
| `ANTHROPIC_DEFAULT_SONNET_MODEL_NAME` | 请参阅 [模型配置](https://code.claude.com/zh-CN/model-config#customize-pinned-model-display-and-capabilities) |
| `ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES` | 请参阅 [模型配置](https://code.claude.com/zh-CN/model-config#customize-pinned-model-display-and-capabilities) |
| `ANTHROPIC_FOUNDRY_API_KEY` | Microsoft Foundry 身份验证的 API 密钥（请参阅 [Microsoft Foundry](https://code.claude.com/zh-CN/microsoft-foundry)） |
| `ANTHROPIC_FOUNDRY_BASE_URL` | Foundry 资源的完整基础 URL（例如，`https://my-resource.services.ai.azure.com/anthropic`）。`ANTHROPIC_FOUNDRY_RESOURCE` 的替代方案（请参阅 [Microsoft Foundry](https://code.claude.com/zh-CN/microsoft-foundry)） |
| `ANTHROPIC_FOUNDRY_RESOURCE` | Foundry 资源名称（例如，`my-resource`）。如果未设置 `ANTHROPIC_FOUNDRY_BASE_URL`，则为必需（请参阅 [Microsoft Foundry](https://code.claude.com/zh-CN/microsoft-foundry)） |
| `ANTHROPIC_MODEL` | 要使用的模型设置的名称（请参阅 [模型配置](https://code.claude.com/zh-CN/model-config#environment-variables)） |
| `ANTHROPIC_SMALL_FAST_MODEL` | [已弃用] [用于后台任务的 Haiku 级模型](https://code.claude.com/zh-CN/costs)的名称 |
| `ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION` | 使用 Bedrock 或 Bedrock Mantle 时覆盖 Haiku 级模型的 AWS 区域。在 Bedrock 上，仅当同时设置 `ANTHROPIC_DEFAULT_HAIKU_MODEL` 或已弃用的 `ANTHROPIC_SMALL_FAST_MODEL` 时才生效，因为 Bedrock 否则会为后台任务使用主模型 |
| `ANTHROPIC_VERTEX_BASE_URL` | 覆盖 Vertex AI 端点 URL。用于自定义 Vertex 端点或通过 [LLM 网关](https://code.claude.com/zh-CN/llm-gateway)路由时。请参阅 [Google Vertex AI](https://code.claude.com/zh-CN/google-vertex-ai) |
| `ANTHROPIC_VERTEX_PROJECT_ID` | Vertex AI 请求的 GCP 项目 ID。被 `GCLOUD_PROJECT`、`GOOGLE_CLOUD_PROJECT` 或您的 `GOOGLE_APPLICATION_CREDENTIALS` 凭证文件中的项目覆盖。请参阅 [Google Vertex AI](https://code.claude.com/zh-CN/google-vertex-ai) |
| `ANTHROPIC_WORKSPACE_ID` | [工作负载身份联合](https://platform.claude.com/docs/en/manage-claude/workload-identity-federation)的工作区 ID。当您的联合规则的范围超过一个工作区时设置此选项，以便令牌交换知道要针对哪个工作区 |
| `API_TIMEOUT_MS` | API 请求的超时时间（以毫秒为单位）（默认值：600000，或 10 分钟；最大值：2147483647）。在缓慢网络上请求超时或通过代理路由时增加此值。超过最大值的值会导致底层计时器溢出，导致请求立即失败 |
| `AWS_BEARER_TOKEN_BEDROCK` | 用于身份验证的 Bedrock API 密钥（请参阅 [Bedrock API 密钥](https://aws.amazon.com/blogs/machine-learning/accelerate-ai-development-with-amazon-bedrock-api-keys/)） |
| `BASH_DEFAULT_TIMEOUT_MS` | 长时间运行的 bash 命令的默认超时（默认值：120000，或 2 分钟） |
| `BASH_MAX_OUTPUT_LENGTH` | bash 输出中的最大字符数，超过此数字后将完整输出保存到文件，Claude 接收路径加上简短预览。请参阅 [Bash 工具行为](https://code.claude.com/zh-CN/tools-reference#bash-tool-behavior) |
| `BASH_MAX_TIMEOUT_MS` | 模型可以为长时间运行的 bash 命令设置的最大超时（默认值：600000，或 10 分钟） |
| `CCR_FORCE_BUNDLE` | 设置为 `1` 以强制 [`claude --remote`](https://code.claude.com/zh-CN/claude-code-on-the-web#send-local-repositories-without-github) 捆绑并上传您的本地存储库，即使 GitHub 访问可用 |
| `CLAUDECODE` | 在 Claude Code 生成的子进程中设置为 `1`（Bash 和 PowerShell 工具、tmux 会话、 [hook](https://code.claude.com/zh-CN/hooks) 命令、 [状态行](https://code.claude.com/zh-CN/statusline)命令）。用于检测脚本何时在 Claude Code 生成的子进程内运行 |
| `CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS` | 设置为 `1` 以禁用所有内置 [subagent](https://code.claude.com/zh-CN/sub-agents) 类型，如 Explore 和 Plan。仅适用于非交互模式（`-p` 标志）。对于想要空白状态的 SDK 用户很有用 |
| `CLAUDE_AGENT_SDK_MCP_NO_PREFIX` | 设置为 `1` 以跳过 SDK 创建的 MCP 服务器中工具名称上的 `mcp____` 前缀。工具使用其原始名称。仅限 SDK 使用 |
| `CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS` | 后台 subagents 的停滞超时（以毫秒为单位）。默认 `600000`（10 分钟）。计时器在每个流式进度事件时重置；如果在窗口内没有进度到达，subagent 会被中止，任务被标记为失败，将任何部分结果呈现给父级 |
| `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` | 设置触发自动压缩的上下文容量百分比（1-100）。默认情况下，自动压缩在大约 95% 容量时触发。使用较低的值（如 `50`）可更早进行压缩。高于默认阈值的值无效。适用于主对话和 subagents。此百分比与 [状态行](https://code.claude.com/zh-CN/statusline)中可用的 `context_window.used_percentage` 字段一致 |
| `CLAUDE_AUTO_BACKGROUND_TASKS` | 设置为 `1` 以强制启用长时间运行的代理任务的自动后台处理。启用后，subagents 在运行约两分钟后会移到后台 |
| `CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR` | 在主会话中每个 Bash 或 PowerShell 命令后返回到原始工作目录 |
| `CLAUDE_CODE_ACCESSIBILITY` | 设置为 `1` 以保持原生终端光标可见并禁用反向文本光标指示器。允许 macOS Zoom 等屏幕放大镜跟踪光标位置 |
| `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD` | 设置为 `1` 以从使用 `--add-dir` 指定的目录加载内存文件。加载 `CLAUDE.md`、`.claude/CLAUDE.md`、`.claude/rules/*.md` 和 `CLAUDE.local.md`。默认情况下，其他目录不加载内存文件 |
| `CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT` | 设置为 `1` 以在 [全屏渲染](https://code.claude.com/zh-CN/fullscreen)中的每一帧上重新绘制整个屏幕，而不是发送增量更新。如果全屏模式显示陈旧或错位的文本片段，请使用此选项。Claude Code 在 Windows 上的后台会话中自动启用此选项 |
| `CLAUDE_CODE_API_KEY_HELPER_TTL_MS` | 应刷新凭证的间隔（以毫秒为单位）（使用 [`apiKeyHelper`](https://code.claude.com/zh-CN/settings#available-settings) 时） |
| `CLAUDE_CODE_ATTRIBUTION_HEADER` | 设置为 `0` 以从系统提示的开头省略归属块（客户端版本和提示指纹）。禁用它会改善通过 [LLM 网关](https://code.claude.com/zh-CN/llm-gateway)路由时的 prompt caching 命中率。Anthropic API 缓存不受影响 |
| `CLAUDE_CODE_AUTO_COMPACT_WINDOW` | 设置用于自动压缩计算的上下文容量（以令牌为单位）。默认为模型的上下文窗口：标准模型为 200K，或 [扩展上下文](https://code.claude.com/zh-CN/model-config#extended-context)模型为 1M。在 1M 模型上使用较低的值（如 `500000`）可将窗口视为 500K 用于压缩目的。该值上限为模型的实际上下文窗口。`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` 作为此值的百分比应用。设置此变量会将压缩阈值与状态行的 `used_percentage` 解耦，后者始终使用模型的完整上下文窗口 |
| `CLAUDE_CODE_AUTO_CONNECT_IDE` | 覆盖自动 [IDE 连接](https://code.claude.com/zh-CN/vs-code)。默认情况下，在支持的 IDE 的集成终端内启动时，Claude Code 会自动连接。设置为 `false` 以防止这种情况。设置为 `true` 以在自动检测失败时强制连接尝试，例如当 tmux 遮挡父终端时。优先于 [`autoConnectIde`](https://code.claude.com/zh-CN/settings#global-config-settings) 全局配置设置 |
| `CLAUDE_CODE_CERT_STORE` | TLS 连接的 CA 证书源的逗号分隔列表。`bundled` 是 Claude Code 附带的 Mozilla CA 集。`system` 是操作系统信任存储。默认为 `bundled,system` |
| `CLAUDE_CODE_CLIENT_CERT` | 用于 mTLS 身份验证的客户端证书文件的路径 |
| `CLAUDE_CODE_CLIENT_KEY` | 用于 mTLS 身份验证的客户端私钥文件的路径 |
| `CLAUDE_CODE_CLIENT_KEY_PASSPHRASE` | 加密 CLAUDE_CODE_CLIENT_KEY 的密码短语（可选） |
| `CLAUDE_CODE_DEBUG_LOGS_DIR` | 覆盖调试日志文件路径。尽管名称如此，这是文件路径，而不是目录。需要通过 `--debug`、`/debug` 或 `DEBUG` 环境变量单独启用调试模式：仅设置此变量不会启用日志记录。 [`--debug-file`](https://code.claude.com/zh-CN/cli-reference#cli-flags) 标志同时执行两者。默认为 `~/.claude/debug/.txt` |
| `CLAUDE_CODE_DEBUG_LOG_LEVEL` | 写入调试日志文件的最小日志级别。值：`verbose`、`debug`（默认）、`info`、`warn`、`error`。设置为 `verbose` 以包含高容量诊断（如完整状态行命令输出），或提高到 `error` 以减少噪音 |
| `CLAUDE_CODE_DISABLE_1M_CONTEXT` | 设置为 `1` 以禁用 [1M 上下文窗口](https://code.claude.com/zh-CN/model-config#extended-context)支持。设置后，1M 模型变体在模型选择器中不可用。对于具有合规要求的企业环境很有用 |
| `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING` | 设置为 `1` 以禁用 Opus 4.6 和 Sonnet 4.6 的 [自适应推理](https://code.claude.com/zh-CN/model-config#adjust-effort-level)并回退到由 `MAX_THINKING_TOKENS` 控制的固定思考预算。对 Opus 4.7 无效，它始终使用自适应推理 |
| `CLAUDE_CODE_DISABLE_AGENT_VIEW` | 设置为 `1` 以关闭 [后台代理和代理视图](https://code.claude.com/zh-CN/agent-view)：`claude agents`、`--bg`、`/background` 和按需监督员。等同于 [`disableAgentView`](https://code.claude.com/zh-CN/settings#available-settings) 设置 |
| `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN` | 设置为 `1` 以禁用 [全屏渲染](https://code.claude.com/zh-CN/fullscreen)并使用经典主屏幕渲染器。对话保持在您的终端的原生滚动条中，因此 `Cmd+f` 和 tmux 复制模式可以正常工作。优先于 `CLAUDE_CODE_NO_FLICKER` 和 [`tui`](https://code.claude.com/zh-CN/settings#available-settings) 设置。您也可以使用 `/tui default` 切换 |
| `CLAUDE_CODE_DISABLE_ATTACHMENTS` | 设置为 `1` 以禁用附件处理。带有 `@` 语法的文件提及作为纯文本发送，而不是扩展为文件内容 |
| `CLAUDE_CODE_DISABLE_AUTO_MEMORY` | 设置为 `1` 以禁用 [自动内存](https://code.claude.com/zh-CN/memory#auto-memory)。设置为 `0` 以在 `--bare` 模式或 [`autoMemoryEnabled: false`](https://code.claude.com/zh-CN/settings#available-settings) 会禁用它时强制启用自动内存。禁用后，Claude 不会创建或加载自动内存文件 |
| `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` | 设置为 `1` 以禁用所有后台任务功能，包括 Bash 和 subagent 工具上的 `run_in_background` 参数、自动后台处理和 Ctrl+B 快捷键 |
| `CLAUDE_CODE_DISABLE_CLAUDE_MDS` | 设置为 `1` 以防止将任何 CLAUDE.md 内存文件加载到上下文中，包括用户、项目和自动内存文件 |
| `CLAUDE_CODE_DISABLE_CRON` | 设置为 `1` 以禁用 [计划任务](https://code.claude.com/zh-CN/scheduled-tasks)。`/loop` skill 和 cron 工具变为不可用，任何已计划的任务停止触发，包括已在会话中运行的任务 |
| `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` | 设置为 `1` 以从 API 请求中删除 Anthropic 特定的 `anthropic-beta` 请求标头和 beta 工具架构字段（如 `defer_loading` 和 `eager_input_streaming`）。当代理网关拒绝请求并出现"Unexpected value(s) for the `anthropic-beta` header"或"Extra inputs are not permitted"之类的错误时，请使用此选项。标准字段（`name`、`description`、`input_schema`、`cache_control`）被保留。 |
| `CLAUDE_CODE_DISABLE_FAST_MODE` | 设置为 `1` 以禁用 [快速模式](https://code.claude.com/zh-CN/fast-mode) |
| `CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY` | 设置为 `1` 以禁用"Claude 表现如何？"会话质量调查。在设置 `DISABLE_TELEMETRY`、`DO_NOT_TRACK` 或 `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` 时也会禁用调查，除非 `CLAUDE_CODE_ENABLE_FEEDBACK_SURVEY_FOR_OTEL` 选择重新启用。要设置样本率而不是完全禁用，请使用 [`feedbackSurveyRate`](https://code.claude.com/zh-CN/settings#available-settings) 设置。请参阅 [会话质量调查](https://code.claude.com/zh-CN/data-usage#session-quality-surveys) |
| `CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING` | 设置为 `1` 以禁用文件 [checkpointing](https://code.claude.com/zh-CN/checkpointing)。`/rewind` 命令将无法恢复代码更改 |
| `CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS` | 设置为 `1` 以从 Claude 的系统提示中删除内置的提交和 PR 工作流说明和 git 状态快照。在使用您自己的 git 工作流 skills 时很有用。设置后优先于 [`includeGitInstructions`](https://code.claude.com/zh-CN/settings#available-settings) 设置 |
| `CLAUDE_CODE_DISABLE_LEGACY_MODEL_REMAP` | 设置为 `1` 以防止在 Anthropic API 上自动重新映射 Opus 4.0 和 4.1 到当前 Opus 版本。当您想要有意固定较旧的模型时使用。重新映射不在 Bedrock、Vertex 或 Foundry 上运行 |
| `CLAUDE_CODE_DISABLE_MOUSE` | 设置为 `1` 以禁用 [全屏渲染](https://code.claude.com/zh-CN/fullscreen)中的鼠标跟踪。使用 `PgUp` 和 `PgDn` 的键盘滚动仍然有效。使用此选项可保持终端的原生选择复制行为 |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | 等同于设置 `DISABLE_AUTOUPDATER`、`DISABLE_FEEDBACK_COMMAND`、`DISABLE_ERROR_REPORTING` 和 `DISABLE_TELEMETRY` |
| `CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK` | 设置为 `1` 以禁用流式请求在中途失败时的非流式回退。流式错误会传播到重试层。当代理或网关导致回退产生重复的工具执行时很有用 |
| `CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL` | 设置为 `1` 以跳过首次运行时官方插件市场的自动添加 |
| `CLAUDE_CODE_DISABLE_POLICY_SKILLS` | 设置为 `1` 以跳过从系统范围的托管 skills 目录加载 skills。对于不应加载操作员配置的 skills 的容器或 CI 会话很有用 |
| `CLAUDE_CODE_DISABLE_TERMINAL_TITLE` | 设置为 `1` 以禁用基于对话上下文的自动终端标题更新 |
| `CLAUDE_CODE_DISABLE_THINKING` | 设置为 `1` 以强制禁用 [扩展思考](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)，无论模型支持或其他设置如何。比 `MAX_THINKING_TOKENS=0` 更直接 |
| `CLAUDE_CODE_DISABLE_VIRTUAL_SCROLL` | 设置为 `1` 以禁用 [全屏渲染](https://code.claude.com/zh-CN/fullscreen)中的虚拟滚动并渲染转录中的每条消息。如果全屏模式中的滚动显示应该出现消息的空白区域，请使用此选项 |
| `CLAUDE_CODE_EFFORT_LEVEL` | 为支持的模型设置努力级别。值：`low`、`medium`、`high`、`xhigh`、`max` 或 `auto` 以使用模型默认值。可用级别取决于模型。优先于 `/effort` 和 `effortLevel` 设置。请参阅 [调整努力级别](https://code.claude.com/zh-CN/model-config#adjust-effort-level) |
| `CLAUDE_CODE_ENABLE_AWAY_SUMMARY` | 覆盖 [会话回顾](https://code.claude.com/zh-CN/interactive-mode#session-recap)可用性。设置为 `0` 以强制关闭回顾，无论 `/config` 切换如何。设置为 `1` 以在 [`awaySummaryEnabled`](https://code.claude.com/zh-CN/settings#available-settings) 为 `false` 时强制启用回顾。优先于设置和 `/config` 切换 |
| `CLAUDE_CODE_ENABLE_BACKGROUND_PLUGIN_REFRESH` | 设置为 `1` 以在 [非交互模式](https://code.claude.com/zh-CN/headless)中的转换边界处刷新插件状态，在后台安装完成后。默认关闭，因为刷新会在会话中途更改系统提示，这会使该转换的 [prompt caching](https://code.claude.com/zh-CN/prompt-caching) 失效 |
| `CLAUDE_CODE_ENABLE_FEEDBACK_SURVEY_FOR_OTEL` | 设置为 `1` 以在 Anthropic 绑定的非必要流量被阻止时将"Claude 表现如何？"会话质量调查路由到您自己的 [OpenTelemetry 收集器](https://code.claude.com/zh-CN/monitoring-usage)。调查评分仅作为 OTEL 事件发送到您配置的收集器。在此模式下，不会向 Anthropic 发送任何调查数据。在设置 `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`、`DISABLE_TELEMETRY` 或 `DO_NOT_TRACK` 时应用，否则无效。`CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY` 和组织产品反馈政策优先 |
| `CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING` | 控制工具调用输入是否在 API 生成时从 API 流式传输。关闭此选项时，大型工具输入（如长文件写入）仅在 Claude 完成生成后才到达，这可能看起来像是挂起。对于 Anthropic API 默认启用。在 Bedrock 和 Vertex 上，按模型启用，其中部署的容器支持它。设置为 `0` 以选择退出。设置为 `1` 以在通过 `ANTHROPIC_BASE_URL`、`ANTHROPIC_VERTEX_BASE_URL` 或 `ANTHROPIC_BEDROCK_BASE_URL` 路由到代理时强制启用。对 Foundry 和 [网关](https://code.claude.com/zh-CN/llm-gateway)连接默认关闭 |
| `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY` | 设置为 `1` 以在 `ANTHROPIC_BASE_URL` 指向 Anthropic 兼容网关（如 LiteLLM、Kong 或内部代理）时从网关的 `/v1/models` 端点填充 `/model` 选择器。默认关闭，因为由共享 API 密钥支持的网关会显示该密钥可以访问的每个用户的每个模型。发现的模型仍由 [`availableModels`](https://code.claude.com/zh-CN/settings#available-settings) 允许列表过滤 |
| `CLAUDE_CODE_ENABLE_OPUS_4_7_FAST_MODE` | 在 v2.1.142 中移除。 [快速模式](https://code.claude.com/zh-CN/fast-mode)默认为 Opus 4.7。设置 `CLAUDE_CODE_OPUS_4_6_FAST_MODE_OVERRIDE=1` 以保持 Opus 4.6 |
| `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION` | 设置为 `false` 以禁用提示建议（`/config` 中的"提示建议"切换）。这些是在 Claude 响应后出现在提示输入中的灰显预测。请参阅 [提示建议](https://code.claude.com/zh-CN/interactive-mode#prompt-suggestions) |
| `CLAUDE_CODE_ENABLE_TASKS` | 控制会话是否使用结构化 Task 工具（`TaskCreate`、`TaskUpdate`、`TaskGet`、`TaskList`）或旧版 `TodoWrite` 工具。从 Claude Code v2.1.142 开始，Task 工具是所有模式中的默认工具。设置为 `0` 以恢复为 `TodoWrite`。请参阅 [任务列表](https://code.claude.com/zh-CN/interactive-mode#task-list)和 [迁移到 Task 工具](https://code.claude.com/zh-CN/agent-sdk/todo-tracking#migrate-to-task-tools) |
| `CLAUDE_CODE_ENABLE_TELEMETRY` | 设置为 `1` 以启用 OpenTelemetry 数据收集以获取指标和日志。在配置 OTel 导出器之前需要。请参阅 [监控](https://code.claude.com/zh-CN/monitoring-usage) |
| `CLAUDE_CODE_EXIT_AFTER_STOP_DELAY` | 查询循环变为空闲后自动退出前等待的时间（以毫秒为单位）。对于使用 SDK 模式的自动化工作流和脚本很有用 |
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` | 设置为 `1` 以启用 [代理团队](https://code.claude.com/zh-CN/agent-teams)。代理团队是实验性的，默认禁用 |
| `CLAUDE_CODE_EXTRA_BODY` | JSON 对象以合并到每个 API 请求体的顶级。对于传递 Claude Code 不直接公开的提供商特定参数很有用 |
| `CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS` | 覆盖文件读取的默认令牌限制。当您需要完整读取较大文件时很有用 |
| `CLAUDE_CODE_FORCE_SYNC_OUTPUT` | 设置为 `1` 以在您的终端支持但未自动检测到时强制启用 DEC 私有模式 2026 [同步输出](https://gist.github.com/christianparpart/d8a62cc1ab659194337d73e399004036)。对于实现 BSU/ESU 但不回复能力探针的模拟器（如 Emacs `eat`）很有用。在 tmux 下无效 |
| `CLAUDE_CODE_FORK_SUBAGENT` | 设置为 `1` 以启用 [分叉 subagents](https://code.claude.com/zh-CN/sub-agents#fork-the-current-conversation)。分叉的 subagent 从主会话继承完整的对话上下文，而不是从头开始。启用后，`/fork` 生成分叉的 subagent 而不是充当 [`/branch`](https://code.claude.com/zh-CN/commands) 的别名，所有 subagent 生成在后台运行。在交互模式和通过 SDK 或 `claude -p` 中工作 |
| `CLAUDE_CODE_GIT_BASH_PATH` | 仅限 Windows：Git Bash 可执行文件 (`bash.exe`) 的路径。当 Git Bash 已安装但不在您的 PATH 中时使用。请参阅 [Windows 设置](https://code.claude.com/zh-CN/setup#set-up-on-windows) |
| `CLAUDE_CODE_GLOB_HIDDEN` | 设置为 `false` 以在 Claude 调用 [Glob 工具](https://code.claude.com/zh-CN/tools-reference#glob-tool-behavior)时从结果中排除点文件。默认包含。不影响 `@` 文件自动完成、`ls`、Grep 或 Read |
| `CLAUDE_CODE_GLOB_NO_IGNORE` | 设置为 `false` 以使 [Glob 工具](https://code.claude.com/zh-CN/tools-reference#glob-tool-behavior)尊重 `.gitignore` 模式。默认情况下，Glob 返回所有匹配的文件，包括被 gitignore 的文件。不影响 `@` 文件自动完成，它有自己的 [`respectGitignore` 设置](https://code.claude.com/zh-CN/settings#available-settings) |
| `CLAUDE_CODE_GLOB_TIMEOUT_SECONDS` | Glob 工具文件发现的超时时间（以秒为单位）。在大多数平台上默认为 20 秒，在 WSL 上默认为 60 秒 |
| `CLAUDE_CODE_HIDE_CWD` | 设置为 `1` 以在启动徽标中隐藏工作目录。对于屏幕共享或录制（其中路径暴露您的操作系统用户名）很有用 |
| `CLAUDE_CODE_IDE_HOST_OVERRIDE` | 覆盖用于连接到 IDE 扩展的主机地址。默认情况下，Claude Code 自动检测正确的地址，包括 WSL 到 Windows 的路由 |
| `CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL` | 跳过 IDE 扩展的自动安装。等同于将 [`autoInstallIdeExtension`](https://code.claude.com/zh-CN/settings#global-config-settings) 设置为 `false` |
| `CLAUDE_CODE_IDE_SKIP_VALID_CHECK` | 设置为 `1` 以跳过连接期间 IDE 锁定文件条目的验证。当自动连接无法找到您的 IDE 时使用，尽管它正在运行 |
| `CLAUDE_CODE_MAX_CONTEXT_TOKENS` | 覆盖 Claude Code 为活动模型假设的上下文窗口大小。仅在同时设置 `DISABLE_COMPACT` 时生效。当通过 `ANTHROPIC_BASE_URL` 路由到上下文窗口与其名称的内置大小不匹配的模型时使用 |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS` | 设置大多数请求的最大输出令牌数。默认值和上限因模型而异；请参阅 [最大输出令牌](https://platform.claude.com/docs/en/about-claude/models/overview#latest-models-comparison)。增加此值会减少在 [自动压缩](https://code.claude.com/zh-CN/costs#reduce-token-usage)触发之前可用的有效上下文窗口。 |
| `CLAUDE_CODE_MAX_RETRIES` | 覆盖重试失败 API 请求的次数（默认值：10） |
| `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` | 可以并行执行的只读工具和 subagents 的最大数量（默认值：10）。更高的值增加并行性但消耗更多资源 |
| `CLAUDE_CODE_MAX_TURNS` | 当未传递显式限制时，限制代理转换的数量。等同于传递 [`--max-turns`](https://code.claude.com/zh-CN/cli-reference#cli-flags)，当两者都设置时优先。不是正整数的值在启动时被拒绝并显示错误，而不是被视为无限制 |
| `CLAUDE_CODE_MCP_ALLOWLIST_ENV` | 设置为 `1` 以使用仅安全基线环境加上服务器的配置 `env` 生成 stdio MCP 服务器，而不是继承您的 shell 环境 |
| `CLAUDE_CODE_NATIVE_CURSOR` | 设置为 `1` 以在输入插入符处显示终端自己的光标，而不是绘制的块。光标尊重终端的闪烁、形状和焦点设置 |
| `CLAUDE_CODE_NEW_INIT` | 设置为 `1` 以使 `/init` 运行交互式设置流程。该流程会询问要生成哪些文件，包括 CLAUDE.md、skills 和 hooks，然后再探索代码库并编写它们。没有此变量，`/init` 会自动生成 CLAUDE.md 而不提示。 |
| `CLAUDE_CODE_NO_FLICKER` | 设置为 `1` 以启用 [全屏渲染](https://code.claude.com/zh-CN/fullscreen)，这是一个研究预览，可减少闪烁并在长对话中保持内存平坦。等同于 [`tui`](https://code.claude.com/zh-CN/settings#available-settings) 设置；您也可以使用 `/tui fullscreen` 切换 |
| `CLAUDE_CODE_OAUTH_REFRESH_TOKEN` | Claude.ai 身份验证的 OAuth 刷新令牌。设置后，`claude auth login` 直接交换此令牌，而不是打开浏览器。需要 `CLAUDE_CODE_OAUTH_SCOPES`。对于在自动化环境中配置身份验证很有用 |
| `CLAUDE_CODE_OAUTH_SCOPES` | 刷新令牌颁发时使用的空格分隔的 OAuth 作用域，例如 `"user:profile user:inference user:sessions:claude_code"`。设置 `CLAUDE_CODE_OAUTH_REFRESH_TOKEN` 时为必需 |
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude.ai 身份验证的 OAuth 访问令牌。`/login` 对于 SDK 和自动化环境的替代方案。优先于钥匙链存储的凭证。使用 [`claude setup-token`](https://code.claude.com/zh-CN/authentication#generate-a-long-lived-token) 生成一个 |
| `CLAUDE_CODE_OPUS_4_6_FAST_MODE_OVERRIDE` | 设置为 `1` 以将 [快速模式](https://code.claude.com/zh-CN/fast-mode)固定到 Claude Opus 4.6 而不是默认的 Opus 4.7。设置此变量后，`/fast` 在 Opus 4.6 上运行。没有它，`/fast` 在 Opus 4.7 上运行 |
| `CLAUDE_CODE_OTEL_FLUSH_TIMEOUT_MS` | 刷新待处理 OpenTelemetry spans 的超时时间（以毫秒为单位）（默认值：5000）。请参阅 [监控](https://code.claude.com/zh-CN/monitoring-usage) |
| `CLAUDE_CODE_OTEL_HEADERS_HELPER_DEBOUNCE_MS` | 刷新动态 OpenTelemetry 标头的间隔（以毫秒为单位）（默认值：1740000 / 29 分钟）。请参阅 [动态标头](https://code.claude.com/zh-CN/monitoring-usage#dynamic-headers) |
| `CLAUDE_CODE_OTEL_SHUTDOWN_TIMEOUT_MS` | OpenTelemetry 导出器在关闭时完成的超时时间（以毫秒为单位）（默认值：2000）。如果在退出时丢弃指标，请增加此值。请参阅 [监控](https://code.claude.com/zh-CN/monitoring-usage) |
| `CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE` | 设置为 `1` 以让 Claude Code 在新版本可用时在后台运行您的包管理器的升级命令。适用于 Homebrew 和 WinGet 安装。其他包管理器继续显示升级命令而不运行它。请参阅 [自动更新](https://code.claude.com/zh-CN/setup#auto-updates) |
| `CLAUDE_CODE_PERFORCE_MODE` | 设置为 `1` 以启用 Perforce 感知的写入保护。设置后，如果目标文件缺少所有者写入位（Perforce 在同步文件上清除，直到 `p4 edit` 打开它们），Edit、Write 和 NotebookEdit 会失败并显示 `p4 edit ` 提示。这可防止 Claude Code 绕过 Perforce 变更跟踪 |
| `CLAUDE_CODE_PLUGIN_CACHE_DIR` | 覆盖插件根目录。尽管名称如此，这设置的是父目录，而不是缓存本身：市场和插件缓存位于此路径下的子目录中。默认为 `~/.claude/plugins` |
| `CLAUDE_CODE_PLUGIN_GIT_TIMEOUT_MS` | 安装或更新插件时 git 操作的超时（以毫秒为单位）（默认值：120000）。对于大型存储库或网络连接缓慢的情况，请增加此值。请参阅 [Git 操作超时](https://code.claude.com/zh-CN/plugin-marketplaces#git-operations-time-out) |
| `CLAUDE_CODE_PLUGIN_KEEP_MARKETPLACE_ON_FAILURE` | 设置为 `1` 以在 `git pull` 失败时保留现有市场缓存，而不是擦除并重新克隆。在离线或隔离环境中很有用，其中重新克隆会以相同方式失败。请参阅 [市场更新在离线环境中失败](https://code.claude.com/zh-CN/plugin-marketplaces#marketplace-updates-fail-in-offline-environments) |
| `CLAUDE_CODE_PLUGIN_PREFER_HTTPS` | 设置为 `1` 以通过 HTTPS 而不是 SSH 克隆 GitHub `owner/repo` 插件源。在 CI 运行器、容器或任何没有为 `github.com` 配置 SSH 密钥的环境中很有用 |
| `CLAUDE_CODE_PLUGIN_SEED_DIR` | 一个或多个只读插件种子目录的路径，在 Unix 上用 `:` 分隔，在 Windows 上用 `;` 分隔。使用此选项可将预填充的插件目录捆绑到容器镜像中。Claude Code 在启动时从这些目录注册市场，并使用预缓存的插件而无需重新克隆。请参阅 [为容器预填充插件](https://code.claude.com/zh-CN/plugin-marketplaces#pre-populate-plugins-for-containers) |
| `CLAUDE_CODE_POWERSHELL_RESPECT_EXECUTION_POLICY` | 设置为 `1` 以停止 Claude Code 在生成 PowerShell 以进行工具调用、hooks 和状态行命令时传递 `-ExecutionPolicy Bypass`，并改为尊重机器的有效执行策略。默认情况下，Claude Code 在进程范围内绕过执行策略，以便 `.ps1` 脚本和模块导入在默认受限的 Windows 安装上工作。无论此设置如何，进程范围的绕过永远不会覆盖组策略 `MachinePolicy` 或 `UserPolicy` |
| `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST` | 由嵌入 Claude Code 的主机平台设置，并代表其管理模型提供商路由。设置后，提供商选择、端点和身份验证变量（如 `CLAUDE_CODE_USE_BEDROCK`、`ANTHROPIC_BASE_URL` 和 `ANTHROPIC_API_KEY`）在设置文件中被忽略，以便用户设置无法覆盖主机的路由。Bedrock、Vertex 和 Foundry 的自动遥测选择退出也被跳过，因此遥测遵循标准 `DISABLE_TELEMETRY` 选择退出。请参阅 [按 API 提供商的默认行为](https://code.claude.com/zh-CN/data-usage#default-behaviors-by-api-provider) |
| `CLAUDE_CODE_PROXY_RESOLVES_HOSTS` | 设置为 `1` 以允许代理执行 DNS 解析而不是调用者。对于代理应处理主机名解析的环境选择加入 |
| `CLAUDE_CODE_REMOTE` | 当 Claude Code 作为 [云会话](https://code.claude.com/zh-CN/claude-code-on-the-web)运行时自动设置为 `true`。从 hook 或设置脚本读取此值以检测您是否在云环境中 |
| `CLAUDE_CODE_REMOTE_SESSION_ID` | 在 [云会话](https://code.claude.com/zh-CN/claude-code-on-the-web)中自动设置为当前会话的 ID。读取此值以构造返回会话转录的链接。请参阅 [将工件链接回会话](https://code.claude.com/zh-CN/claude-code-on-the-web#link-artifacts-back-to-the-session) |
| `CLAUDE_CODE_RESUME_INTERRUPTED_TURN` | 设置为 `1` 以在上一个会话在中途结束时自动恢复。在 SDK 模式中使用，以便模型继续而无需 SDK 重新发送提示 |
| `CLAUDE_CODE_RESUME_PROMPT` | 覆盖在恢复在中途结束的会话时注入的继续消息。默认为 `Continue from where you left off.`。长时间运行的代理的生成脚本可以将其设置为更具指导性的启动消息。空字符串使用默认值 |
| `CLAUDE_CODE_SCRIPT_CAPS` | JSON 对象，当设置 `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` 时限制特定脚本在每个会话中可以调用的次数。键是与命令文本匹配的子字符串；值是整数调用限制。例如，`{"deploy.sh": 2}` 允许 `deploy.sh` 最多被调用两次。匹配是基于子字符串的，所以 shell 扩展技巧如 `./scripts/deploy.sh $(evil)` 仍然计入上限。通过 `xargs` 或 `find -exec` 的运行时扇出不被检测；这是一个深度防御控制 |
| `CLAUDE_CODE_SCROLL_SPEED` | 在 [全屏渲染](https://code.claude.com/zh-CN/fullscreen)中设置鼠标滚轮滚动倍数。接受 1 到 20 的值。设置为 `3` 以匹配 `vim`（如果您的终端每个刻度线发送一个滚轮事件而不进行放大）。在 JetBrains IDE 终端中被忽略，Claude Code 使用其自己的滚动处理 |
| `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS` | [SessionEnd](https://code.claude.com/zh-CN/hooks#sessionend) hooks 的时间预算（以毫秒为单位）。适用于会话退出、`/clear` 和通过交互式 `/resume` 切换会话。默认预算为 1.5 秒，自动提高到设置文件中配置的最高每个 hook `timeout`，最高 60 秒。插件提供的 hooks 上的超时不会提高预算 |
| `CLAUDE_CODE_SESSION_ID` | 在 Bash 和 PowerShell 工具子进程中自动设置为当前会话 ID。与传递给 [hooks](https://code.claude.com/zh-CN/hooks) 的 `session_id` 字段匹配。在 `/clear` 时更新。用于将脚本和外部工具与启动它们的 Claude Code 会话相关联 |
| `CLAUDE_CODE_SHELL` | 覆盖自动 shell 检测。当您的登录 shell 与您的首选工作 shell 不同时很有用（例如，`bash` 与 `zsh`） |
| `CLAUDE_CODE_SHELL_PREFIX` | 命令前缀以包装 Claude Code 生成的所有 bash 命令：Bash 工具调用、 [hook](https://code.claude.com/zh-CN/hooks) 命令和 stdio [MCP server](https://code.claude.com/zh-CN/mcp) 启动命令。对于日志记录或审计很有用。示例：设置 `/path/to/logger.sh` 将每个命令作为 `/path/to/logger.sh ` 运行 |
| `CLAUDE_CODE_SIMPLE` | 设置为 `1` 以使用最小系统提示和仅 Bash、文件读取和文件编辑工具运行。MCP 工具来自 `--mcp-config` 仍然可用。禁用 hooks、skills、plugins、MCP servers、自动内存和 CLAUDE.md 的自动发现。OAuth 令牌和钥匙链凭证不被读取，所以 Anthropic 身份验证必须来自 `ANTHROPIC_API_KEY` 或 `--settings` 中的 `apiKeyHelper`。等同于传递 [`--bare`](https://code.claude.com/zh-CN/headless#start-faster-with-bare-mode) |
| `CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT` | 设置为 `1` 以在任何模型上使用较短的系统提示和缩写的工具描述。设置为 `0`、`false`、`no` 或 `off` 以选择退出，即使在实验或服务器配置会以其他方式启用它的模型上。完整的工具集、hooks、MCP 服务器和 CLAUDE.md 发现保持启用 |
| `CLAUDE_CODE_SKIP_ANTHROPIC_AWS_AUTH` | 跳过 [Claude Platform on AWS](https://code.claude.com/zh-CN/claude-platform-on-aws) 的客户端身份验证，用于自己签署请求的网关 |
| `CLAUDE_CODE_SKIP_BEDROCK_AUTH` | 跳过 Bedrock 的 AWS 身份验证（例如，使用 LLM 网关时） |
| `CLAUDE_CODE_SKIP_FOUNDRY_AUTH` | 跳过 Microsoft Foundry 的 Azure 身份验证（例如，使用 LLM 网关时） |
| `CLAUDE_CODE_SKIP_MANTLE_AUTH` | 跳过 Bedrock Mantle 的 AWS 身份验证（例如，使用 LLM 网关时） |
| `CLAUDE_CODE_SKIP_PROMPT_HISTORY` | 设置为 `1` 以跳过将提示历史和会话转录写入磁盘。使用此变量启动的会话不会出现在 `--resume`、`--continue` 或向上箭头历史中。对于临时脚本会话很有用 |
| `CLAUDE_CODE_SKIP_VERTEX_AUTH` | 跳过 Vertex 的 Google 身份验证（例如，使用 LLM 网关时） |
| `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` | [Stop](https://code.claude.com/zh-CN/hooks#stop) 或 [SubagentStop](https://code.claude.com/zh-CN/hooks#subagentstop) hook 可能在 Claude Code 覆盖它并无论如何结束转换之前阻止转换结束的最大连续次数（默认值：8）。设置为 `0` 以禁用上限。如果您的 hook 合法需要更多迭代来解决，请提高此值 |
| `CLAUDE_CODE_SUBAGENT_MODEL` | 请参阅 [模型配置](https://code.claude.com/zh-CN/model-config) |
| `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` | 设置为 `1` 以从子进程环境（Bash 工具、hooks、MCP stdio 服务器）中删除 Anthropic 和云提供商凭证。父 Claude 进程为 API 调用保留这些凭证，但子进程无法读取它们，减少了通过 shell 扩展尝试窃取机密的提示注入攻击的暴露。在 Linux 上，这也在隔离的 PID 命名空间中运行 Bash 子进程，以便它们无法通过 `/proc` 读取主机进程环境；作为副作用，`ps`、`pgrep` 和 `kill` 无法看到或信号主机进程。当配置了 `allowed_non_write_users` 时，`claude-code-action` 会自动设置此选项 |
| `CLAUDE_CODE_SYNC_PLUGIN_INSTALL` | 设置为 `1` 在非交互模式（`-p` 标志）中等待插件安装完成后再进行第一个查询。没有这个，插件在后台安装，可能在第一个回合不可用。与 `CLAUDE_CODE_SYNC_PLUGIN_INSTALL_TIMEOUT_MS` 结合以限制等待时间 |
| `CLAUDE_CODE_SYNC_PLUGIN_INSTALL_TIMEOUT_MS` | 同步插件安装的超时时间（以毫秒为单位）。超过时，Claude Code 继续而不使用插件并记录错误。无默认值：没有此变量，同步安装会等待直到完成 |
| `CLAUDE_CODE_SYNTAX_HIGHLIGHT` | 设置为 `false` 以禁用 diff 输出中的语法突出显示。当颜色干扰您的终端设置时很有用。要同时禁用代码块和文件预览中的突出显示，请使用 [`syntaxHighlightingDisabled`](https://code.claude.com/zh-CN/settings) 设置 |
| `CLAUDE_CODE_TASK_LIST_ID` | 跨会话共享任务列表。在多个 Claude Code 实例中设置相同的 ID 以协调共享任务列表。请参阅 [任务列表](https://code.claude.com/zh-CN/interactive-mode#task-list) |
| `CLAUDE_CODE_TEAM_NAME` | 此队友所属的代理团队的名称。在 [代理团队](https://code.claude.com/zh-CN/agent-teams)成员上自动设置 |
| `CLAUDE_CODE_TMPDIR` | 覆盖用于内部临时文件的临时目录。Claude Code 将 `/claude-{uid}/`（Unix）或 `/claude/`（Windows）附加到此路径。默认值：macOS 上为 `/tmp`，Linux/Windows 上为 `os.tmpdir()` |
| `CLAUDE_CODE_TMUX_TRUECOLOR` | 设置为 `1` 以允许 tmux 内的 24 位真彩色输出。默认情况下，当设置 `$TMUX` 时，Claude Code 限制为 256 色，因为 tmux 不会通过真彩色转义序列，除非配置为这样做。在将 `set -ga terminal-overrides ',*:Tc'` 添加到您的 `~/.tmux.conf` 后设置此选项。请参阅 [终端配置](https://code.claude.com/zh-CN/terminal-config)了解其他 tmux 设置 |
| `CLAUDE_CODE_USE_ANTHROPIC_AWS` | 使用 [Claude Platform on AWS](https://code.claude.com/zh-CN/claude-platform-on-aws) |
| `CLAUDE_CODE_USE_BEDROCK` | 使用 [Bedrock](https://code.claude.com/zh-CN/amazon-bedrock) |
| `CLAUDE_CODE_USE_FOUNDRY` | 使用 [Microsoft Foundry](https://code.claude.com/zh-CN/microsoft-foundry) |
| `CLAUDE_CODE_USE_MANTLE` | 使用 Bedrock [Mantle 端点](https://code.claude.com/zh-CN/amazon-bedrock#use-the-mantle-endpoint) |
| `CLAUDE_CODE_USE_NATIVE_FILE_SEARCH` | 设置为 `1` 以使用 Node.js 文件 API 而不是 ripgrep 发现自定义命令、subagents 和输出样式。如果捆绑的 ripgrep 二进制文件在您的环境中不可用或被阻止，请设置此选项。不影响 Grep 或文件搜索工具 |
| `CLAUDE_CODE_USE_POWERSHELL_TOOL` | 控制 PowerShell 工具。在没有 Git Bash 的 Windows 上，该工具会自动启用；设置为 `0` 以禁用它。在安装了 Git Bash 的 Windows 上，该工具正在逐步推出：设置为 `1` 以选择加入或 `0` 以选择退出。在 Linux、macOS 和 WSL 上，设置为 `1` 以启用它，这需要您的 `PATH` 上有 `pwsh`。在 Windows 上启用时，Claude 可以本地运行 PowerShell 命令，而不是通过 Git Bash 路由。请参阅 [PowerShell 工具](https://code.claude.com/zh-CN/tools-reference#powershell-tool) |
| `CLAUDE_CODE_USE_VERTEX` | 使用 [Vertex](https://code.claude.com/zh-CN/google-vertex-ai) |
| `CLAUDE_CONFIG_DIR` | 覆盖配置目录（默认值：`~/.claude`）。所有设置、凭证、会话历史和插件都存储在此路径下。对于并行运行多个帐户很有用：例如，`alias claude-work='CLAUDE_CONFIG_DIR=~/.claude-work claude'` |
| `CLAUDE_EFFORT` | 在 Bash 工具子进程和 hook 命令中自动设置为该转换的活动 [努力级别](https://code.claude.com/zh-CN/model-config#adjust-effort-level)：`low`、`medium`、`high`、`xhigh` 或 `max`。与传递给 [hooks](https://code.claude.com/zh-CN/hooks) 的 `effort.level` 字段匹配。仅在当前模型支持努力参数时设置 |
| `CLAUDE_ENABLE_BYTE_WATCHDOG` | 设置为 `1` 以强制启用字节级流式空闲监视程序，或设置为 `0` 以强制禁用它。未设置时，监视程序对 Anthropic API 连接默认启用。字节监视程序在 `CLAUDE_STREAM_IDLE_TIMEOUT_MS` 设置的持续时间内没有字节到达线路时中止连接，最少 5 分钟，独立于事件级监视程序 |
| `CLAUDE_ENABLE_BYTE_WATCHDOG_BEDROCK` | 设置为 `1` 以在 Amazon Bedrock `vnd.amazon.eventstream` 响应上启用字节级流式空闲监视程序。默认关闭。使用 `CLAUDE_STREAM_IDLE_TIMEOUT_MS` 配置超时 |
| `CLAUDE_ENABLE_STREAM_WATCHDOG` | 设置为 `1` 以启用事件级流式空闲监视程序。默认关闭。对于所有提供商，包括 Bedrock。对于 Vertex 和 Foundry，这是唯一可用的空闲监视程序。在 Bedrock 上，您也可以使用 `CLAUDE_ENABLE_BYTE_WATCHDOG_BEDROCK` 启用独立的字节级监视程序；当两者都设置时，它们一起运行。使用 `CLAUDE_STREAM_IDLE_TIMEOUT_MS` 配置超时 |
| `CLAUDE_ENV_FILE` | Claude Code 在每个 Bash 命令之前在同一 shell 进程中运行的 shell 脚本的路径，因此文件中的导出对命令可见。用于在命令之间保持 virtualenv 或 conda 激活。也由 [SessionStart](https://code.claude.com/zh-CN/hooks#persist-environment-variables)、 [Setup](https://code.claude.com/zh-CN/hooks#setup)、 [CwdChanged](https://code.claude.com/zh-CN/hooks#cwdchanged) 和 [FileChanged](https://code.claude.com/zh-CN/hooks#filechanged) hooks 动态填充 |
| `CLAUDE_REMOTE_CONTROL_SESSION_NAME_PREFIX` | 当未提供显式名称时，自动生成的 [远程控制](https://code.claude.com/zh-CN/remote-control)会话名称的前缀。默认为您的机器的主机名，生成名称如 `myhost-graceful-unicorn`。`--remote-control-session-name-prefix` CLI 标志为单个调用设置相同的值 |
| `CLAUDE_STREAM_IDLE_TIMEOUT_MS` | 流式空闲监视程序关闭停滞连接前的超时（以毫秒为单位）。默认和最小 `300000`（5 分钟）对于字节级和事件级监视程序；较低的值被静默限制以吸收扩展思考暂停和代理缓冲。对于第三方提供商，需要 `CLAUDE_ENABLE_STREAM_WATCHDOG=1`。在 Bedrock 上，也在 `CLAUDE_ENABLE_BYTE_WATCHDOG_BEDROCK=1` 时应用 |
| `DEBUG` | 设置为 `1` 以启用调试模式，等同于使用 [`--debug`](https://code.claude.com/zh-CN/cli-reference#cli-flags) 启动。调试日志写入 `~/.claude/debug/.txt`，或写入 `CLAUDE_CODE_DEBUG_LOGS_DIR` 设置的路径。仅真值 `1`、`true`、`yes` 和 `on` 启用调试模式，因此为其他工具设置的命名空间模式如 `DEBUG=express:*` 不会触发它 |
| `DISABLE_AUTOUPDATER` | 设置为 `1` 以禁用自动后台更新。手动 `claude update` 仍然有效。使用 `DISABLE_UPDATES` 以阻止两者 |
| `DISABLE_AUTO_COMPACT` | 设置为 `1` 以禁用接近上下文限制时的自动压缩。手动 `/compact` 命令仍然可用。当您想要明确控制何时进行压缩时使用 |
| `DISABLE_COMPACT` | 设置为 `1` 以禁用所有压缩：自动压缩和手动 `/compact` 命令 |
| `DISABLE_COST_WARNINGS` | 设置为 `1` 以禁用成本警告消息 |
| `DISABLE_DOCTOR_COMMAND` | 设置为 `1` 以隐藏 `/doctor` 命令。对于用户不应运行安装诊断的托管部署很有用 |
| `DISABLE_ERROR_REPORTING` | 设置为 `1` 以选择退出 Sentry 错误报告 |
| `DISABLE_EXTRA_USAGE_COMMAND` | 设置为 `1` 以隐藏 `/usage-credits` 命令，该命令允许用户购买超过速率限制的额外使用量 |
| `DISABLE_FEEDBACK_COMMAND` | 设置为 `1` 以禁用 `/feedback` 命令。也接受较旧的名称 `DISABLE_BUG_COMMAND` |
| `DISABLE_GROWTHBOOK` | 设置为 `1` 以禁用 GrowthBook 功能标志获取并对每个标志使用代码默认值。除非同时设置 `DISABLE_TELEMETRY`，否则遥测事件日志记录保持启用 |
| `DISABLE_INSTALLATION_CHECKS` | 设置为 `1` 以禁用安装警告。仅在手动管理安装位置时使用，因为这可能会掩盖标准安装的问题 |
| `DISABLE_INSTALL_GITHUB_APP_COMMAND` | 设置为 `1` 以隐藏 `/install-github-app` 命令。使用第三方提供商（Bedrock、Vertex 或 Foundry）时已隐藏 |
| `DISABLE_INTERLEAVED_THINKING` | 设置为 `1` 以防止发送交错思考 beta 标头。当您的 LLM 网关或提供商不支持 [交错思考](https://platform.claude.com/docs/en/build-with-claude/extended-thinking#interleaved-thinking)时很有用 |
| `DISABLE_LOGIN_COMMAND` | 设置为 `1` 以隐藏 `/login` 命令。当身份验证通过 API 密钥或 `apiKeyHelper` 外部处理时很有用 |
| `DISABLE_LOGOUT_COMMAND` | 设置为 `1` 以隐藏 `/logout` 命令 |
| `DISABLE_PROMPT_CACHING` | 设置为 `1` 以禁用所有模型的 prompt caching（优先于每个模型的设置） |
| `DISABLE_PROMPT_CACHING_HAIKU` | 设置为 `1` 以禁用 Haiku 模型的 prompt caching |
| `DISABLE_PROMPT_CACHING_OPUS` | 设置为 `1` 以禁用 Opus 模型的 prompt caching |
| `DISABLE_PROMPT_CACHING_SONNET` | 设置为 `1` 以禁用 Sonnet 模型的 prompt caching |
| `DISABLE_TELEMETRY` | 设置为 `1` 以选择退出遥测。遥测事件不包括用户数据，如代码、文件路径或 bash 命令。也禁用功能标志获取，因此仍在推出的某些功能可能不可用 |
| `DISABLE_UPDATES` | 设置为 `1` 以阻止所有更新，包括手动 `claude update` 和 `claude install`。比 `DISABLE_AUTOUPDATER` 更严格。当通过您自己的渠道分发 Claude Code 且用户不应自行更新时使用 |
| `DISABLE_UPGRADE_COMMAND` | 设置为 `1` 以隐藏 `/upgrade` 命令 |
| `DO_NOT_TRACK` | 设置为 `1` 以选择退出遥测。等同于设置 `DISABLE_TELEMETRY`。作为 [标准跨工具约定](https://consoledonottrack.com/)被遵守 |
| `ENABLE_CLAUDEAI_MCP_SERVERS` | 设置为 `false` 以禁用 Claude Code 中的 [claude.ai MCP servers](https://code.claude.com/zh-CN/mcp#use-mcp-servers-from-claude-ai)。对于已登录的用户默认启用 |
| `ENABLE_PROMPT_CACHING_1H` | 设置为 `1` 以请求 1 小时的 prompt cache TTL 而不是默认的 5 分钟。适用于 API 密钥、 [Bedrock](https://code.claude.com/zh-CN/amazon-bedrock)、 [Vertex](https://code.claude.com/zh-CN/google-vertex-ai)、 [Foundry](https://code.claude.com/zh-CN/microsoft-foundry) 和 [Claude Platform on AWS](https://code.claude.com/zh-CN/claude-platform-on-aws) 用户。订阅用户自动获得 1 小时 TTL。1 小时缓存写入按更高费率计费 |
| `ENABLE_PROMPT_CACHING_1H_BEDROCK` | 已弃用。改用 `ENABLE_PROMPT_CACHING_1H` |
| `ENABLE_TOOL_SEARCH` | 控制 [MCP 工具搜索](https://code.claude.com/zh-CN/mcp#scale-with-mcp-tool-search)。未设置：默认延迟所有 MCP 工具，但在 Vertex AI 上或当 `ANTHROPIC_BASE_URL` 指向非第一方主机时提前加载。值：`true`（始终延迟并发送 beta 标头，在 Vertex AI 上支持 Sonnet 4.5 及更高版本或 Opus 4.5 及更高版本的请求失败，或在不支持 `tool_reference` 的代理上）、`auto`（阈值模式：如果工具适合在上下文的 10% 内则提前加载）、`auto:N`（自定义阈值，例如 `auto:5` 表示 5%）、`false`（提前加载所有） |
| `FALLBACK_FOR_ALL_PRIMARY_MODELS` | 设置为任何非空值以在任何主模型上重复过载错误后触发回退到 [`--fallback-model`](https://code.claude.com/zh-CN/cli-reference#cli-flags)。默认情况下，仅 Opus 模型触发回退 |
| `FORCE_AUTOUPDATE_PLUGINS` | 设置为 `1` 以强制插件自动更新，即使主自动更新程序通过 `DISABLE_AUTOUPDATER` 禁用 |
| `FORCE_PROMPT_CACHING_5M` | 设置为 `1` 以强制 5 分钟的 prompt cache TTL，即使 1 小时 TTL 会以其他方式应用。覆盖 `ENABLE_PROMPT_CACHING_1H` |
| `HTTP_PROXY` | 为网络连接指定 HTTP 代理服务器 |
| `HTTPS_PROXY` | 为网络连接指定 HTTPS 代理服务器 |
| `IS_DEMO` | 设置为 `1` 以启用演示模式：隐藏标头中的电子邮件和组织名称以及 `/status` 输出，并跳过入门。对于流式传输或录制会话很有用 |
| `MAX_MCP_OUTPUT_TOKENS` | MCP 工具响应中允许的最大令牌数。Claude Code 在输出超过 10,000 个令牌时显示警告。声明 [`anthropic/maxResultSizeChars`](https://code.claude.com/zh-CN/mcp#raise-the-limit-for-a-specific-tool) 的工具对文本内容使用该字符限制，但来自这些工具的图像内容仍受此变量约束（默认值：25000） |
| `MAX_STRUCTURED_OUTPUT_RETRIES` | 当模型的响应无法针对非交互模式（`-p` 标志）中的 [`--json-schema`](https://code.claude.com/zh-CN/cli-reference#cli-flags) 进行验证时重试的次数。默认为 5 |
| `MAX_THINKING_TOKENS` | 覆盖 [扩展思考](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)令牌预算。上限是模型的 [最大输出令牌](https://platform.claude.com/docs/en/about-claude/models/overview#latest-models-comparison)减一。设置为 `0` 以完全禁用思考。在具有 [自适应推理](https://code.claude.com/zh-CN/model-config#adjust-effort-level)的模型上，除非通过 `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING` 禁用自适应推理，否则预算被忽略 |
| `MCP_CLIENT_SECRET` | 需要 [预配置凭证](https://code.claude.com/zh-CN/mcp#use-pre-configured-oauth-credentials)的 MCP 服务器的 OAuth 客户端密钥。在使用 `--client-secret` 添加服务器时避免交互式提示 |
| `MCP_CONNECTION_NONBLOCKING` | 控制启动是否等待 MCP 服务器在第一个查询之前连接。从 Claude Code v2.1.142 开始，MCP 启动默认为非阻塞：服务器在后台连接，其工具在完成时变为可用。设置为 `0` 以恢复阻塞 5 秒连接等待。配置为 [`alwaysLoad: true`](https://code.claude.com/zh-CN/mcp#exempt-a-server-from-deferral) 的服务器始终阻止启动，无论此变量如何，因为它们的工具必须在构建第一个提示时存在 |
| `MCP_CONNECT_TIMEOUT_MS` | 阻塞 MCP 启动等待连接批处理的时间（以毫秒为单位），然后快照工具列表（默认值：5000）。在截止时间处仍待处理的服务器继续在后台连接，但在下一个查询之前不会出现。与 `MCP_TIMEOUT` 不同，后者限制单个服务器的连接尝试 |
| `MCP_OAUTH_CALLBACK_PORT` | OAuth 重定向回调的固定端口，作为在使用 [预配置凭证](https://code.claude.com/zh-CN/mcp#use-pre-configured-oauth-credentials)添加 MCP 服务器时 `--callback-port` 的替代方案 |
| `MCP_REMOTE_SERVER_CONNECTION_BATCH_SIZE` | 启动期间并行连接的远程 MCP 服务器（HTTP/SSE）的最大数量（默认值：20） |
| `MCP_SERVER_CONNECTION_BATCH_SIZE` | 启动期间并行连接的本地 MCP 服务器（stdio）的最大数量（默认值：3） |
| `MCP_TIMEOUT` | MCP 服务器启动的超时（以毫秒为单位）（默认值：30000，或 30 秒） |
| `MCP_TOOL_TIMEOUT` | MCP 工具执行的超时（以毫秒为单位）（默认值：100000000，约 28 小时）。`.mcp.json` 中的每个服务器 `timeout` 字段会覆盖该服务器的此值。低于 1000 的值被限制为一秒 |
| `NO_PROXY` | 域和 IP 列表，对其的请求将直接发出，绕过代理 |
| `OTEL_LOG_RAW_API_BODIES` | 设置为 `1` 以将完整的 Anthropic Messages API 请求和响应 JSON 作为 `api_request_body` / `api_response_body` 日志事件发出，或 `file:` 以将未截断的主体写入磁盘并发出 `body_ref` 路径。默认禁用；主体包括整个对话历史。请参阅 [监控](https://code.claude.com/zh-CN/monitoring-usage#api-request-body-event) |
| `OTEL_LOG_TOOL_CONTENT` | 设置为 `1` 以在 OpenTelemetry span 事件中包含工具输入和输出内容。默认禁用以保护敏感数据。请参阅 [监控](https://code.claude.com/zh-CN/monitoring-usage) |
| `OTEL_LOG_TOOL_DETAILS` | 设置为 `1` 以在 OpenTelemetry 跟踪和日志中包含工具输入参数、MCP 服务器名称、工具失败时的原始错误字符串和其他工具详情。默认禁用以保护 PII。请参阅 [监控](https://code.claude.com/zh-CN/monitoring-usage) |
| `OTEL_LOG_USER_PROMPTS` | 设置为 `1` 以在 OpenTelemetry 跟踪和日志中包含用户提示文本。默认禁用（提示被编辑）。请参阅 [监控](https://code.claude.com/zh-CN/monitoring-usage) |
| `OTEL_METRICS_INCLUDE_ACCOUNT_UUID` | 设置为 `false` 以从指标属性中排除帐户 UUID（默认值：包含）。请参阅 [监控](https://code.claude.com/zh-CN/monitoring-usage) |
| `OTEL_METRICS_INCLUDE_SESSION_ID` | 设置为 `false` 以从指标属性中排除会话 ID（默认值：包含）。请参阅 [监控](https://code.claude.com/zh-CN/monitoring-usage) |
| `OTEL_METRICS_INCLUDE_VERSION` | 设置为 `true` 以在指标属性中包含 Claude Code 版本（默认值：排除）。请参阅 [监控](https://code.claude.com/zh-CN/monitoring-usage) |
| `SLASH_COMMAND_TOOL_CHAR_BUDGET` | 覆盖显示给 [Skill tool](https://code.claude.com/zh-CN/skills#control-who-invokes-a-skill) 的 skill 元数据的字符预算。预算在上下文窗口的 1% 处动态扩展，回退为 8,000 个字符。为了向后兼容而保留的旧名称 |
| `TASK_MAX_OUTPUT_LENGTH` | [subagent](https://code.claude.com/zh-CN/sub-agents) 输出中的最大字符数，超过此数字后将进行截断（默认值：32000，最大值：160000）。截断时，完整输出保存到磁盘，路径包含在截断的响应中 |
| `USE_BUILTIN_RIPGREP` | 设置为 `0` 以使用系统安装的 `rg` 而不是 Claude Code 附带的 `rg` |
| `VERTEX_REGION_CLAUDE_3_5_HAIKU` | 使用 Vertex AI 时覆盖 Claude 3.5 Haiku 的区域 |
| `VERTEX_REGION_CLAUDE_3_5_SONNET` | 使用 Vertex AI 时覆盖 Claude 3.5 Sonnet 的区域 |
| `VERTEX_REGION_CLAUDE_3_7_SONNET` | 使用 Vertex AI 时覆盖 Claude 3.7 Sonnet 的区域 |
| `VERTEX_REGION_CLAUDE_4_0_OPUS` | 使用 Vertex AI 时覆盖 Claude 4.0 Opus 的区域 |
| `VERTEX_REGION_CLAUDE_4_0_SONNET` | 使用 Vertex AI 时覆盖 Claude 4.0 Sonnet 的区域 |
| `VERTEX_REGION_CLAUDE_4_1_OPUS` | 使用 Vertex AI 时覆盖 Claude 4.1 Opus 的区域 |
| `VERTEX_REGION_CLAUDE_4_5_OPUS` | 使用 Vertex AI 时覆盖 Claude Opus 4.5 的区域 |
| `VERTEX_REGION_CLAUDE_4_5_SONNET` | 使用 Vertex AI 时覆盖 Claude Sonnet 4.5 的区域 |
| `VERTEX_REGION_CLAUDE_4_6_OPUS` | 使用 Vertex AI 时覆盖 Claude Opus 4.6 的区域 |
| `VERTEX_REGION_CLAUDE_4_6_SONNET` | 使用 Vertex AI 时覆盖 Claude Sonnet 4.6 的区域 |
| `VERTEX_REGION_CLAUDE_4_7_OPUS` | 使用 Vertex AI 时覆盖 Claude Opus 4.7 的区域 |
| `VERTEX_REGION_CLAUDE_HAIKU_4_5` | 使用 Vertex AI 时覆盖 Claude Haiku 4.5 的区域 |

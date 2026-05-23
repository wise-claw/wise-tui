| 键 | 描述 | 示例 |
| --- | --- | --- |
| `agent` | 将主线程作为命名 subagent 运行。应用该 subagent 的系统提示、工具限制和模型。请参阅 [显式调用 subagents](https://code.claude.com/zh-CN/sub-agents#invoke-subagents-explicitly) | `"code-reviewer"` |
| `allowedChannelPlugins` | （仅 Managed 设置）可能推送消息的频道插件的允许列表。设置后替换默认 Anthropic 允许列表。未定义 = 回退到默认值，空数组 = 阻止所有频道插件。需要 `channelsEnabled: true`。请参阅 [限制哪些频道插件可以运行](https://code.claude.com/zh-CN/channels#restrict-which-channel-plugins-can-run) | `[{ "marketplace": "claude-plugins-official", "plugin": "telegram" }]` |
| `allowedHttpHookUrls` | HTTP hooks 可能针对的 URL 模式的允许列表。支持 `*` 作为通配符。设置后，具有不匹配 URL 的 hooks 被阻止。未定义 = 无限制，空数组 = 阻止所有 HTTP hooks。数组跨设置源合并。请参阅 [Hook 配置](https://code.claude.com/docs/zh-CN/settings#hook-configuration) | `["https://hooks.example.com/*"]` |
| `allowedMcpServers` | 在 managed-settings.json 中设置时，用户可以配置的 MCP servers 的允许列表。未定义 = 无限制，空数组 = 锁定。适用于所有作用域。拒绝列表优先。请参阅 [Managed MCP 配置](https://code.claude.com/zh-CN/managed-mcp) | `[{ "serverName": "github" }]` |
| `allowManagedHooksOnly` | （仅 Managed 设置）仅加载 managed hooks、SDK hooks 和在 managed 设置 `enabledPlugins` 中强制启用的插件中的 hooks。用户、项目和所有其他插件 hooks 被阻止。请参阅 [Hook 配置](https://code.claude.com/docs/zh-CN/settings#hook-configuration) | `true` |
| `allowManagedMcpServersOnly` | （仅 Managed 设置）仅尊重来自 managed 设置的 `allowedMcpServers`。`deniedMcpServers` 仍从所有源合并。用户仍可以添加 MCP servers，但仅应用管理员定义的允许列表。请参阅 [Managed MCP 配置](https://code.claude.com/zh-CN/managed-mcp) | `true` |
| `allowManagedPermissionRulesOnly` | （仅 Managed 设置）防止用户和项目设置定义 `allow`、`ask` 或 `deny` 权限规则。仅应用 managed 设置中的规则。请参阅 [Managed 专用设置](https://code.claude.com/zh-CN/permissions#managed-only-settings) | `true` |
| `alwaysThinkingEnabled` | 为所有会话默认启用 [扩展思考](https://code.claude.com/zh-CN/model-config#extended-thinking)。通常通过 `/config` 命令而不是直接编辑来配置。要强制禁用思考，无论此设置如何，请在 `env` 中设置 [`CLAUDE_CODE_DISABLE_THINKING`](https://code.claude.com/zh-CN/env-vars) | `true` |
| `apiKeyHelper` | 自定义脚本，在 `/bin/sh` 中执行，以生成身份验证值。此值将作为 `X-Api-Key` 和 `Authorization: Bearer` 标头发送用于模型请求。使用 [`CLAUDE_CODE_API_KEY_HELPER_TTL_MS`](https://code.claude.com/zh-CN/env-vars) 设置刷新间隔 | `/bin/generate_temp_api_key.sh` |
| `attribution` | 自定义 git 提交和拉取请求的归属。请参阅 [归属设置](https://code.claude.com/docs/zh-CN/settings#attribution-settings) | `{"commit": "🤖 Generated with Claude Code", "pr": ""}` |
| `autoMemoryDirectory` | [自动内存](https://code.claude.com/zh-CN/memory#storage-location)存储的自定义目录。接受绝对路径或 `~/` 前缀的路径。从策略和用户设置以及 `--settings` 标志接受。不从项目或本地设置接受，因为克隆的存储库可能提供任一文件以将内存写入重定向到敏感位置 | `"~/my-memory-dir"` |
| `autoMemoryEnabled` | 启用 [自动内存](https://code.claude.com/zh-CN/memory#enable-or-disable-auto-memory)。当为 `false` 时，Claude 不从自动内存目录读取或写入。默认：`true`。您也可以在会话期间使用 `/memory` 切换此选项。要通过环境变量禁用，请在 `env` 中设置 [`CLAUDE_CODE_DISABLE_AUTO_MEMORY`](https://code.claude.com/zh-CN/env-vars) | `false` |
| `autoMode` | 自定义 [自动模式](https://code.claude.com/zh-CN/permission-modes#eliminate-prompts-with-auto-mode)分类器阻止和允许的内容。包含 `environment`、`allow`、`soft_deny` 和 `hard_deny` 散文规则数组。在数组中包含字面字符串 `"$defaults"` 以在该位置继承内置规则。请参阅 [配置自动模式](https://code.claude.com/zh-CN/auto-mode-config)。不从共享项目设置读取 | `{"soft_deny": ["$defaults", "Never run terraform apply"]}` |
| `autoScrollEnabled` | 在 [全屏渲染](https://code.claude.com/zh-CN/fullscreen)中，跟随新输出到对话的底部。默认：`true`。在 `/config` 中显示为自动滚动。权限提示仍在此关闭时滚动到视图中 | `false` |
| `autoUpdatesChannel` | 遵循更新的发布渠道。使用 `"stable"` 获取通常约一周前的版本并跳过有主要回归的版本，或使用 `"latest"`（默认）获取最新版本。要完全禁用自动更新，请在 `env` 中设置 [`DISABLE_AUTOUPDATER`](https://code.claude.com/zh-CN/setup#disable-auto-updates) | `"stable"` |
| `availableModels` | 限制用户可以通过 `/model`、`--model` 或 `ANTHROPIC_MODEL` 选择的模型。不影响默认选项。请参阅 [限制模型选择](https://code.claude.com/zh-CN/model-config#restrict-model-selection) | `["sonnet", "haiku"]` |
| `awaySummaryEnabled` | 在您离开终端几分钟后返回时显示单行会话回顾。设置为 `false` 或在 `/config` 中关闭会话回顾以禁用。与 [`CLAUDE_CODE_ENABLE_AWAY_SUMMARY`](https://code.claude.com/zh-CN/env-vars) 相同 | `true` |
| `awsAuthRefresh` | 修改 `.aws` 目录的自定义脚本（请参阅 [高级凭证配置](https://code.claude.com/zh-CN/amazon-bedrock#advanced-credential-configuration)） | `aws sso login --profile myprofile` |
| `awsCredentialExport` | 输出包含 AWS 凭证的 JSON 的自定义脚本（请参阅 [高级凭证配置](https://code.claude.com/zh-CN/amazon-bedrock#advanced-credential-configuration)） | `/bin/generate_aws_grant.sh` |
| `blockedMarketplaces` | （仅 Managed 设置）市场源的阻止列表。在市场添加和插件安装、更新、刷新和自动更新时强制执行，因此在设置策略之前添加的市场无法用于获取插件。被阻止的源在下载前被检查，因此它们永远不会接触文件系统。请参阅 [Managed 市场限制](https://code.claude.com/zh-CN/plugin-marketplaces#managed-marketplace-restrictions) | `[{ "source": "github", "repo": "untrusted/plugins" }]` |
| `channelsEnabled` | （仅 Managed 设置）为组织允许 [channels](https://code.claude.com/zh-CN/channels)。在 claude.ai Team 和 Enterprise 计划上，当此项未设置或为 `false` 时，channels 被阻止。对于使用 API 密钥身份验证的 [Anthropic Console](https://code.claude.com/zh-CN/authentication#claude-console-authentication) 账户，channels 默认被允许，除非您的组织部署 managed 设置，在这种情况下此键必须设置为 `true` | `true` |
| `claudeMd` | （仅 Managed 设置）CLAUDE.md 风格的说明，作为组织管理的内存注入。仅在 managed 或策略设置中设置时被尊重，在用户、项目和本地设置中被忽略。请参阅 [组织范围的 CLAUDE.md](https://code.claude.com/zh-CN/memory#deploy-organization-wide-claude-md) | `"Always run make lint before committing."` |
| `claudeMdExcludes` | 加载 [内存](https://code.claude.com/zh-CN/memory)时要跳过的 `CLAUDE.md` 文件的 Glob 模式或绝对路径。模式与绝对文件路径匹配。仅适用于用户、项目和本地内存；managed 策略文件无法被排除 | `["**/vendor/**/CLAUDE.md"]` |
| `cleanupPeriodDays` | 非活跃时间超过此期间的会话在启动时被删除（默认：30 天，最少 1 天）。设置为 `0` 会被拒绝并显示验证错误。也控制 [孤立 subagent worktrees](https://code.claude.com/zh-CN/worktrees#clean-up-worktrees) 在启动时自动删除的年龄截止。要完全禁用记录写入，请设置 [`CLAUDE_CODE_SKIP_PROMPT_HISTORY`](https://code.claude.com/zh-CN/env-vars) 环境变量，或在非交互模式（`-p`）中使用 `--no-session-persistence` 标志或 `persistSession: false` SDK 选项。 | `20` |
| `companyAnnouncements` | 在启动时显示给用户的公告。如果提供多个公告，它们将随机循环显示。 | `["Welcome to Acme Corp! Review our code guidelines at docs.acme.com"]` |
| `defaultShell` | 输入框 `!` 命令的默认 shell。接受 `"bash"`（默认）或 `"powershell"`。设置 `"powershell"` 会在 Windows 上通过 PowerShell 路由交互式 `!` 命令。需要 `CLAUDE_CODE_USE_POWERSHELL_TOOL=1`。请参阅 [PowerShell tool](https://code.claude.com/zh-CN/tools-reference#powershell-tool) | `"powershell"` |
| `deniedMcpServers` | 在 managed-settings.json 中设置时，明确阻止的 MCP servers 的拒绝列表。适用于所有作用域，包括 managed servers。拒绝列表优先于允许列表。请参阅 [Managed MCP 配置](https://code.claude.com/zh-CN/managed-mcp) | `[{ "serverName": "filesystem" }]` |
| `disableAgentView` | 设置为 `true` 以关闭 [后台代理和代理视图](https://code.claude.com/zh-CN/agent-view)：`claude agents`、`--bg`、`/background` 和按需主管。通常在 [managed 设置](https://code.claude.com/zh-CN/permissions#managed-settings)中设置。等同于将 `CLAUDE_CODE_DISABLE_AGENT_VIEW` 设置为 `1` | `true` |
| `disableAllHooks` | 禁用所有 [hooks](https://code.claude.com/zh-CN/hooks) 和任何自定义 [状态行](https://code.claude.com/zh-CN/statusline) | `true` |
| `disableAutoMode` | 设置为 `"disable"` 以防止 [自动模式](https://code.claude.com/zh-CN/permission-modes#eliminate-prompts-with-auto-mode)被激活。从 `Shift+Tab` 循环中删除 `auto` 并在启动时拒绝 `--permission-mode auto`。在 [managed 设置](https://code.claude.com/zh-CN/permissions#managed-settings)中最有用，用户无法覆盖它 | `"disable"` |
| `disableDeepLinkRegistration` | 设置为 `"disable"` 以防止 Claude Code 在启动时向操作系统注册 `claude-cli://` 协议处理程序。 [深链接](https://code.claude.com/zh-CN/deep-links)让外部工具通过预填充的提示打开 Claude Code 会话。在协议处理程序注册受限或单独管理的环境中很有用 | `"disable"` |
| `disabledMcpjsonServers` | 要拒绝的 `.mcp.json` 文件中特定 MCP servers 的列表 | `["filesystem"]` |
| `disableRemoteControl` | {/* min-version: 2.1.128 */}禁用 [远程控制](https://code.claude.com/zh-CN/remote-control)：阻止 `claude remote-control`、`--remote-control` 标志、自动启动和会话内切换。通常放在 [managed 设置](https://code.claude.com/zh-CN/permissions#managed-settings)中用于每设备 MDM 强制执行，但适用于任何作用域。需要 Claude Code v2.1.128 或更高版本 | `true` |
| `disableSkillShellExecution` | 禁用 [skills](https://code.claude.com/zh-CN/skills) 和来自用户、项目、插件或额外目录源的自定义命令中的 `!`...`` 和 ````!` 块的内联 shell 执行。命令被替换为 `[shell command execution disabled by policy]` 而不是被运行。捆绑和 managed skills 不受影响。在 [managed 设置](https://code.claude.com/zh-CN/permissions#managed-settings)中最有用，用户无法覆盖它 | `true` |
| `editorMode` | 输入提示的快捷键模式：`"normal"` 或 `"vim"`。默认：`"normal"`。在 `/config` 中显示为快捷键模式 | `"vim"` |
| `effortLevel` | 跨会话持久化 [努力级别](https://code.claude.com/zh-CN/model-config#adjust-effort-level)。接受 `"low"`、`"medium"`、`"high"` 或 `"xhigh"`。当您运行 `/effort` 时自动写入，带有这些值之一。`--effort` 和 [`CLAUDE_CODE_EFFORT_LEVEL`](https://code.claude.com/zh-CN/env-vars) 覆盖此用于一个会话。请参阅 [调整努力级别](https://code.claude.com/zh-CN/model-config#adjust-effort-level)了解支持的模型 | `"xhigh"` |
| `enableAllProjectMcpServers` | 自动批准项目 `.mcp.json` 文件中定义的所有 MCP servers | `true` |
| `enabledMcpjsonServers` | 要批准的 `.mcp.json` 文件中特定 MCP servers 的列表 | `["memory", "github"]` |
| `env` | 应用于每个会话和 Claude Code 从其生成的子进程的环境变量。{/* min-version: 2.1.143 */}从 v2.1.143 开始，此处设置的 `NO_COLOR` 和 `FORCE_COLOR` 被传递到子进程，但不改变 Claude Code 自己的界面颜色。在启动 `claude` 前在您的 shell 中设置这些以改变界面颜色 | `{"FOO": "bar"}` |
| `fastModePerSessionOptIn` | 当为 `true` 时，快速模式不会跨会话持久化。每个会话都以快速模式关闭开始，需要用户使用 `/fast` 启用它。用户的快速模式偏好仍被保存。请参阅 [需要每个会话的选择加入](https://code.claude.com/zh-CN/fast-mode#require-per-session-opt-in) | `true` |
| `feedbackSurveyRate` | 概率（0–1） [会话质量调查](https://code.claude.com/zh-CN/data-usage#session-quality-surveys)在符合条件时出现。设置为 `0` 以完全抑制，或在 `env` 中设置 [`CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY`](https://code.claude.com/zh-CN/env-vars)。在使用 Bedrock、Vertex 或 Foundry 时很有用，其中默认采样率不适用 | `0.05` |
| `fileSuggestion` | 为 `@` 文件自动完成配置自定义脚本。请参阅 [文件建议设置](https://code.claude.com/docs/zh-CN/settings#file-suggestion-settings) | `{"type": "command", "command": "~/.claude/file-suggestion.sh"}` |
| `forceLoginMethod` | 使用 `claudeai` 限制登录到 Claude.ai 账户，`console` 限制登录到 Claude Console（API 使用计费）账户。在 managed 设置中设置时，由 API 密钥、`apiKeyHelper` 或第三方提供商进行身份验证的会话在启动时被阻止，因为两个值都无法在没有第一方 OAuth 的情况下满足 | `claudeai` |
| `forceLoginOrgUUID` | 要求登录属于特定组织。接受单个 UUID 字符串（也在登录期间预选该组织）或 UUID 数组，其中任何列出的组织都被接受而无需预选。在 managed 设置中设置时，如果经过身份验证的账户不属于列出的组织，登录失败；由 API 密钥、`apiKeyHelper` 或第三方提供商进行身份验证的会话在启动时被阻止，因为无法为它们验证组织成员身份。空数组失败关闭并使用配置错误消息阻止登录 | `"xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"` 或 `["xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy"]` |
| `forceRemoteSettingsRefresh` | （仅 Managed 设置）阻止 CLI 启动，直到从服务器新鲜获取远程 managed 设置。如果获取失败，CLI 退出而不是继续使用缓存或无设置。未设置时，启动继续而不等待远程设置。请参阅 [失败关闭强制执行](https://code.claude.com/zh-CN/server-managed-settings#enforce-fail-closed-startup) | `true` |
| `gcpAuthRefresh` | 当 GCP Application Default Credentials 过期或无法加载时刷新它们的自定义脚本。请参阅 [高级凭证配置](https://code.claude.com/zh-CN/google-vertex-ai#advanced-credential-configuration) | `gcloud auth application-default login` |
| `hooks` | 配置自定义命令以在生命周期事件处运行。请参阅 [hooks 文档](https://code.claude.com/zh-CN/hooks) 了解格式 | 请参阅 [hooks](https://code.claude.com/zh-CN/hooks) |
| `httpHookAllowedEnvVars` | HTTP hooks 可能插入到标头中的环境变量名称的允许列表。设置后，每个 hook 的有效 `allowedEnvVars` 是与此列表的交集。未定义 = 无限制。数组跨设置源合并。请参阅 [Hook 配置](https://code.claude.com/docs/zh-CN/settings#hook-configuration) | `["MY_TOKEN", "HOOK_SECRET"]` |
| `includeCoAuthoredBy` | 已弃用：改用 `attribution`。是否在 git 提交和拉取请求中包含 `co-authored-by Claude` 署名（默认：`true`） | `false` |
| `includeGitInstructions` | 在 Claude 的系统提示中包含内置提交和 PR 工作流说明和 git 状态快照（默认：`true`）。设置为 `false` 以删除这两者，例如在使用您自己的 git 工作流 skills 时。`CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS` 环境变量在设置时优先于此设置 | `false` |
| `language` | 配置 Claude 的首选响应语言（例如 `"japanese"`、`"spanish"`、`"french"`）。Claude 将默认以此语言响应。也设置 [语音听写](https://code.claude.com/zh-CN/voice-dictation#change-the-dictation-language)语言 | `"japanese"` |
| `maxSkillDescriptionChars` | {/* min-version: 2.1.105 */} [skill 列表](https://code.claude.com/zh-CN/skills#skill-descriptions-are-cut-short)中每个 skill 的 `description` 和 `when_to_use` 文本组合的字符上限（默认：`1536`）。超过此长度的文本被截断。提高以保持长描述完整，代价是每轮更多上下文；降低以在 [`skillListingBudgetFraction`](https://code.claude.com/docs/zh-CN/settings#available-settings) 下适应更多 skills。需要 Claude Code v2.1.105 或更高版本 | `2048` |
| `minimumVersion` | 防止后台自动更新和 `claude update` 安装低于此版本的版本。从 `"latest"` 渠道切换到 `"stable"` 时通过 `/config` 提示您保持在当前版本或允许降级。选择保持设置此值。也在 [managed 设置](https://code.claude.com/zh-CN/permissions#managed-settings)中有用，以固定组织范围的最低版本 | `"2.1.100"` |
| `model` | 覆盖用于 Claude Code 的默认模型。`--model` 和 [`ANTHROPIC_MODEL`](https://code.claude.com/zh-CN/model-config#environment-variables) 覆盖此用于一个会话 | `"claude-sonnet-4-6"` |
| `modelOverrides` | 将 Anthropic 模型 ID 映射到特定于提供商的模型 ID，例如 Bedrock 推理配置文件 ARN。每个模型选择器条目在调用提供商 API 时使用其映射值。请参阅 [按版本覆盖模型 ID](https://code.claude.com/zh-CN/model-config#override-model-ids-per-version) | `{"claude-opus-4-6": "arn:aws:bedrock:..."}` |
| `otelHeadersHelper` | 生成动态 OpenTelemetry 标头的脚本。在启动时和定期运行。使用 [`CLAUDE_CODE_OTEL_HEADERS_HELPER_DEBOUNCE_MS`](https://code.claude.com/zh-CN/env-vars) 设置刷新间隔。请参阅 [动态标头](https://code.claude.com/zh-CN/monitoring-usage#dynamic-headers) | `/bin/generate_otel_headers.sh` |
| `outputStyle` | 配置输出样式以调整系统提示。请参阅 [输出样式文档](https://code.claude.com/zh-CN/output-styles) | `"Explanatory"` |
| `parentSettingsBehavior` | {/* min-version: 2.1.133 */}（仅 Managed 设置）控制由嵌入主机进程（例如 Agent SDK 或 IDE 扩展）以编程方式提供的 managed 设置在同时存在管理员部署的 managed 层时是否应用。`"first-wins"`：父级提供的设置被丢弃，仅应用管理员层。`"merge"`：父级提供的设置在管理员层下应用，经过筛选以便它们可以收紧策略但不能放松策略。当未部署管理员层时无效。默认：`"first-wins"`。需要 Claude Code v2.1.133 或更高版本 | `"merge"` |
| `permissions` | 请参阅下表了解权限的结构。 | |
| `plansDirectory` | 自定义 Plan Mode 文件的存储位置。路径相对于项目根目录。默认：`~/.claude/plans` | `"./plans"` |
| `pluginTrustMessage` | （仅 Managed 设置）在安装前显示的插件信任警告中附加的自定义消息。使用此添加组织特定的上下文，例如确认来自您内部市场的插件已获批准。 | `"All plugins from our marketplace are approved by IT"` |
| `policyHelper` | {/* min-version: 2.1.136 */}管理员部署的可执行文件，在启动时动态计算 managed 设置。仅从 MDM 或系统 `managed-settings.json` 文件受尊重。请参阅 [使用策略助手计算 managed 设置](https://code.claude.com/docs/zh-CN/settings#compute-managed-settings-with-a-policy-helper)。需要 Claude Code v2.1.136 或更高版本 | `{"path": "/usr/local/bin/claude-policy"}` |
| `preferredNotifChannel` | 任务完成和权限提示通知的方法：`"auto"`、`"terminal_bell"`、`"iterm2"`、`"iterm2_with_bell"`、`"kitty"`、`"ghostty"` 或 `"notifications_disabled"`。默认：`"auto"`，在 iTerm2、Ghostty 和 Kitty 中发送桌面通知，在其他终端中不执行任何操作。设置 `"terminal_bell"` 以在任何终端中响铃。在 `/config` 中显示为通知。请参阅 [获取终端铃声或通知](https://code.claude.com/zh-CN/terminal-config#get-a-terminal-bell-or-notification) | `"terminal_bell"` |
| `prefersReducedMotion` | 减少或禁用 UI 动画（微调器、闪烁、闪光效果）以实现可访问性 | `true` |
| `prUrlTemplate` | PR 徽章的 URL 模板，显示在页脚和工具结果摘要中。替换来自 `gh` 报告的 PR URL 中的 `{host}`、`{owner}`、`{repo}`、`{number}` 和 `{url}`。使用指向内部代码审查工具而不是 `github.com` 的 PR 链接。不影响 Claude 散文中的 `#123` 自动链接 | `"https://reviews.example.com/{owner}/{repo}/pull/{number}"` |
| `respectGitignore` | 控制 `@` 文件选择器是否尊重 `.gitignore` 模式。当为 `true`（默认）时，匹配 `.gitignore` 模式的文件被排除在建议之外 | `false` |
| `showClearContextOnPlanAccept` | 在 Plan Mode 接受屏幕上显示"清除上下文"选项。默认为 `false`。设置为 `true` 以恢复该选项 | `true` |
| `showThinkingSummaries` | 在交互式会话中显示 [扩展思考](https://code.claude.com/zh-CN/model-config#extended-thinking)摘要。未设置或 `false`（交互模式中的默认值）时，思考块由 API 编辑并显示为折叠的存根。编辑仅改变您看到的内容，而不是模型生成的内容：要减少思考支出， [降低预算或禁用思考](https://code.claude.com/zh-CN/model-config#extended-thinking)。此设置在非交互模式（`-p`）、Agent SDK 或 IDE 扩展（如 VS Code）中无效 | `true` |
| `showTurnDuration` | 在响应后显示轮次持续时间消息，例如"Cooked for 1m 6s"。默认：`true`。在 `/config` 中显示为显示轮次持续时间 | `false` |
| `skillListingBudgetFraction` | {/* min-version: 2.1.105 */}为 [skill 列表](https://code.claude.com/zh-CN/skills#skill-descriptions-are-cut-short)预留的模型上下文窗口的分数，Claude 每轮看到（默认：`0.01` = 1%）。当列表超过预算时，最少使用的 skills 的描述被折叠为仅名称，以便 Claude 仍可以调用它们但不会看到原因。提高以保持更多描述可见，代价是每轮更多上下文。`/doctor` 显示当前截断计数和受影响的 skills。需要 Claude Code v2.1.105 或更高版本 | `0.02` |
| `skillOverrides` | {/* min-version: 2.1.129 */}按 skill 名称键入的每个 skill 可见性覆盖。值为 `"on"`、`"name-only"`、`"user-invocable-only"` 或 `"off"`。让您隐藏或折叠 skill 而无需编辑其 SKILL.md。不适用于插件 skills，这些通过 `/plugin` 管理。`/skills` 菜单将这些写入 `.claude/settings.local.json`。请参阅 [从设置覆盖 skill 可见性](https://code.claude.com/zh-CN/skills#override-skill-visibility-from-settings)。需要 Claude Code v2.1.129 或更高版本 | `{"legacy-context": "name-only", "deploy": "off"}` |
| `skipWebFetchPreflight` | 跳过 [WebFetch 域安全检查](https://code.claude.com/zh-CN/data-usage#webfetch-domain-safety-check)，该检查在获取前将每个请求的主机名发送到 `api.anthropic.com`。在阻止到 Anthropic 的流量的环境中设置为 `true`，例如 Bedrock、Vertex AI 或 Foundry 部署，具有限制性出站。跳过时，WebFetch 尝试任何 URL 而不咨询阻止列表 | `true` |
| `spinnerTipsEnabled` | 在 Claude 工作时在微调器中显示提示。设置为 `false` 以禁用提示（默认：`true`） | `false` |
| `spinnerTipsOverride` | 使用自定义字符串覆盖微调器提示。`tips`：提示字符串数组。`excludeDefault`：如果为 `true`，仅显示自定义提示；如果为 `false` 或不存在，自定义提示与内置提示合并 | `{ "excludeDefault": true, "tips": ["Use our internal tool X"] }` |
| `spinnerVerbs` | 自定义在微调器和轮次持续时间消息中显示的操作动词。将 `mode` 设置为 `"replace"` 以仅使用您的动词，或 `"append"` 以将它们添加到默认值 | `{"mode": "append", "verbs": ["Pondering", "Crafting"]}` |
| `sshConfigs` | 要在 [桌面](https://code.claude.com/zh-CN/desktop#pre-configure-ssh-connections-for-your-team)环境下拉菜单中显示的 SSH 连接。每个条目需要 `id`、`name` 和 `sshHost`；`sshPort`、`sshIdentityFile` 和 `startDirectory` 是可选的。在 managed 设置中设置时，连接对用户是只读的。仅从 managed 和用户设置读取 | `[{"id": "dev-vm", "name": "Dev VM", "sshHost": "user@dev.example.com"}]` |
| `statusLine` | 配置自定义状态行以显示上下文。请参阅 [`statusLine` 文档](https://code.claude.com/zh-CN/statusline) | `{"type": "command", "command": "~/.claude/statusline.sh"}` |
| `strictKnownMarketplaces` | （仅 Managed 设置）插件市场源的允许列表。未定义 = 无限制，空数组 = 锁定。在市场添加和插件安装、更新、刷新和自动更新时强制执行，因此在设置策略之前添加的市场无法用于获取插件。请参阅 [Managed 市场限制](https://code.claude.com/zh-CN/plugin-marketplaces#managed-marketplace-restrictions) | `[{ "source": "github", "repo": "acme-corp/plugins" }]` |
| `strictPluginOnlyCustomization` | （仅 Managed 设置）阻止 skills、agents、hooks 和 MCP servers 来自用户和项目源，因此它们只能来自插件或 managed 设置。`true` 锁定所有四个表面；数组仅锁定命名的表面。请参阅 [`strictPluginOnlyCustomization`](https://code.claude.com/docs/zh-CN/settings#strictpluginonlycustomization) | `["skills", "hooks"]` |
| `syntaxHighlightingDisabled` | 禁用 diffs、代码块和文件预览中的语法高亮 | `true` |
| `teammateMode` | [agent team](https://code.claude.com/zh-CN/agent-teams) 队友的显示方式：`auto`（在 tmux 或 iTerm2 中选择分割窗格，否则进程内）、`in-process` 或 `tmux`。`--teammate-mode` 覆盖此用于一个会话。请参阅 [选择显示模式](https://code.claude.com/zh-CN/agent-teams#choose-a-display-mode) | `"in-process"` |
| `terminalProgressBarEnabled` | 在支持的终端中显示终端进度条：ConEmu、Ghostty 1.2.0+ 和 iTerm2 3.6.6+。默认：`true`。在 `/config` 中显示为终端进度条 | `false` |
| `tui` | 终端 UI 渲染器。使用 `"fullscreen"` 获取无闪烁的 [替代屏幕渲染器](https://code.claude.com/zh-CN/fullscreen)，具有虚拟化滚动条。使用 `"default"` 获取经典主屏幕渲染器。通过 `/tui` 设置。您也可以设置 [`CLAUDE_CODE_NO_FLICKER`](https://code.claude.com/zh-CN/env-vars) 环境变量 | `"fullscreen"` |
| `useAutoModeDuringPlan` | Plan Mode 在自动模式可用时是否使用自动模式语义。默认：`true`。不从共享项目设置读取。在 `/config` 中显示为"在计划期间使用自动模式" | `false` |
| `viewMode` | 启动时的默认记录视图模式：`"default"`、`"verbose"` 或 `"focus"`。设置时覆盖粘性 `/focus` 选择。`--verbose` 标志覆盖此用于一个会话 | `"verbose"` |
| `voice` | [语音听写](https://code.claude.com/zh-CN/voice-dictation)设置：`enabled` 打开听写，`mode` 选择 `"hold"` 或 `"tap"`，`autoSubmit` 在保持模式下按键释放时发送提示。当您运行 `/voice` 时自动写入。需要 Claude.ai 账户 | `{ "enabled": true, "mode": "tap" }` |
| `voiceEnabled` | `voice.enabled` 的旧别名。优先使用 `voice` 对象 | `true` |
| `wslInheritsWindowsSettings` | （仅 Windows managed 设置）当为 `true` 时，WSL 上的 Claude Code 除了 `/etc/claude-code` 外还从 Windows 策略链读取 managed 设置，Windows 源优先。仅在 HKLM 注册表项或 `C:\Program Files\ClaudeCode\managed-settings.json` 中设置时被尊重，两者都需要 Windows 管理员权限才能写入。为了让 HKCU 策略也在 WSL 上应用，该标志还必须在 HKCU 本身中设置。对本机 Windows 无效 | `true` |

| 键 | 描述 | 示例 |
| --- | --- | --- |
| `worktree.baseRef` | 新 worktrees 分支的参考。`"fresh"`（默认）从 `origin/ ` 分支以获得与远程匹配的干净树。`"head"` 从您当前的本地 `HEAD` 分支，因此未推送的提交和特性分支状态存在于 worktree 中。适用于 `--worktree`、`EnterWorktree` 工具和 subagent 隔离 | `"head"` |
| `worktree.symlinkDirectories` | 要从主存储库符号链接到每个 worktree 的目录，以避免在磁盘上复制大型目录。默认情况下不符号链接任何目录 | `["node_modules", ".cache"]` |
| `worktree.sparsePaths` | 通过 git sparse-checkout 在每个 worktree 中检出的目录。仅将列出的目录加上根级文件写入磁盘，在大型 monorepos 中更快 | `["packages/my-app", "shared/utils"]` |
| `worktree.bgIsolation` | {/* min-version: 2.1.143 */} [后台会话](https://code.claude.com/zh-CN/agent-view#how-file-edits-are-isolated)的隔离模式。`"worktree"`（默认）在调用 `EnterWorktree` 之前阻止主检出中的 `Edit`/`Write`。`"none"` 让后台作业直接编辑工作副本。需要 Claude Code v2.1.143 或更高版本 | `"none"` |

| 键 | 描述 | 示例 |
| --- | --- | --- |
| `allow` | 允许工具使用的权限规则数组。请参阅下面的 [权限规则语法](https://code.claude.com/docs/zh-CN/settings#permission-rule-syntax)了解模式匹配详情 | `[ "Bash(git diff *)" ]` |
| `ask` | 在工具使用时要求确认的权限规则数组。请参阅下面的 [权限规则语法](https://code.claude.com/docs/zh-CN/settings#permission-rule-syntax) | `[ "Bash(git push *)" ]` |
| `deny` | 拒绝工具使用的权限规则数组。使用此排除敏感文件不被 Claude Code 访问。请参阅 [权限规则语法](https://code.claude.com/docs/zh-CN/settings#permission-rule-syntax)和 [Bash 权限限制](https://code.claude.com/zh-CN/permissions#tool-specific-permission-rules) | `[ "WebFetch", "Bash(curl *)", "Read(./.env)", "Read(./secrets/**)" ]` |
| `additionalDirectories` | Claude 有权访问的额外 [工作目录](https://code.claude.com/zh-CN/permissions#working-directories)。大多数 `.claude/` 配置 [未从这些目录发现](https://code.claude.com/zh-CN/permissions#additional-directories-grant-file-access-not-configuration) | `[ "../docs/" ]` |
| `defaultMode` | 打开 Claude Code 时的默认 [权限模式](https://code.claude.com/zh-CN/permission-modes)。有效值：`default`、`acceptEdits`、`plan`、`auto`、`dontAsk`、`bypassPermissions`。{/* min-version: 2.1.142 */}从 Claude Code v2.1.142 开始，当在项目或本地设置（`.claude/settings.json`、`.claude/settings.local.json`）中设置时，`auto` 被忽略，因此存储库无法授予自己自动模式。改为在 `~/.claude/settings.json` 中设置它。`--permission-mode` CLI 标志覆盖此设置用于单个会话 | `"acceptEdits"` |
| `disableBypassPermissionsMode` | 设置为 `"disable"` 以防止激活 `bypassPermissions` 模式。禁用 `--dangerously-skip-permissions` 标志。在 [managed 设置](https://code.claude.com/zh-CN/permissions#managed-settings)中最有用，用户无法覆盖它 | `"disable"` |
| `skipDangerousModePermissionPrompt` | 跳过通过 `--dangerously-skip-permissions` 或 `defaultMode: "bypassPermissions"` 进入 bypass permissions 模式前显示的确认提示。在项目设置（`.claude/settings.json`）中设置时被忽略，以防止不受信任的存储库自动绕过提示 | `true` |

### 权限规则语法

权限规则遵循 `Tool` 或 `Tool(specifier)` 的格式。规则按顺序评估：首先是拒绝规则，然后是询问，最后是允许。第一个匹配的规则获胜。

快速示例：

| 规则 | 效果 |
| --- | --- |
| `Bash` | 匹配所有 Bash 命令 |
| `Bash(npm run *)` | 匹配以 `npm run` 开头的命令 |
| `Read(./.env)` | 匹配读取 `.env` 文件 |
| `WebFetch(domain:example.com)` | 匹配对 example.com 的获取请求 |

有关完整的规则语法参考，包括通配符行为、Read、Edit、WebFetch、MCP 和 Agent 规则的工具特定模式，以及 Bash 模式的安全限制，请参阅 [权限规则语法](https://code.claude.com/zh-CN/permissions#permission-rule-syntax)。

### Sandbox 设置

配置高级 sandboxing 行为。Sandboxing 将 bash 命令与您的文件系统和网络隔离。请参阅 [Sandboxing](https://code.claude.com/zh-CN/sandboxing) 了解详情。

| 键 | 描述 | 示例 |
| --- | --- | --- |
| `enabled` | 启用 bash sandboxing（macOS、Linux 和 WSL2）。默认：false | `true` |
| `failIfUnavailable` | 如果 `sandbox.enabled` 为 true 但 sandbox 无法启动（缺少依赖项或不支持的平台），则在启动时以错误退出。当为 false（默认）时，显示警告，命令无 sandbox 运行。用于需要 sandboxing 作为硬门的 managed 设置部署 | `true` |
| `autoAllowBashIfSandboxed` | 当 sandboxed 时自动批准 bash 命令。默认：true | `true` |
| `excludedCommands` | 应在 sandbox 外运行的命令 | `["docker *"]` |
| `allowUnsandboxedCommands` | 允许命令通过 `dangerouslyDisableSandbox` 参数在 sandbox 外运行。当设置为 `false` 时，`dangerouslyDisableSandbox` 逃生舱口完全禁用，所有命令必须 sandboxed（或在 `excludedCommands` 中）。对于需要严格 sandboxing 的企业策略很有用。默认：true | `false` |
| `filesystem.allowWrite` | sandboxed 命令可以写入的额外路径。数组跨所有设置作用域合并：用户、项目和 managed 路径组合，不替换。也与 `Edit(...)` 允许权限规则中的路径合并。请参阅下面的 [路径前缀](https://code.claude.com/docs/zh-CN/settings#sandbox-path-prefixes)。 | `["/tmp/build", "~/.kube"]` |
| `filesystem.denyWrite` | sandboxed 命令无法写入的路径。数组跨所有设置作用域合并。也与 `Edit(...)` 拒绝权限规则中的路径合并。 | `["/etc", "/usr/local/bin"]` |
| `filesystem.denyRead` | sandboxed 命令无法读取的路径。数组跨所有设置作用域合并。也与 `Read(...)` 拒绝权限规则中的路径合并。 | `["~/.aws/credentials"]` |
| `filesystem.allowRead` | 在 `denyRead` 区域内重新允许读取的路径。优先于 `denyRead`。数组跨所有设置作用域合并。使用此创建仅工作区读取访问模式。 | `["."]` |
| `filesystem.allowManagedReadPathsOnly` | （仅 Managed 设置）仅尊重来自 managed 设置的 `filesystem.allowRead` 路径。`denyRead` 仍从所有源合并。默认：false | `true` |
| `network.allowUnixSockets` | （仅 macOS）sandbox 中可访问的 Unix socket 路径。在 Linux 和 WSL2 上被忽略，其中 seccomp 过滤器无法检查 socket 路径；改用 `allowAllUnixSockets`。 | `["~/.ssh/agent-socket"]` |
| `network.allowAllUnixSockets` | 允许 sandbox 中的所有 Unix socket 连接。在 Linux 和 WSL2 上这是允许 Unix sockets 的唯一方式，因为它跳过了 seccomp 过滤器，否则会阻止 `socket(AF_UNIX, ...)` 调用。默认：false | `true` |
| `network.allowLocalBinding` | 允许绑定到 localhost 端口（仅 macOS）。默认：false | `true` |
| `network.allowMachLookup` | sandbox 可能查找的额外 XPC/Mach 服务名称（仅 macOS）。支持单个尾部 `*` 用于前缀匹配。对于通过 XPC 通信的工具（如 iOS 模拟器或 Playwright）是必需的。 | `["com.apple.coresimulator.*"]` |
| `network.allowedDomains` | 允许出站网络流量的域数组。支持通配符（例如 `*.example.com`）。 | `["github.com", "*.npmjs.org"]` |
| `network.deniedDomains` | 阻止出站网络流量的域数组。支持与 `allowedDomains` 相同的通配符语法。当两者都匹配时优先于 `allowedDomains`。无论 `allowManagedDomainsOnly` 如何，都从所有设置源合并。 | `["sensitive.cloud.example.com"]` |
| `network.allowManagedDomainsOnly` | （仅 Managed 设置）仅尊重来自 managed 设置的 `allowedDomains` 和 `WebFetch(domain:...)` 允许规则。来自用户、项目和本地设置的域被忽略。非允许的域自动被阻止，不提示用户。拒绝的域仍从所有源受尊重。默认：false | `true` |
| `network.httpProxyPort` | 如果您想自带代理，使用的 HTTP 代理端口。如果未指定，Claude 将运行自己的代理。 | `8080` |
| `network.socksProxyPort` | 如果您想自带代理，使用的 SOCKS5 代理端口。如果未指定，Claude 将运行自己的代理。 | `8081` |
| `enableWeakerNestedSandbox` | 为无特权 Docker 环境启用较弱的 sandbox（仅 Linux 和 WSL2）。降低安全性。 默认：false | `true` |
| `enableWeakerNetworkIsolation` | （仅 macOS）允许在 sandbox 中访问系统 TLS 信任服务（`com.apple.trustd.agent`）。对于 Go 基础工具（如 `gh`、`gcloud` 和 `terraform`）在使用 `httpProxyPort` 与 MITM 代理和自定义 CA 时验证 TLS 证书是必需的。通过打开潜在的数据泄露路径降低安全性。默认：false | `true` |
| `bwrapPath` | （仅 Managed 设置，Linux/WSL2）bubblewrap (`bwrap`) 二进制文件的绝对路径。覆盖通过 `PATH` 的自动检测。仅从 [managed 设置](https://code.claude.com/zh-CN/settings#settings-precedence)受尊重，不从用户或项目设置。在 managed 环境中 `bwrap` 安装在非标准位置时很有用。 | `/opt/admin/bwrap` |
| `socatPath` | （仅 Managed 设置，Linux/WSL2）用于 sandbox 网络代理的 `socat` 二进制文件的绝对路径。覆盖通过 `PATH` 的自动检测。仅从 managed 设置受尊重。 | `/opt/admin/socat` |

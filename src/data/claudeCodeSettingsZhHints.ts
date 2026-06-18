/**
 * Claude Code settings.json 中文提示（摘自官方文档「可用设置」「插件配置」）。
 * @see https://code.claude.com/docs/zh-CN/settings
 */

export interface ClaudeSettingsZhHint {
  detail: string;
  documentation?: string;
}

/** 顶层键的中文说明；未列出的键仍由 JSON Schema 提供英文描述与结构补全。 */
export const CLAUDE_SETTINGS_ZH_HINTS: Record<string, ClaudeSettingsZhHint> = {
  $schema: {
    detail: "JSON Schema 地址",
    documentation:
      "例如 https://json.schemastore.org/claude-code-settings.json，用于编辑器校验与补全。",
  },
  enabledPlugins: {
    detail: "启用的插件",
    documentation:
      '格式："plugin-name@marketplace-name": true/false。用户/项目/本地作用域可分别配置。',
  },
  extraKnownMarketplaces: {
    detail: "额外插件市场",
    documentation:
      "为团队提供额外市场源（github / git / directory / hostPattern / settings 等）。",
  },
  strictKnownMarketplaces: {
    detail: "允许的市场列表（仅 Managed）",
    documentation: "管理员限制用户可添加的插件市场；undefined=无限制，[]=完全锁定。",
  },
  blockedMarketplaces: {
    detail: "阻止的市场列表（仅 Managed）",
    documentation: "阻止指定市场源被添加或用于安装插件。",
  },
  pluginTrustMessage: {
    detail: "插件信任提示附加文案（仅 Managed）",
  },
  strictPluginOnlyCustomization: {
    detail: "仅允许插件/Managed 定制（仅 Managed）",
    documentation: "阻止用户/项目的 skills、agents、hooks、MCP 等非插件来源。",
  },
  env: {
    detail: "环境变量",
    documentation:
      "应用于每个会话及子进程；可配置 ANTHROPIC_MODEL、ANTHROPIC_BASE_URL 等。",
  },
  model: {
    detail: "默认模型",
    documentation: '覆盖 Claude Code 默认模型，例如 "claude-sonnet-4-6"。',
  },
  permissions: {
    detail: "权限规则",
    documentation: "allow / ask / deny 等工具权限；详见权限规则语法。",
  },
  hooks: {
    detail: "生命周期 Hooks",
  },
  statusLine: {
    detail: "自定义状态行",
    documentation: '例如 { "type": "command", "command": "~/.claude/statusline.sh" }',
  },
  companyAnnouncements: {
    detail: "启动公告",
  },
  attribution: {
    detail: "Git 提交/PR 归属",
  },
  alwaysThinkingEnabled: {
    detail: "默认启用扩展思考",
  },
  availableModels: {
    detail: "限制可选模型列表",
  },
  autoMemoryEnabled: {
    detail: "自动记忆：Claude 跨会话写入 ~/.claude/projects/<project>/memory/",
  },
  autoMode: {
    detail: "自动模式分类器规则",
  },
  cleanupPeriodDays: {
    detail: "会话清理天数",
  },
  defaultShell: {
    detail: "! 命令默认 Shell",
  },
  disableAllHooks: {
    detail: "禁用所有 Hooks",
  },
  editorMode: {
    detail: "输入快捷键模式",
    documentation: '"normal" 或 "vim"。',
  },
  effortLevel: {
    detail: "努力级别",
    documentation: '"low" | "medium" | "high" | "xhigh"。',
  },
  language: {
    detail: "回复语言",
  },
  outputStyle: {
    detail: "输出风格",
  },
  plansDirectory: {
    detail: "Plan Mode 文件目录",
  },
  preferredNotifChannel: {
    detail: "通知渠道",
  },
  sandbox: {
    detail: "Bash Sandbox 配置",
  },
  showThinkingSummaries: {
    detail: "显示思考摘要",
  },
  spinnerTipsEnabled: {
    detail: "微调器提示",
  },
  teammateMode: {
    detail: "Agent Team 显示模式",
  },
  tui: {
    detail: "终端 UI 渲染器",
    documentation: '"fullscreen" 或 "default"。',
  },
  viewMode: {
    detail: "默认记录视图",
  },
  voice: {
    detail: "语音听写",
  },
  worktree: {
    detail: "Git Worktree 配置",
  },
  anthropic_attribution_header: {
    detail: "Anthropic 归属标头",
  },
};

/** Curated Claude Code plugins for one-click install in Wise (≈56 mainstream entries). */

export type ClaudePluginMarketCategory =
  | "featured"
  | "workflow"
  | "superpowers"
  | "integration"
  | "lsp";

export interface ClaudePluginCatalogEntry {
  pluginId: string;
  marketplace: string;
  /** Display name (Chinese or well-known English). */
  name: string;
  description: string;
  category: ClaudePluginMarketCategory;
  featured?: boolean;
  /** 默认 true；为 false 时卡片展示安装说明而非调用 claude plugin install。 */
  oneClickInstall?: boolean;
  /** 无一键安装时打开的文档（可选）。 */
  installGuideUrl?: string;
}

export function claudePluginInstallRef(entry: ClaudePluginCatalogEntry): string {
  return `${entry.pluginId}@${entry.marketplace}`;
}

/** 精选市场置顶顺序（其余保持目录原序）。 */
export const CLAUDE_PLUGIN_PINNED_INSTALL_REFS: readonly string[] = [
  "oh-my-claudecode@omc",
  "trellis@wise-guide",
  "trellis-harness@mindfold-trellis",
  "gsd@gsd-plugin",
] as const;

export function sortClaudePluginCatalogEntries(
  entries: readonly ClaudePluginCatalogEntry[],
): ClaudePluginCatalogEntry[] {
  const pinIndex = new Map(CLAUDE_PLUGIN_PINNED_INSTALL_REFS.map((ref, i) => [ref, i]));
  return [...entries].sort((a, b) => {
    const ai = pinIndex.get(claudePluginInstallRef(a)) ?? Number.MAX_SAFE_INTEGER;
    const bi = pinIndex.get(claudePluginInstallRef(b)) ?? Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return 0;
  });
}

export const CLAUDE_PLUGIN_MARKET_CATALOG: readonly ClaudePluginCatalogEntry[] = [
  {
    pluginId: "oh-my-claudecode",
    marketplace: "omc",
    name: "Oh My ClaudeCode",
    description: "多智能体编排、团队委派与自然语言工作流（OMC）",
    category: "featured",
    featured: true,
  },
  {
    pluginId: "trellis",
    marketplace: "wise-guide",
    name: "Trellis（Wise 初始化）",
    description:
      "在 Wise 项目侧栏使用「Trellis 初始化」写入 .trellis/；或 npm i -g @mindfoldhq/trellis 后在仓库根目录 trellis init",
    category: "featured",
    featured: true,
    oneClickInstall: false,
    installGuideUrl: "https://docs.trytrellis.app/start/install-and-first-task",
  },
  {
    pluginId: "trellis-harness",
    marketplace: "mindfold-trellis",
    name: "Trellis Harness",
    description:
      "Mindfold 官方 AI 编程约束框架（github.com/mindfold-ai/Trellis）：规范注入、任务 PRD、多平台命令与团队工作流",
    category: "featured",
    featured: true,
    oneClickInstall: false,
    installGuideUrl: "https://github.com/mindfold-ai/Trellis",
  },
  {
    pluginId: "gsd",
    marketplace: "gsd-plugin",
    name: "GSD2",
    description:
      "Get Shit Done 2.x：结构化规划、分阶段执行与 MCP 项目状态（/gsd:* 命令，需 jnuyens/gsd-plugin 市场）",
    category: "featured",
    featured: true,
  },
  {
    pluginId: "code-review",
    marketplace: "claude-code-plugins",
    name: "Code Review",
    description: "多 Agent 并行 PR 代码审查，置信度过滤误报",
    category: "workflow",
    featured: true,
  },
  {
    pluginId: "feature-dev",
    marketplace: "claude-code-plugins",
    name: "Feature Dev",
    description: "七阶段功能开发：探索、架构、实现与验收",
    category: "workflow",
    featured: true,
  },
  {
    pluginId: "pr-review-toolkit",
    marketplace: "claude-code-plugins",
    name: "PR Review Toolkit",
    description: "评论、测试、错误处理、类型与代码质量专项审查",
    category: "workflow",
    featured: true,
  },
  {
    pluginId: "commit-commands",
    marketplace: "claude-code-plugins",
    name: "Commit Commands",
    description: "提交、推送与创建 PR 的 Git 工作流命令",
    category: "workflow",
  },
  {
    pluginId: "plugin-dev",
    marketplace: "claude-code-plugins",
    name: "Plugin Dev",
    description: "插件开发工具包：命令、Hook、MCP 与技能脚手架",
    category: "workflow",
  },
  {
    pluginId: "hookify",
    marketplace: "claude-code-plugins",
    name: "Hookify",
    description: "从对话模式生成自定义 Hook，约束 Claude 行为",
    category: "workflow",
  },
  {
    pluginId: "security-guidance",
    marketplace: "claude-code-plugins",
    name: "Security Guidance",
    description: "编辑文件时检测注入、XSS、eval 等安全风险",
    category: "workflow",
  },
  {
    pluginId: "frontend-design",
    marketplace: "claude-code-plugins",
    name: "Frontend Design",
    description: "避免千篇一律的 AI 审美，产出有辨识度的前端界面",
    category: "workflow",
  },
  {
    pluginId: "agent-sdk-dev",
    marketplace: "claude-code-plugins",
    name: "Agent SDK Dev",
    description: "Claude Agent SDK 项目初始化与最佳实践校验",
    category: "workflow",
  },
  {
    pluginId: "claude-opus-4-5-migration",
    marketplace: "claude-code-plugins",
    name: "Opus 4.5 Migration",
    description: "从 Sonnet 4.x / Opus 4.1 迁移模型与提示词",
    category: "workflow",
  },
  {
    pluginId: "explanatory-output-style",
    marketplace: "claude-code-plugins",
    name: "Explanatory Style",
    description: "会话开始时注入实现选择与代码库模式说明",
    category: "workflow",
  },
  {
    pluginId: "learning-output-style",
    marketplace: "claude-code-plugins",
    name: "Learning Style",
    description: "交互式学习模式，在决策点引导你写关键代码",
    category: "workflow",
  },
  {
    pluginId: "ralph-wiggum",
    marketplace: "claude-code-plugins",
    name: "Ralph Wiggum",
    description: "自指迭代循环，直到任务完成为止持续工作",
    category: "workflow",
  },
  {
    pluginId: "superpowers",
    marketplace: "superpowers-marketplace",
    name: "Superpowers",
    description: "TDD、调试、协作与「先理解再动手」工作流技能集",
    category: "superpowers",
    featured: true,
  },
  {
    pluginId: "superpowers-chrome",
    marketplace: "superpowers-marketplace",
    name: "Superpowers Chrome",
    description: "浏览器自动化与前端验证相关的 Superpowers 扩展",
    category: "superpowers",
  },
  {
    pluginId: "elements-of-style",
    marketplace: "superpowers-marketplace",
    name: "Elements of Style",
    description: "技术写作与文档风格（Strunk 式简洁表达）",
    category: "superpowers",
  },
  {
    pluginId: "episodic-memory",
    marketplace: "superpowers-marketplace",
    name: "Episodic Memory",
    description: "跨会话情景记忆与上下文延续",
    category: "superpowers",
  },
  {
    pluginId: "superpowers-lab",
    marketplace: "superpowers-marketplace",
    name: "Superpowers Lab",
    description: "实验性技能与社区工作流预览",
    category: "superpowers",
  },
  {
    pluginId: "superpowers-developing-for-claude-code",
    marketplace: "superpowers-marketplace",
    name: "Developing for Claude Code",
    description: "为 Claude Code 扩展与插件开发提供的技能",
    category: "superpowers",
  },
  {
    pluginId: "superpowers-dev",
    marketplace: "superpowers-marketplace",
    name: "Superpowers Dev",
    description: "面向插件与技能作者的开发辅助",
    category: "superpowers",
  },
  {
    pluginId: "claude-session-driver",
    marketplace: "superpowers-marketplace",
    name: "Session Driver",
    description: "结构化驱动长会话与阶段检查点",
    category: "superpowers",
  },
  {
    pluginId: "double-shot-latte",
    marketplace: "superpowers-marketplace",
    name: "Double Shot Latte",
    description: "加速多步骤任务编排的轻量工作流",
    category: "superpowers",
  },
  {
    pluginId: "github",
    marketplace: "claude-plugins-official",
    name: "GitHub",
    description: "Issues、PR 与仓库操作的官方集成",
    category: "integration",
    featured: true,
  },
  {
    pluginId: "gitlab",
    marketplace: "claude-plugins-official",
    name: "GitLab",
    description: "GitLab 合并请求与 CI 集成",
    category: "integration",
  },
  {
    pluginId: "atlassian",
    marketplace: "claude-plugins-official",
    name: "Atlassian",
    description: "Jira、Confluence 与 Atlassian 云产品",
    category: "integration",
  },
  {
    pluginId: "linear",
    marketplace: "claude-plugins-official",
    name: "Linear",
    description: "Linear 议题与周期规划",
    category: "integration",
  },
  {
    pluginId: "notion",
    marketplace: "claude-plugins-official",
    name: "Notion",
    description: "Notion 页面与数据库读写",
    category: "integration",
  },
  {
    pluginId: "figma",
    marketplace: "claude-plugins-official",
    name: "Figma",
    description: "设计稿、组件与 Dev Mode 上下文",
    category: "integration",
  },
  {
    pluginId: "vercel",
    marketplace: "claude-plugins-official",
    name: "Vercel",
    description: "部署、预览与环境变量管理",
    category: "integration",
  },
  {
    pluginId: "slack",
    marketplace: "claude-plugins-official",
    name: "Slack",
    description: "频道消息与通知工作流",
    category: "integration",
  },
  {
    pluginId: "sentry",
    marketplace: "claude-plugins-official",
    name: "Sentry",
    description: "错误追踪与性能问题排查",
    category: "integration",
  },
  {
    pluginId: "supabase",
    marketplace: "claude-plugins-official",
    name: "Supabase",
    description: "数据库、Auth 与 Edge Functions",
    category: "integration",
  },
  {
    pluginId: "firebase",
    marketplace: "claude-plugins-official",
    name: "Firebase",
    description: "Firebase 项目与托管资源",
    category: "integration",
  },
  {
    pluginId: "asana",
    marketplace: "claude-plugins-official",
    name: "Asana",
    description: "任务与项目跟踪",
    category: "integration",
  },
  {
    pluginId: "airtable",
    marketplace: "claude-plugins-official",
    name: "Airtable",
    description: "表格与自动化基座",
    category: "integration",
  },
  {
    pluginId: "amplitude",
    marketplace: "claude-plugins-official",
    name: "Amplitude",
    description: "产品分析与实验数据",
    category: "integration",
  },
  {
    pluginId: "chrome-devtools-mcp",
    marketplace: "claude-plugins-official",
    name: "Chrome DevTools MCP",
    description: "通过 DevTools 协议调试浏览器页面",
    category: "integration",
  },
  {
    pluginId: "auth0",
    marketplace: "claude-plugins-official",
    name: "Auth0",
    description: "身份认证与租户配置",
    category: "integration",
  },
  {
    pluginId: "aws-core",
    marketplace: "claude-plugins-official",
    name: "AWS Core",
    description: "常用 AWS 服务与资源操作",
    category: "integration",
  },
  {
    pluginId: "azure",
    marketplace: "claude-plugins-official",
    name: "Azure",
    description: "Azure 资源与部署上下文",
    category: "integration",
  },
  {
    pluginId: "box",
    marketplace: "claude-plugins-official",
    name: "Box",
    description: "企业文件存储与协作",
    category: "integration",
  },
  {
    pluginId: "buildkite",
    marketplace: "claude-plugins-official",
    name: "Buildkite",
    description: "CI 流水线与构建状态",
    category: "integration",
  },
  {
    pluginId: "typescript-lsp",
    marketplace: "claude-plugins-official",
    name: "TypeScript LSP",
    description: "TypeScript / JavaScript 语言服务",
    category: "lsp",
  },
  {
    pluginId: "pyright-lsp",
    marketplace: "claude-plugins-official",
    name: "Pyright LSP",
    description: "Python 类型检查与语言服务",
    category: "lsp",
  },
  {
    pluginId: "rust-analyzer-lsp",
    marketplace: "claude-plugins-official",
    name: "Rust Analyzer",
    description: "Rust 语言服务与诊断",
    category: "lsp",
  },
  {
    pluginId: "gopls-lsp",
    marketplace: "claude-plugins-official",
    name: "gopls",
    description: "Go 语言服务",
    category: "lsp",
  },
  {
    pluginId: "clangd-lsp",
    marketplace: "claude-plugins-official",
    name: "clangd",
    description: "C / C++ 语言服务",
    category: "lsp",
  },
  {
    pluginId: "csharp-lsp",
    marketplace: "claude-plugins-official",
    name: "C# LSP",
    description: ".NET / C# 语言服务",
    category: "lsp",
  },
  {
    pluginId: "jdtls-lsp",
    marketplace: "claude-plugins-official",
    name: "Java LSP",
    description: "Java（Eclipse JDT）语言服务",
    category: "lsp",
  },
  {
    pluginId: "kotlin-lsp",
    marketplace: "claude-plugins-official",
    name: "Kotlin LSP",
    description: "Kotlin 语言服务",
    category: "lsp",
  },
  {
    pluginId: "php-lsp",
    marketplace: "claude-plugins-official",
    name: "PHP LSP",
    description: "PHP 语言服务",
    category: "lsp",
  },
  {
    pluginId: "lua-lsp",
    marketplace: "claude-plugins-official",
    name: "Lua LSP",
    description: "Lua 语言服务",
    category: "lsp",
  },
] as const;

export const CLAUDE_PLUGIN_CATEGORY_LABELS: Record<ClaudePluginMarketCategory | "all", string> = {
  all: "全部",
  featured: "精选",
  workflow: "开发工作流",
  superpowers: "Superpowers",
  integration: "官方集成",
  lsp: "语言服务",
};

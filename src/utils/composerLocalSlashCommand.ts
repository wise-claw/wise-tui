import type { ClaudePluginInstallScope } from "../services/claudePluginMarket";
import {
  CLAUDE_PLUGIN_MARKET_CATALOG,
  claudePluginInstallRef,
} from "../constants/claudePluginMarketCatalog";
import { splitLeadingAtMentionPrefix } from "./composerDefaultInstruction";

export type ComposerPluginSlashAction =
  | "install"
  | "uninstall"
  | "list"
  | "enable"
  | "disable"
  | "marketplace_add"
  | "marketplace_update"
  | "cli";

export interface ComposerPluginSlashCommand {
  action: ComposerPluginSlashAction;
  installRef?: string;
  scope: ClaudePluginInstallScope;
  /** marketplace add 的市场源（GitHub repo 或 URL） */
  marketplaceSource?: string;
  /** action === "cli" 时：`plugin` 之后的子命令参数 */
  cliArgs?: string[];
}

export type ComposerLocalSlashKind =
  | "plugin"
  | "compact"
  | "clear"
  | "mcp"
  | "skills"
  | "doctor"
  | "help"
  | "config"
  | "reload_plugins"
  | "reload_skills"
  | "context"
  | "hooks"
  | "agents"
  | "status"
  | "models"
  | "ultracode"
  | "redirect";

export interface ComposerLocalSlashCommand {
  kind: ComposerLocalSlashKind;
  /** 原始用户输入（compact 等需保留完整文本） */
  raw: string;
  plugin?: ComposerPluginSlashCommand;
  /** kind === "redirect" 时展示给用户的说明 */
  redirectMessage?: string;
  /** kind === "context" 时是否展开分类明细 */
  contextDetailed?: boolean;
  /**
   * kind === "ultracode" 时的 follow-up 语义：
   * - `undefined` / `null` → 纯 toggle（无附言）
   * - `""` → 显式关闭（`/ultracode off`）
   * - 其它字符串 → 启用 ultracode 并作为 prompt 投递（`/ultracode <text>`）
   */
  ultracodePrompt?: string | null;
}

const PLUGIN_SLASH_RE = /^\/plugin(?:\s+(.+))?$/i;
const COMPACT_SLASH_RE = /^\/compact(?:\s+(.+))?$/i;
const CONTEXT_SLASH_RE = /^\/context(?:\s+(all))?$/i;
const CLEAR_ALIASES = new Set(["clear", "reset", "new"]);
const CONFIG_ALIASES = new Set(["config", "settings"]);

const PLUGIN_VERB_ALIASES: Record<string, ComposerPluginSlashAction> = {
  install: "install",
  i: "install",
  uninstall: "uninstall",
  remove: "uninstall",
  enable: "enable",
  disable: "disable",
  list: "list",
};

export const COMPOSER_PLUGIN_SUBCOMMAND_HELP =
  "Wise 会话内支持的 /plugin 子命令：install（i）、uninstall（remove）、enable、disable、list。\n" +
  "示例：/plugin install oh-my-claudecode@omc --scope user\n" +
  "完整插件市场：创作 → 插件市场。";

export const COMPOSER_MCP_SUBCOMMAND_HELP =
  "交互式 /mcp 在嵌入式会话中不可用。\n" +
  "本会话可用：/mcp 或 /mcp list 查看配置。\n" +
  "添加/编辑 MCP：创作 → MCP，或 Claude Code 工具面板。";

const TUI_SLASH_REDIRECTS: ReadonlyArray<{ test: (text: string) => boolean; message: string }> = [
  {
    test: (t) => /^\/agents\b/i.test(t),
    message:
      "交互式 /agents 在嵌入式会话中不可用。\n" +
      "本会话可用：/agents list 查看子代理配置。\n" +
      "运行中子代理与团队：侧栏「我的团队」与 Inspector。",
  },
  {
    test: (t) => /^\/permissions\b/i.test(t) || /^\/allowed-tools\b/i.test(t),
    message:
      "交互式 /permissions 在嵌入式会话中不可用。\n" +
      "请在 Wise「默认配置」→ Claude 权限与工具规则中管理 allow/ask/deny。",
  },
  {
    test: (t) => /^\/memory\b/i.test(t),
    message:
      "交互式 /memory 在嵌入式会话中不可用。\n" +
      "请直接编辑仓库或用户级 CLAUDE.md / 自动记忆配置。",
  },
  {
    test: (t) => /^\/login\b/i.test(t) || /^\/logout\b/i.test(t),
    message:
      "交互式登录/登出在嵌入式会话中不可用。\n" +
      "请在系统终端运行 claude login / claude logout，或在 Wise「默认配置」中检查 Claude 连接。",
  },
  {
    test: (t) => /^\/diff\b/i.test(t) || /^\/review\b/i.test(t),
    message:
      "交互式 diff/review 在嵌入式会话中不可用。\n" +
      "请使用 Wise 侧栏 Git 面板查看改动，或发送自然语言请求代码审查。",
  },
  {
    test: (t) => /^\/resume\b/i.test(t) || /^\/continue\b/i.test(t),
    message:
      "交互式 /resume 选择器在嵌入式会话中不可用。\n" +
      "请使用会话标签栏、历史会话弹窗或监控抽屉恢复历史会话。",
  },
];

function parseScopeToken(raw: string | undefined): ClaudePluginInstallScope | null {
  const value = raw?.trim().toLowerCase();
  if (!value || value === "user") return "user";
  if (value === "project") return "project";
  if (value === "local") return "local";
  return null;
}

export function parseComposerPluginSlashCommand(text: string): ComposerPluginSlashCommand | null {
  const trimmed = text.trim();
  const match = trimmed.match(PLUGIN_SLASH_RE);
  if (!match) return null;

  const rest = (match[1] ?? "").trim();
  if (!rest || rest.toLowerCase() === "list") {
    return { action: "list", scope: "user" };
  }

  const tokens = rest.split(/\s+/).filter(Boolean);
  const verb = tokens[0]?.toLowerCase() ?? "";

  if (verb === "marketplace") {
    const sub = tokens[1]?.toLowerCase() ?? "";
    if (sub === "add") {
      const source = tokens.slice(2).join(" ").trim();
      if (!source) return null;
      return { action: "marketplace_add", scope: "user", marketplaceSource: source };
    }
    if (sub === "update") {
      return { action: "marketplace_update", scope: "user" };
    }
    return { action: "cli", scope: "user", cliArgs: tokens };
  }

  const action = PLUGIN_VERB_ALIASES[verb];
  if (action && action !== "list") {
    let scope: ClaudePluginInstallScope = "user";
    let installRef = "";
    for (let i = 1; i < tokens.length; i += 1) {
      const token = tokens[i];
      if (token === "--scope") {
        const next = tokens[i + 1];
        const parsed = parseScopeToken(next);
        if (!parsed) return null;
        scope = parsed;
        i += 1;
        continue;
      }
      if (!installRef) {
        installRef = token;
      }
    }
    if (!installRef) return null;
    return {
      action,
      installRef,
      scope,
    };
  }

  return { action: "cli", scope: "user", cliArgs: tokens };
}

/** 将 `oh-my-claudecode` 等简写解析为 `plugin@marketplace`。 */
export function resolveComposerPluginInstallRef(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("插件标识为空");
  }
  if (trimmed.includes("@")) {
    return trimmed;
  }

  const lower = trimmed.toLowerCase();
  const catalogHit =
    CLAUDE_PLUGIN_MARKET_CATALOG.find(
      (entry) =>
        entry.pluginId === trimmed ||
        entry.pluginId.toLowerCase() === lower ||
        entry.name.toLowerCase() === lower,
    ) ?? null;
  if (catalogHit) {
    return claudePluginInstallRef(catalogHit);
  }

  throw new Error(
    `未找到插件「${trimmed}」。请使用 plugin@marketplace 格式，例如 oh-my-claudecode@omc`,
  );
}

export function isComposerLocalSlashEligible(input: {
  text: string;
  imageCount?: number;
  contextCount?: number;
  codeSelectionRefCount?: number;
}): boolean {
  if ((input.imageCount ?? 0) > 0) return false;
  if ((input.contextCount ?? 0) > 0) return false;
  if ((input.codeSelectionRefCount ?? 0) > 0) return false;
  return parseComposerLocalSlashCommand(input.text.trim()) != null;
}

function redirectCommand(raw: string, redirectMessage: string): ComposerLocalSlashCommand {
  return { kind: "redirect", raw, redirectMessage };
}

/**
 * 解析 Wise 本地处理的斜杠命令（嵌入式会话中 Claude Code TUI 不可用者）。
 * 要求整行仅为一条 `/command`（可带参数），与 Claude Code 会话内 slash 语义一致。
 */
export function parseComposerLocalSlashCommand(text: string): ComposerLocalSlashCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;

  if (/^\/plugin\b/i.test(trimmed)) {
    const plugin = parseComposerPluginSlashCommand(trimmed);
    if (plugin) {
      return { kind: "plugin", raw: trimmed, plugin };
    }
    return null;
  }

  if (COMPACT_SLASH_RE.test(trimmed)) {
    return { kind: "compact", raw: trimmed };
  }

  const contextMatch = trimmed.match(CONTEXT_SLASH_RE);
  if (contextMatch) {
    return {
      kind: "context",
      raw: trimmed,
      contextDetailed: (contextMatch[1] ?? "").toLowerCase() === "all",
    };
  }

  const head = trimmed.slice(1).split(/\s+/)[0]?.toLowerCase() ?? "";
  if (CLEAR_ALIASES.has(head) && trimmed === `/${head}`) {
    return { kind: "clear", raw: trimmed };
  }

  if (/^\/mcp\b/i.test(trimmed)) {
    if (trimmed === "/mcp" || /^\/mcp\s+list$/i.test(trimmed)) {
      return { kind: "mcp", raw: trimmed };
    }
    return redirectCommand(trimmed, COMPOSER_MCP_SUBCOMMAND_HELP);
  }

  if (head === "skills" && trimmed === "/skills") {
    return { kind: "skills", raw: trimmed };
  }

  if (head === "doctor" && trimmed === "/doctor") {
    return { kind: "doctor", raw: trimmed };
  }

  if (head === "help" && trimmed === "/help") {
    return { kind: "help", raw: trimmed };
  }

  if (CONFIG_ALIASES.has(head) && trimmed === `/${head}`) {
    return { kind: "config", raw: trimmed };
  }

  if (head === "reload-plugins" && trimmed === "/reload-plugins") {
    return { kind: "reload_plugins", raw: trimmed };
  }

  if (head === "reload-skills" && trimmed === "/reload-skills") {
    return { kind: "reload_skills", raw: trimmed };
  }

  if (head === "hooks" && (trimmed === "/hooks" || /^\/hooks\s+list$/i.test(trimmed))) {
    return { kind: "hooks", raw: trimmed };
  }

  if (head === "agents" && (trimmed === "/agents" || /^\/agents\s+list$/i.test(trimmed))) {
    return { kind: "agents", raw: trimmed };
  }

  if (head === "status" && trimmed === "/status") {
    return { kind: "status", raw: trimmed };
  }

  if ((head === "model" || head === "models") && trimmed === `/${head}`) {
    return { kind: "models", raw: trimmed };
  }

  // `/ultracode` 与 `/ultracode off` 与 `/ultracode <text>`。
  // 解析规则（与 OMC 关键字语义一致）：
  //   `/ultracode`             → ultracodePrompt = undefined（纯 toggle）
  //   `/ultracode off`         → ultracodePrompt = ""     （显式关闭）
  //   `/ultracode <其它文本>`   → ultracodePrompt = 文本  （启用并把文本作为 prompt 投递）
  // typo（如 `/ultracodex`）不会匹配，进入原生 slash 兜底。
  if (head === "ultracode") {
    const after = trimmed.replace(/^\/ultracode\s*/i, "");
    if (after === "") {
      return { kind: "ultracode", raw: trimmed, ultracodePrompt: null };
    }
    if (/^off\b/i.test(after)) {
      return { kind: "ultracode", raw: trimmed, ultracodePrompt: "" };
    }
    return { kind: "ultracode", raw: trimmed, ultracodePrompt: after };
  }

  for (const entry of TUI_SLASH_REDIRECTS) {
    if (entry.test(trimmed)) {
      return redirectCommand(trimmed, entry.message);
    }
  }

  return null;
}

/** 应交给 Claude Code CLI 原生斜杠处理器（非 Wise 本地拦截）的整行命令。 */
export function isClaudeNativeSlashCommandText(text: string): boolean {
  const target = claudeNativeSlashCommandBody(text);
  if (!target) return false;
  return parseComposerLocalSlashCommand(target) == null;
}

/** 提取应发给 Claude CLI 的斜杠命令行（去掉 @ 前缀、只保留首行）。 */
export function extractClaudeNativeSlashCommandForOutbound(text: string): string | null {
  const target = claudeNativeSlashCommandBody(text);
  if (!target || parseComposerLocalSlashCommand(target) != null) return null;
  const firstLine = target.split(/\r?\n/, 1)[0]?.trim() ?? "";
  return firstLine || null;
}

/** 发往 invoke 前规范化原生斜杠 prompt（与终端输入一致）。 */
export function normalizeClaudeNativeSlashPrompt(text: string): string {
  return extractClaudeNativeSlashCommandForOutbound(text) ?? text.trim();
}

function claudeNativeSlashCommandBody(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const { mentionPrefix, body } = splitLeadingAtMentionPrefix(trimmed);
  const target = mentionPrefix ? body : trimmed;
  if (!target.startsWith("/")) return null;
  return target;
}

export const COMPOSER_LOCAL_SLASH_HELP = [
  "Wise 会话内可由本地处理的斜杠命令：",
  "• /plugin install|uninstall|enable|disable|list <插件> [--scope user|project|local]",
  "• /plugin marketplace add <源> — 添加插件市场（直接执行并显示 CLI 输出）",
  "• /plugin marketplace update — 刷新市场缓存",
  "• /compact [聚焦说明] — 压缩会话历史",
  "• /clear、/reset、/new — 新建空白会话标签",
  "• /context、/context all — 上下文占用（Wise 估算）",
  "• /mcp、/mcp list — MCP 配置与连接状态",
  "• /skills — 用户级与项目级 Skills",
  "• /hooks list — Hook 配置摘要",
  "• /agents list — 子代理配置列表",
  "• /status — 当前会话运行状态",
  "• /doctor — 运行 claude doctor 诊断",
  "• /reload-plugins — 刷新插件市场缓存",
  "• /reload-skills — 重新扫描 Skills 目录",
  "• /model、/models — 打开模型切换面板",
  "• /ultracode — 切换当前会话的 ultracode 模式（per-session override 优先于全局）",
  "  /ultracode off         关闭本会话的 ultracode",
  "  /ultracode <文本>     启用 ultracode 并把文本作为 prompt 发送",
  "• /config、/settings — Wise 配置入口说明",
  "• /help — 显示本帮助",
  "",
  "交互式 TUI 命令（如 /permissions、/resume）会显示 Wise 替代指引，而不会发给 Claude。",
  "完整插件市场：创作 → 插件市场；MCP/Skills：创作 → 对应 Hub。",
].join("\n");

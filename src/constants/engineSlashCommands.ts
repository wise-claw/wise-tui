import type { SessionExecutionEngine } from "./sessionExecutionEngine";
import {
  CLAUDE_BUILTIN_SLASH_COMMANDS,
  type ClaudeBuiltinSlashCommand,
} from "./claudeCodeSlashCommands";

/** 各执行引擎内置 `/` 命令条目（与 Claude 目录同形，便于补全复用）。 */
export type EngineBuiltinSlashCommand = ClaudeBuiltinSlashCommand;

export type EngineSlashCatalogGroup = "claude" | "codex" | "cursor" | "opencode";

/**
 * Codex CLI / App-Server 常用斜杠命令（嵌入式会话可展示子集）。
 * 参考：https://developers.openai.com/codex/cli/slash-commands
 */
export const CODEX_BUILTIN_SLASH_COMMANDS: readonly EngineBuiltinSlashCommand[] = [
  { label: "clear", description: "清空上下文并开新对话（Wise：新建标签）" },
  { label: "compact", description: "压缩可见对话以释放上下文（TUI；嵌入式请新建会话或总结）" },
  { label: "diff", description: "查看工作区 Git diff（含未跟踪文件）" },
  { label: "fork", description: "分叉当前对话到新线程" },
  { label: "init", description: "在当前目录生成 AGENTS.md" },
  { label: "mcp", description: "列出已配置 MCP 工具" },
  { label: "model", description: "切换模型与推理强度（Wise：打开模型面板）" },
  { label: "new", description: "在同一会话内开新对话（Wise：新建标签）" },
  { label: "plan", description: "进入规划模式，可附带任务描述" },
  { label: "review", description: "审查工作区改动（Codex RPC 可走 review/start）" },
  { label: "skills", description: "浏览与使用 Skills" },
  { label: "status", description: "查看会话配置与 token 用量" },
  { label: "usage", description: "查看账号用量与额度" },
] as const;

/**
 * Cursor Agent（ACP/TUI）常用斜杠命令。
 * ACP 后端不执行多数 TUI 斜杠；Wise 侧对 clear/model 等做本地映射。
 */
export const CURSOR_BUILTIN_SLASH_COMMANDS: readonly EngineBuiltinSlashCommand[] = [
  { label: "add-dir", description: "添加本会话可访问的工作目录" },
  { label: "ask", description: "切换到 Ask（只读问答）模式" },
  { label: "auto-review", description: "开启自动审查（Smart Auto）" },
  { label: "clear", description: "清空上下文并开新对话（Wise：新建标签）" },
  { label: "compact", description: "压缩会话上下文（别名 /compress /summarize）" },
  { label: "compress", description: "压缩会话上下文（/compact 别名）" },
  { label: "context", description: "查看上下文占用" },
  { label: "fork", description: "分叉当前对话" },
  { label: "model", description: "切换模型（Wise：打开模型面板）" },
  { label: "plan", description: "切换到 Plan 模式" },
  { label: "summarize", description: "压缩会话上下文（/compact 别名）" },
] as const;

/**
 * OpenCode TUI 内置斜杠命令。
 * 参考：https://opencode.ai/docs/tui
 */
export const OPENCODE_BUILTIN_SLASH_COMMANDS: readonly EngineBuiltinSlashCommand[] = [
  { label: "clear", description: "新建会话（/new 别名；Wise：新建标签）" },
  { label: "compact", description: "压缩当前会话（别名 /summarize）" },
  { label: "details", description: "切换工具执行详情显示" },
  { label: "export", description: "导出对话为 Markdown" },
  { label: "help", description: "显示帮助" },
  { label: "init", description: "引导生成 AGENTS.md" },
  { label: "models", description: "列出/选择模型（Wise：打开模型面板）" },
  { label: "new", description: "新建会话（Wise：新建标签）" },
  { label: "sessions", description: "列出/切换会话（别名 /resume /continue）" },
  { label: "share", description: "生成公开分享链接" },
  { label: "summarize", description: "压缩当前会话（/compact 别名）" },
  { label: "thinking", description: "切换推理块可见性" },
  { label: "undo", description: "撤销上一轮并回滚文件" },
] as const;

const EMPTY_QUERY_HINTS: Record<EngineSlashCatalogGroup, ReadonlySet<string>> = {
  claude: new Set([
    "add-dir",
    "agents",
    "background",
    "branch",
    "btw",
    "clear",
    "code-review",
    "compact",
    "config",
    "context",
    "diff",
    "doctor",
    "help",
    "mcp",
    "model",
    "plugin",
    "resume",
    "review",
    "skills",
  ]),
  codex: new Set([
    "clear",
    "compact",
    "diff",
    "init",
    "mcp",
    "model",
    "new",
    "plan",
    "review",
    "skills",
    "status",
  ]),
  cursor: new Set([
    "ask",
    "clear",
    "compact",
    "compress",
    "model",
    "plan",
    "summarize",
  ]),
  opencode: new Set([
    "clear",
    "compact",
    "help",
    "init",
    "models",
    "new",
    "sessions",
    "summarize",
  ]),
};

/** 将会话引擎映射到斜杠目录分组（codex 与 codex-rpc 共用 Codex 目录）。 */
export function resolveEngineSlashCatalogGroup(
  engine: SessionExecutionEngine | null | undefined,
): EngineSlashCatalogGroup {
  switch (engine) {
    case "codex":
    case "codex-rpc":
      return "codex";
    case "cursor":
      return "cursor";
    case "opencode":
      return "opencode";
    default:
      return "claude";
  }
}

export function listBuiltinSlashCommandsForEngine(
  engine: SessionExecutionEngine | null | undefined,
): readonly EngineBuiltinSlashCommand[] {
  switch (resolveEngineSlashCatalogGroup(engine)) {
    case "codex":
      return CODEX_BUILTIN_SLASH_COMMANDS;
    case "cursor":
      return CURSOR_BUILTIN_SLASH_COMMANDS;
    case "opencode":
      return OPENCODE_BUILTIN_SLASH_COMMANDS;
    case "claude":
    default:
      return CLAUDE_BUILTIN_SLASH_COMMANDS;
  }
}

export function emptyQuerySlashHintsForEngine(
  engine: SessionExecutionEngine | null | undefined,
): ReadonlySet<string> {
  return EMPTY_QUERY_HINTS[resolveEngineSlashCatalogGroup(engine)];
}

export const ENGINE_SLASH_GROUP_TITLES: Record<EngineSlashCatalogGroup, string> = {
  claude: "Claude 内置",
  codex: "Codex 内置",
  cursor: "Cursor 内置",
  opencode: "OpenCode 内置",
};

/**
 * 将用户输入的斜杠命令改写为当前引擎可识别的形式。
 * - 同名命令保持不变
 * - 别名归一（如 Cursor/OpenCode 的 /summarize → /compact）
 * - Claude 专用命令在非 Claude 引擎下标记为不支持
 */
export function rewriteSlashCommandForEngine(
  text: string,
  engine: SessionExecutionEngine | null | undefined,
): { outbound: string; unsupportedMessage?: string } {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return { outbound: trimmed };
  }

  const group = resolveEngineSlashCatalogGroup(engine);
  if (group === "claude") {
    return { outbound: trimmed };
  }

  const head = trimmed.slice(1).split(/\s+/)[0]?.toLowerCase() ?? "";
  const rest = trimmed.slice(1 + head.length).trimStart();
  const catalog = listBuiltinSlashCommandsForEngine(engine);
  const labels = new Set(catalog.map((cmd) => cmd.label.toLowerCase()));

  let normalizedHead = head;
  if (group === "cursor" || group === "opencode") {
    if (head === "summarize" || head === "compress") {
      normalizedHead = "compact";
    }
  }
  if (group === "codex" && (head === "models" || head === "reset")) {
    normalizedHead = head === "models" ? "model" : "clear";
  }
  if (group === "opencode" && (head === "resume" || head === "continue")) {
    normalizedHead = "sessions";
  }
  if (group === "cursor" && head === "models") {
    normalizedHead = "model";
  }

  const rewritten = rest ? `/${normalizedHead} ${rest}` : `/${normalizedHead}`;

  if (labels.has(normalizedHead)) {
    return { outbound: rewritten };
  }

  // Claude 目录里有、当前引擎没有的命令：明确提示，避免当普通 prompt 发给引擎。
  const claudeHas = CLAUDE_BUILTIN_SLASH_COMMANDS.some(
    (cmd) => cmd.label.toLowerCase() === head,
  );
  if (claudeHas) {
    const engineLabel =
      group === "codex" ? "Codex" : group === "cursor" ? "Cursor" : "OpenCode";
    return {
      outbound: rewritten,
      unsupportedMessage: `「/${head}」是 Claude Code 命令，当前引擎为 ${engineLabel}，请改用 ${engineLabel} 支持的斜杠命令（输入 / 查看）。`,
    };
  }

  return { outbound: rewritten };
}

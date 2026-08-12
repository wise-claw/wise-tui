import type { SessionExecutionEngine } from "./sessionExecutionEngine";
import {
  CLAUDE_BUILTIN_SLASH_COMMANDS,
  type ClaudeBuiltinSlashCommand,
} from "./claudeCodeSlashCommands";

/** 各执行引擎内置 `/` 命令条目（与 Claude 目录同形，便于补全复用）。 */
export type EngineBuiltinSlashCommand = ClaudeBuiltinSlashCommand;

export type EngineSlashCatalogGroup = "claude" | "codex" | "cursor" | "opencode";

/**
 * Codex CLI / App-Server 内置斜杠命令目录（对齐 v0.131–v0.147 官方命令集）。
 * 参考：https://developers.openai.com/codex/cli/slash-commands
 */
export const CODEX_BUILTIN_SLASH_COMMANDS: readonly EngineBuiltinSlashCommand[] = [
  { label: "agent", description: "切换当前活动 subagent 线程（并行子代理）" },
  { label: "approval", description: "切换审批模式 suggest/auto-edit/full-auto（别名 /approvals /permissions）" },
  { label: "approve", description: "重试被自动审查拒绝的上一个动作" },
  { label: "apps", description: "浏览 App Connectors 并插入 $app 提及" },
  { label: "archive", description: "归档当前会话并退出（v0.136+）" },
  { label: "clear", description: "清空上下文并开新对话（Wise：新建标签）" },
  { label: "compact", description: "压缩对话历史释放上下文（Codex agent 原生命令）" },
  { label: "copy", description: "复制最近一次完成的 Codex 输出到剪贴板" },
  { label: "debug-config", description: "打印配置层级与 requirements 诊断" },
  { label: "delete", description: "永久删除当前会话（v0.140+）" },
  { label: "diff", description: "查看工作区 Git diff（含未跟踪文件）" },
  { label: "exit", description: "关闭当前交互会话（别名 /quit）" },
  { label: "experimental", description: "切换实验性功能开关" },
  { label: "fast", description: "切换 Fast 服务层级（1.5× 速度，需 ChatGPT 订阅）" },
  { label: "feedback", description: "提交会话日志与问题反馈" },
  { label: "fork", description: "分叉当前对话到新线程" },
  { label: "goal", description: "设置跨轮次持久目标（实验功能，/goal clear 清除）" },
  { label: "help", description: "显示帮助与可用命令（别名 /h）" },
  { label: "hooks", description: "查看、信任或禁用生命周期 Hook" },
  { label: "ide", description: "附带 IDE 打开文件与选区上下文" },
  { label: "import", description: "从 Claude Code 选择性导入设置/配置/聊天（v0.140+）" },
  { label: "init", description: "在当前目录生成 AGENTS.md" },
  { label: "keymap", description: "重映射 TUI 键盘快捷键" },
  { label: "login", description: "登录 OpenAI 账号" },
  { label: "logout", description: "清除已保存的登录凭证" },
  { label: "mcp", description: "列出已配置 MCP 工具" },
  { label: "memories", description: "配置线程是否使用/生成持久记忆" },
  { label: "mention", description: "附加文件到会话（等同 @ 提及）" },
  { label: "model", description: "切换模型与推理强度（Wise：打开模型面板）" },
  { label: "new", description: "在同一会话内开新对话（Wise：新建标签）" },
  { label: "permissions", description: "切换审批模式 auto-approve/on-request/manual（别名 /approval）" },
  { label: "personality", description: "选择沟通风格 friendly/pragmatic/none" },
  { label: "plan", description: "进入规划模式，可附带任务描述" },
  { label: "plugins", description: "浏览已安装与市场插件" },
  { label: "ps", description: "显示实验性后台终端状态" },
  { label: "quit", description: "退出会话（/exit 别名）" },
  { label: "raw", description: "切换原始滚动模式，便于干净复制" },
  { label: "rename", description: "重命名当前会话线程" },
  { label: "reset", description: "完全重置会话状态（比 /clear 更彻底）" },
  { label: "resume", description: "恢复历史会话" },
  { label: "review", description: "审查工作区改动（Codex RPC 可走 review/start）" },
  { label: "sandbox", description: "切换沙箱模式 read-only/workspace-write/danger-full-access" },
  { label: "side", description: "打开临时侧边会话，不污染主线程" },
  { label: "skills", description: "浏览与使用 Skills" },
  { label: "status", description: "查看会话配置与 token 用量" },
  { label: "statusline", description: "配置 TUI 底部状态栏字段" },
  { label: "stop", description: "停止所有运行中的后台终端" },
  { label: "theme", description: "选择语法高亮主题" },
  { label: "title", description: "自定义终端窗口/标签页标题" },
  { label: "usage", description: "查看账号用量与额度（v0.140+）" },
  { label: "use", description: "显式加载指定 Skill 到当前任务（/use skill-name）" },
  { label: "vim", description: "切换 Vim 模态编辑" },
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
  { label: "connect", description: "添加/配置模型提供商（交互式选择并填入 API Key）" },
  { label: "details", description: "切换工具执行详情显示" },
  { label: "editor", description: "用外部编辑器撰写消息（使用 EDITOR 环境变量）" },
  { label: "exit", description: "退出 OpenCode（别名 /quit /q）" },
  { label: "export", description: "导出对话为 Markdown" },
  { label: "help", description: "显示帮助" },
  { label: "init", description: "引导生成 AGENTS.md" },
  { label: "models", description: "列出/选择模型（Wise：打开模型面板）" },
  { label: "new", description: "新建会话（Wise：新建标签）" },
  { label: "quit", description: "退出 OpenCode（/exit 别名）" },
  { label: "redo", description: "重新应用上一次撤销的消息与文件改动" },
  { label: "sessions", description: "列出/切换会话（别名 /resume /continue）" },
  { label: "share", description: "生成公开分享链接" },
  { label: "summarize", description: "压缩当前会话（/compact 别名）" },
  { label: "themes", description: "列出/切换主题" },
  { label: "thinking", description: "切换推理块可见性" },
  { label: "undo", description: "撤销上一轮并回滚文件" },
  { label: "unshare", description: "撤销当前会话的公开分享链接" },
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
    "fork",
    "help",
    "init",
    "mcp",
    "model",
    "new",
    "plan",
    "resume",
    "review",
    "sandbox",
    "side",
    "skills",
    "status",
    "usage",
    "use",
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
    "connect",
    "editor",
    "exit",
    "help",
    "init",
    "models",
    "new",
    "redo",
    "sessions",
    "share",
    "summarize",
    "themes",
    "undo",
    "unshare",
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
  if (group === "codex") {
    if (head === "models") {
      normalizedHead = "model";
    } else if (head === "approvals") {
      normalizedHead = "permissions";
    } else if (head === "r") {
      normalizedHead = "review";
    } else if (head === "c") {
      normalizedHead = "clear";
    } else if (head === "h") {
      normalizedHead = "help";
    } else if (head === "s") {
      normalizedHead = "status";
    }
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

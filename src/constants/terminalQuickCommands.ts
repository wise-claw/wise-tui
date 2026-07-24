/** 终端顶栏快捷指令：持久化在 SQLite `terminal_quick_commands` 表。 */

export type TerminalQuickCommand = {
  id: string;
  /** 列表展示名；可空，空则用 command 截断展示。 */
  title: string;
  /** 写入 PTY 的命令正文（不含尾随换行）。 */
  command: string;
};

export const DEFAULT_TERMINAL_QUICK_COMMANDS: TerminalQuickCommand[] = [];

const MAX_TITLE_LEN = 80;
const MAX_COMMAND_LEN = 2000;
const MAX_ITEMS = 50;

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `tqc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createTerminalQuickCommand(input: {
  title?: string;
  command: string;
}): TerminalQuickCommand | null {
  const command = input.command.trim();
  if (!command) return null;
  const title = (input.title ?? "").trim().slice(0, MAX_TITLE_LEN);
  return {
    id: newId(),
    title,
    command: command.slice(0, MAX_COMMAND_LEN),
  };
}

export function parseTerminalQuickCommands(raw: unknown): TerminalQuickCommand[] {
  if (!Array.isArray(raw)) return [...DEFAULT_TERMINAL_QUICK_COMMANDS];
  const out: TerminalQuickCommand[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const command =
      typeof record.command === "string" ? record.command.trim() : "";
    if (!command) continue;
    let id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id || seen.has(id)) id = newId();
    seen.add(id);
    const title =
      typeof record.title === "string"
        ? record.title.trim().slice(0, MAX_TITLE_LEN)
        : "";
    out.push({
      id,
      title,
      command: command.slice(0, MAX_COMMAND_LEN),
    });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

export function normalizeTerminalQuickCommands(
  items: TerminalQuickCommand[],
): TerminalQuickCommand[] {
  return parseTerminalQuickCommands(items);
}

/** 写入 PTY：保证以换行结尾，便于 shell 立即执行。 */
export function buildTerminalQuickCommandInput(command: string): string {
  const trimmed = command.replace(/\r?\n+$/u, "");
  return `${trimmed}\n`;
}

export function terminalQuickCommandLabel(item: TerminalQuickCommand): string {
  const title = item.title.trim();
  if (title) return title;
  const cmd = item.command.trim();
  if (cmd.length <= 36) return cmd;
  return `${cmd.slice(0, 33)}…`;
}

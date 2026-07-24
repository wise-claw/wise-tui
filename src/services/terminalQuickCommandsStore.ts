/**
 * 终端快捷指令：SQLite `terminal_quick_commands` 表（经 Tauri list/save 命令）。
 */
import {
  normalizeTerminalQuickCommands,
  type TerminalQuickCommand,
} from "../constants/terminalQuickCommands";
import { invoke } from "@tauri-apps/api/core";

type TerminalQuickCommandRow = TerminalQuickCommand & {
  sortOrder?: number;
  createdAt?: number;
  updatedAt?: number;
};

function toFrontend(row: TerminalQuickCommandRow): TerminalQuickCommand {
  return {
    id: row.id,
    title: row.title,
    command: row.command,
  };
}

export async function loadTerminalQuickCommands(): Promise<TerminalQuickCommand[]> {
  const rows = await invoke<TerminalQuickCommandRow[]>("list_terminal_quick_commands");
  return normalizeTerminalQuickCommands((rows ?? []).map(toFrontend));
}

export async function saveTerminalQuickCommands(
  items: TerminalQuickCommand[],
): Promise<TerminalQuickCommand[]> {
  const normalized = normalizeTerminalQuickCommands(items);
  const saved = await invoke<TerminalQuickCommandRow[]>("save_terminal_quick_commands", {
    items: normalized.map((item, index) => ({
      id: item.id,
      title: item.title,
      command: item.command,
      sortOrder: index,
      createdAt: 0,
      updatedAt: 0,
    })),
  });
  return normalizeTerminalQuickCommands((saved ?? []).map(toFrontend));
}

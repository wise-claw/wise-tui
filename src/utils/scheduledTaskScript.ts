import type { RepositoryScheduledClaudeTask } from "../types";

/** 定时任务脚本来源：内联正文或仓库相对文件。 */
export type ScheduledTaskScriptSource = "inline" | "file";

/**
 * 规范化仓库相对脚本路径：去首尾空白与前导 `/`，拒绝 `..` / 绝对路径 / 空段。
 * 非法输入返回 `null`。
 */
export function normalizeScheduledTaskScriptFilePath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
  if (!trimmed) return null;
  if (trimmed.startsWith("~") || /^[A-Za-z]:/.test(trimmed)) return null;
  const segments = trimmed.split("/");
  if (segments.some((seg) => !seg || seg === "." || seg === "..")) return null;
  return trimmed;
}

export function resolveScheduledTaskScriptSource(
  task: Pick<RepositoryScheduledClaudeTask, "scriptFilePath" | "contentMarkdown">,
): ScheduledTaskScriptSource {
  return normalizeScheduledTaskScriptFilePath(task.scriptFilePath) ? "file" : "inline";
}

/** 供 `zsh -c` 使用的单引号转义。 */
export function shellSingleQuoteForZsh(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export type BuildScheduledTaskScriptCommandResult =
  | { ok: true; command: string; mode: ScheduledTaskScriptSource; scriptFilePath?: string }
  | { ok: false; reason: string };

/**
 * 组装脚本定时任务的 `runShellCommand` 命令：
 * - 有合法 `scriptFilePath` 时：在仓库根用 zsh 执行该相对路径文件；
 * - 否则：把 `contentMarkdown` 当作内联 shell（与历史行为一致）。
 */
export function buildScheduledTaskScriptCommand(
  task: Pick<RepositoryScheduledClaudeTask, "scriptFilePath" | "contentMarkdown">,
): BuildScheduledTaskScriptCommandResult {
  const scriptFilePath = normalizeScheduledTaskScriptFilePath(task.scriptFilePath);
  if (scriptFilePath) {
    return {
      ok: true,
      mode: "file",
      scriptFilePath,
      command: `zsh -- ${shellSingleQuoteForZsh(`./${scriptFilePath}`)}`,
    };
  }
  const inline = task.contentMarkdown.trim();
  if (!inline) {
    return { ok: false, reason: "脚本内容为空" };
  }
  return { ok: true, mode: "inline", command: inline };
}

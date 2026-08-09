import type { WorkflowCodeExecutionConfig } from "../types/workflowCode";

/** 供 `zsh -c` 使用的单引号转义。 */
function shellSingleQuoteForZsh(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** 组装工作流 Shell 代码节点在仓库 cwd 下执行的命令。 */
export function buildWorkflowShellRunCommand(
  config: Pick<WorkflowCodeExecutionConfig, "mode" | "source">,
  substitutedSource: string,
): { ok: true; command: string } | { ok: false; reason: string } {
  const source = substitutedSource.trim();
  if (!source) {
    return { ok: false, reason: "代码执行内容为空" };
  }
  if (config.mode === "command") {
    return { ok: true, command: source };
  }
  // script：整段交给 zsh -c
  return { ok: true, command: `zsh -c ${shellSingleQuoteForZsh(source)}` };
}

/** 解析代码节点工作目录（相对仓库根）。非法相对路径时回退仓库根。 */
export function resolveWorkflowCodeWorkingDirectory(
  repositoryPath: string,
  workingDirectory?: string | null,
): string {
  const root = repositoryPath.trim().replace(/\/+$/, "");
  const rel = workingDirectory?.trim().replace(/\\/g, "/") ?? "";
  if (!root) return "";
  if (!rel || rel === "." || rel === "./") return root;
  if (rel.startsWith("/") || rel.startsWith("~") || /^[A-Za-z]:/.test(rel)) return root;
  if (rel.split("/").some((seg) => !seg || seg === "." || seg === "..")) return root;
  return `${root}/${rel}`;
}

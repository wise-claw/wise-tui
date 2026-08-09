import { openBackgroundScript, runShellCommand } from "./terminal";
import {
  ensureTerminalOutputAndExitReady,
  subscribeTerminalExit,
  subscribeTerminalOutput,
} from "./events";
import { upsertExecutionEnvironmentDispatchItem } from "../stores/executionEnvironmentDispatchStore";
import {
  buildWorkflowShellRunCommand,
  resolveWorkflowCodeWorkingDirectory,
} from "./workflowCodeShellRun";
import type { WorkflowCodeExecutionConfig } from "../types/workflowCode";

export type WorkflowCodeShellRunResult = {
  ok: boolean;
  exitCode: number;
  output: string;
  command: string;
  cwd: string;
  terminalId?: string;
  usedBackgroundTerminal: boolean;
};

/** 等待后台终端退出的默认上限；超时后回退同步 shell，避免流程卡死。 */
const DEFAULT_TIMEOUT_MS = 45_000;

function normalizeWorkspaceKey(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function formatShellFallbackOutput(stdout: string, stderr: string, exitCode: number): string {
  return [
    stdout.trim() ? `stdout:\n${stdout.trim()}` : "",
    stderr.trim() ? `stderr:\n${stderr.trim()}` : "",
    `exit_code=${exitCode}`,
  ]
    .filter(Boolean)
    .join("\n\n") || `(无输出，exit_code=${exitCode})`;
}

async function runShellFallback(input: {
  cwd: string;
  command: string;
}): Promise<WorkflowCodeShellRunResult> {
  try {
    const response = await runShellCommand(input.cwd, input.command);
    return {
      ok: response.exit_code === 0,
      exitCode: response.exit_code,
      output: formatShellFallbackOutput(response.stdout, response.stderr, response.exit_code),
      command: input.command,
      cwd: input.cwd,
      usedBackgroundTerminal: false,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      exitCode: 1,
      output: `代码执行失败：${msg}`,
      command: input.command,
      cwd: input.cwd,
      usedBackgroundTerminal: false,
    };
  }
}

/**
 * 在仓库终端 Shell 中执行工作流代码节点：
 * 优先 `openBackgroundScript`（运行面板可见）。
 * 必须先挂好 output/exit 订阅并 await listen 就绪，再 spawn；
 * 否则 `echo` 等瞬时命令会在 listen 之前已 exit，流程一直停在「待执行」。
 * 超时或 PTY 失败时回退 `runShellCommand`。
 */
export async function runWorkflowCodeNodeInTerminalShell(input: {
  repositoryPath: string;
  config: WorkflowCodeExecutionConfig;
  /** 已做变量替换后的命令/脚本正文 */
  substitutedSource: string;
  title: string;
  anchorSessionId?: string;
  timeoutMs?: number;
}): Promise<WorkflowCodeShellRunResult> {
  const built = buildWorkflowShellRunCommand(input.config, input.substitutedSource);
  if (!built.ok) {
    return {
      ok: false,
      exitCode: 1,
      output: built.reason,
      command: "",
      cwd: input.repositoryPath.trim(),
      usedBackgroundTerminal: false,
    };
  }
  const cwd = resolveWorkflowCodeWorkingDirectory(input.repositoryPath, input.config.workingDirectory);
  const cwdKey = normalizeWorkspaceKey(cwd);
  const timeoutMs =
    input.timeoutMs ??
    (input.config.timeoutSeconds && input.config.timeoutSeconds > 0
      ? input.config.timeoutSeconds * 1000
      : DEFAULT_TIMEOUT_MS);
  const requestedTerminalId = `workflow-code:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
  const title = input.title.trim() || "工作流·代码执行";
  const acceptedTerminalIds = new Set<string>([requestedTerminalId]);

  const chunks: string[] = [];
  let settled = false;
  let timer: number | undefined;
  let finish!: (payload: WorkflowCodeShellRunResult) => void;
  const resultPromise = new Promise<WorkflowCodeShellRunResult>((resolve) => {
    finish = (payload) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      resolve(payload);
    };
  });

  const unsubOut = subscribeTerminalOutput((event) => {
    if (normalizeWorkspaceKey(event.workspaceId) !== cwdKey) return;
    if (!acceptedTerminalIds.has(event.terminalId)) return;
    if (event.data) chunks.push(event.data);
  });
  const unsubExit = subscribeTerminalExit((event) => {
    if (normalizeWorkspaceKey(event.workspaceId) !== cwdKey) return;
    if (!acceptedTerminalIds.has(event.terminalId)) return;
    const exitCode = typeof event.exitCode === "number" ? event.exitCode : 1;
    const reason = event.reason?.trim();
    const body = chunks.join("").trim();
    const output = [body, reason ? `退出原因：${reason}` : "", `exit_code=${exitCode}`]
      .filter(Boolean)
      .join("\n");
    finish({
      ok: exitCode === 0,
      exitCode,
      output: output || `(无输出，exit_code=${exitCode})`,
      command: built.command,
      cwd,
      terminalId: event.terminalId,
      usedBackgroundTerminal: true,
    });
  });

  try {
    // 先等 listen 挂好，再 spawn，避免错过瞬时 exit。
    await ensureTerminalOutputAndExitReady();
    const info = await openBackgroundScript(cwd, requestedTerminalId, cwd, built.command, title);
    const effectiveTerminalId = info.terminalId?.trim() || requestedTerminalId;
    acceptedTerminalIds.add(effectiveTerminalId);

    const anchorSessionId = input.anchorSessionId?.trim() || cwd;
    upsertExecutionEnvironmentDispatchItem({
      batchId: `workflow-code:${effectiveTerminalId}`,
      anchorSessionId,
      workerSessionId: effectiveTerminalId,
      label: title,
      previewText: built.command.length > 240 ? `${built.command.slice(0, 240)}…` : built.command,
      batchIndex: 1,
      sessionCount: 1,
      workspaceId: cwd,
      terminalId: effectiveTerminalId,
      cwd,
      pid: info.pid,
    });

    timer = window.setTimeout(() => {
      finish({
        ok: false,
        exitCode: -1,
        output: "",
        command: built.command,
        cwd,
        terminalId: effectiveTerminalId,
        usedBackgroundTerminal: true,
      });
    }, timeoutMs);

    const waited = await resultPromise;
    unsubOut();
    unsubExit();

    if (waited.exitCode === -1) {
      const fallback = await runShellFallback({ cwd, command: built.command });
      return {
        ...fallback,
        output: [
          chunks.join("").trim(),
          `（终端退出事件超时 ${Math.round(timeoutMs / 1000)}s，已回退同步 shell）`,
          fallback.output,
        ]
          .filter(Boolean)
          .join("\n"),
        terminalId: effectiveTerminalId,
      };
    }
    return { ...waited, terminalId: effectiveTerminalId };
  } catch {
    unsubOut();
    unsubExit();
    return runShellFallback({ cwd, command: built.command });
  }
}

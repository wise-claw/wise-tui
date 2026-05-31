import { message } from "antd";
import { subscribeTerminalExit, subscribeTerminalOutput } from "../services/events";
import { openExternalUrl } from "../services/openExternal";
import { openTerminalSession, writeTerminalSession } from "../services/terminal";
import type { Repository } from "../types";
import type { RunCommandOutputLine, RepositoryRunStatus } from "../hooks/useRepositoryRunCommand";
import {
  REPOSITORY_RUNNER_TERMINAL_ID,
  RUN_ERROR_REGEX,
  buildRunErrorMonitorDedupKey,
  detectRunUrlFromLogText,
  normalizeRunOpenUrl,
  readRunAutoOpenPageEnabled,
  repositoryRunCommandStorageKeys,
  shouldSkipRunErrorMonitorSend,
} from "../utils/repositoryRunCommand";

type RepoRuntimeState = {
  status: RepositoryRunStatus;
  statusHint: string;
  outputPreview: RunCommandOutputLine[];
  detectedUrl: string | null;
};

type RepoRuntimeInternals = {
  runCwd: string;
  runCommand: string;
  runPreferredUrl: string;
  runAutoOpenPageEnabled: boolean;
  runErrorMonitorEnabled: boolean;
  runLogTail: string;
  runChunkBuffer: string;
  idleTimer: number | null;
  autoOpenFallbackTimer: number | null;
  autoOpenedRunUrl: boolean;
  errorDetected: boolean;
  autoFixSent: boolean;
};

const DEFAULT_REPO_STATE: RepoRuntimeState = {
  status: "idle",
  statusHint: "未运行",
  outputPreview: [],
  detectedUrl: null,
};

const repoStateById = new Map<number, RepoRuntimeState>();
const repoInternalsById = new Map<number, RepoRuntimeInternals>();
const listeners = new Set<() => void>();

const EMPTY_RUNNING_BY_REPOSITORY_ID: Record<number, boolean> = {};
let runningByRepositoryIdSnapshot: Record<number, boolean> = EMPTY_RUNNING_BY_REPOSITORY_ID;
let runningByRepositoryIdCacheKey = "";

let globalOnAutoFixRunError: ((prompt: string) => void) | undefined;
let globalOnRequestConfigure: ((repository: Pick<Repository, "id" | "path">) => void) | undefined;
let terminalListenersReady = false;
let terminalOutputUnlisten: (() => void) | null = null;
let terminalExitUnlisten: (() => void) | null = null;
let hiddenPublishPending = false;
let visibilityListenerReady = false;

function refreshRunningByRepositoryIdSnapshot(): void {
  const activeIds: number[] = [];
  for (const [repositoryId, state] of repoStateById.entries()) {
    if (state.status === "running" || state.status === "stopping") {
      activeIds.push(repositoryId);
    }
  }
  activeIds.sort((a, b) => a - b);
  const cacheKey = activeIds.join(",");
  if (cacheKey === runningByRepositoryIdCacheKey) return;
  runningByRepositoryIdCacheKey = cacheKey;
  if (activeIds.length === 0) {
    runningByRepositoryIdSnapshot = EMPTY_RUNNING_BY_REPOSITORY_ID;
    return;
  }
  const next: Record<number, boolean> = {};
  for (const repositoryId of activeIds) {
    next[repositoryId] = true;
  }
  runningByRepositoryIdSnapshot = next;
}

function publish(): void {
  refreshRunningByRepositoryIdSnapshot();
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* ignore subscriber errors */
    }
  }
}

function getOrCreateRepoState(repositoryId: number): RepoRuntimeState {
  let state = repoStateById.get(repositoryId);
  if (!state) {
    state = { ...DEFAULT_REPO_STATE };
    repoStateById.set(repositoryId, state);
  }
  return state;
}

function patchRepoState(repositoryId: number, patch: Partial<RepoRuntimeState>): void {
  const prev = getOrCreateRepoState(repositoryId);
  repoStateById.set(repositoryId, { ...prev, ...patch });
  if (typeof document !== "undefined" && document.visibilityState !== "visible") {
    hiddenPublishPending = true;
    return;
  }
  publish();
}

function flushHiddenPublishIfNeeded(): void {
  if (!hiddenPublishPending) return;
  hiddenPublishPending = false;
  publish();
}

function ensureVisibilityFlushListener(): void {
  if (visibilityListenerReady || typeof document === "undefined") return;
  visibilityListenerReady = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      flushHiddenPublishIfNeeded();
    }
  });
}

function getOrCreateInternals(repositoryId: number, runCwd: string): RepoRuntimeInternals {
  let internals = repoInternalsById.get(repositoryId);
  if (!internals) {
    const { runKey, runUrlKey, runAutoOpenKey } = repositoryRunCommandStorageKeys(runCwd);
    internals = {
      runCwd,
      runCommand: runKey ? (window.localStorage.getItem(runKey) ?? "") : "",
      runPreferredUrl: runUrlKey ? (window.localStorage.getItem(runUrlKey) ?? "") : "",
      runAutoOpenPageEnabled: readRunAutoOpenPageEnabled(runAutoOpenKey),
      runErrorMonitorEnabled: false,
      runLogTail: "",
      runChunkBuffer: "",
      idleTimer: null,
      autoOpenFallbackTimer: null,
      autoOpenedRunUrl: false,
      errorDetected: false,
      autoFixSent: false,
    };
    repoInternalsById.set(repositoryId, internals);
  }
  return internals;
}

function clearIdleTimer(internals: RepoRuntimeInternals): void {
  if (internals.idleTimer != null) {
    window.clearTimeout(internals.idleTimer);
    internals.idleTimer = null;
  }
}

function clearAutoOpenFallbackTimer(internals: RepoRuntimeInternals): void {
  if (internals.autoOpenFallbackTimer != null) {
    window.clearTimeout(internals.autoOpenFallbackTimer);
    internals.autoOpenFallbackTimer = null;
  }
}

function appendRunOutputPreview(repositoryId: number, internals: RepoRuntimeInternals, chunk: string): void {
  const plain = chunk
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const mixed = `${internals.runChunkBuffer}${plain}`;
  const parts = mixed.split("\n");
  internals.runChunkBuffer = parts.pop() ?? "";
  const nextLines = parts.map((line) => line.trim()).filter(Boolean);
  if (nextLines.length === 0) return;
  const mapped = nextLines.map((line) => ({ text: line, isError: RUN_ERROR_REGEX.test(line) }));
  const state = getOrCreateRepoState(repositoryId);
  patchRepoState(repositoryId, {
    outputPreview: [...state.outputPreview, ...mapped].slice(-8),
  });
}

function inferDefaultRunUrl(command: string): string {
  const cmd = command.trim();
  const portByFlag = cmd.match(/(?:--port|-p)\s*(\d{2,5})/i)?.[1];
  const portByEnv = cmd.match(/PORT=(\d{2,5})/i)?.[1];
  const port = portByFlag || portByEnv || "16088";
  return `http://localhost:${port}`;
}

function resolveOpenUrl(internals: RepoRuntimeInternals, detectedUrl: string | null): string {
  const preferred = normalizeRunOpenUrl(internals.runPreferredUrl);
  if (preferred) return preferred;
  if (detectedUrl) return detectedUrl;
  return inferDefaultRunUrl(internals.runCommand);
}

function refreshInternalsFromStorage(internals: RepoRuntimeInternals, runCwd: string): void {
  const { runKey, runUrlKey, runAutoOpenKey } = repositoryRunCommandStorageKeys(runCwd);
  internals.runCwd = runCwd;
  internals.runCommand = runKey ? (window.localStorage.getItem(runKey) ?? "") : "";
  internals.runPreferredUrl = runUrlKey ? (window.localStorage.getItem(runUrlKey) ?? "") : "";
  internals.runAutoOpenPageEnabled = readRunAutoOpenPageEnabled(runAutoOpenKey);
}

function ensureTerminalListeners(): void {
  if (terminalListenersReady) return;
  terminalListenersReady = true;
  ensureVisibilityFlushListener();

  terminalOutputUnlisten = subscribeTerminalOutput((payload) => {
    const repositoryId = Number(payload.workspaceId);
    if (!Number.isFinite(repositoryId)) return;
    if (payload.terminalId !== REPOSITORY_RUNNER_TERMINAL_ID) return;
    const internals = repoInternalsById.get(repositoryId);
    if (!internals) return;

    const nextTail = `${internals.runLogTail}${payload.data}`.slice(-10_000);
    internals.runLogTail = nextTail;
    appendRunOutputPreview(repositoryId, internals, payload.data);
    const detected = detectRunUrlFromLogText(payload.data) ?? detectRunUrlFromLogText(nextTail);
    if (detected) {
      if (internals.runAutoOpenPageEnabled && !internals.autoOpenedRunUrl) {
        internals.autoOpenedRunUrl = true;
        clearAutoOpenFallbackTimer(internals);
        const preferred = normalizeRunOpenUrl(internals.runPreferredUrl);
        const urlToOpen = preferred ?? detected;
        void openExternalUrl(urlToOpen);
        patchRepoState(repositoryId, {
          detectedUrl: detected,
          statusHint: `已自动打开地址：${urlToOpen}`,
        });
      } else {
        patchRepoState(repositoryId, { detectedUrl: detected });
      }
    }
    if (RUN_ERROR_REGEX.test(payload.data) && internals.runErrorMonitorEnabled) {
      internals.errorDetected = true;
      globalOnRequestConfigure?.({ id: repositoryId, path: internals.runCwd });
      patchRepoState(repositoryId, { statusHint: "检测到报错，等待自动处理..." });
    }
    clearIdleTimer(internals);
    internals.idleTimer = window.setTimeout(() => {
      if (!internals.errorDetected || internals.autoFixSent) return;
      internals.autoFixSent = true;
      if (!globalOnAutoFixRunError) return;
      const command = internals.runCommand.trim();
      const dedupKey = buildRunErrorMonitorDedupKey(internals.runCwd, command, nextTail);
      if (shouldSkipRunErrorMonitorSend(dedupKey, Date.now())) {
        patchRepoState(repositoryId, { statusHint: "检测到重复报错，已跳过重复发送" });
        return;
      }
      const prompt = [
        "请根据以下运行报错日志定位问题并直接给出修复方案，然后在仓库内执行修复。",
        `运行命令：${command || "(未记录)"}`,
        "最近日志：",
        nextTail || "(无)",
      ].join("\n\n");
      globalOnAutoFixRunError(prompt);
      patchRepoState(repositoryId, { statusHint: "已交给 Claude Code 自动修复" });
      message.info("检测到报错，已自动交给 Claude Code 处理。");
    }, 5000);
  });

  terminalExitUnlisten = subscribeTerminalExit((payload) => {
    const repositoryId = Number(payload.workspaceId);
    if (!Number.isFinite(repositoryId)) return;
    if (payload.terminalId !== REPOSITORY_RUNNER_TERMINAL_ID) return;
    const internals = repoInternalsById.get(repositoryId);
    if (!internals) return;
    clearIdleTimer(internals);
    clearAutoOpenFallbackTimer(internals);
    const remain = internals.runChunkBuffer.trim();
    if (remain) {
      const state = getOrCreateRepoState(repositoryId);
      patchRepoState(repositoryId, {
        outputPreview: [
          ...state.outputPreview,
          { text: remain, isError: RUN_ERROR_REGEX.test(remain) },
        ].slice(-8),
      });
    }
    internals.runChunkBuffer = "";
    repoInternalsById.delete(repositoryId);
    patchRepoState(repositoryId, {
      status: "idle",
      statusHint: payload.exitCode === 0 ? "运行结束" : `已退出（code ${payload.exitCode}）`,
      outputPreview: [],
      detectedUrl: null,
    });
  });
}

export function subscribeRepositoryRunCommandRuntime(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getRepositoryRunCommandRuntimeSnapshot(): Map<number, RepoRuntimeState> {
  return repoStateById;
}

export function getRepositoryRunCommandState(repositoryId: number): RepoRuntimeState {
  return getOrCreateRepoState(repositoryId);
}

export function isRepositoryRunCommandActive(repositoryId: number): boolean {
  const status = getOrCreateRepoState(repositoryId).status;
  return status === "running" || status === "stopping";
}

export function getRepositoryRunCommandRunningByRepositoryId(): Record<number, boolean> {
  return runningByRepositoryIdSnapshot;
}

/** Dispose all terminal event listeners and reset state. */
export function disposeTerminalListeners(): void {
  terminalOutputUnlisten?.();
  terminalOutputUnlisten = null;
  terminalExitUnlisten?.();
  terminalExitUnlisten = null;
  terminalListenersReady = false;
}

/** 移除非当前仓库列表里、且已 idle 的运行状态条目，避免 Map 只增不减。 */
export function pruneRepositoryRunCommandRuntime(liveRepositoryIds: ReadonlySet<number>): void {
  let changed = false;
  for (const [repositoryId, state] of [...repoStateById.entries()]) {
    if (liveRepositoryIds.has(repositoryId)) continue;
    if (state.status === "running" || state.status === "stopping") continue;
    repoStateById.delete(repositoryId);
    changed = true;
  }
  for (const [repositoryId] of [...repoInternalsById.entries()]) {
    if (!liveRepositoryIds.has(repositoryId)) {
      const internals = repoInternalsById.get(repositoryId)!;
      clearIdleTimer(internals);
      clearAutoOpenFallbackTimer(internals);
      repoInternalsById.delete(repositoryId);
      changed = true;
    }
  }
  if (changed) publish();
}

export function setRepositoryRunCommandAutoFixHandler(
  handler: ((prompt: string) => void) | undefined,
): void {
  globalOnAutoFixRunError = handler;
}

export function setRepositoryRunCommandConfigureHandler(
  handler: ((repository: Pick<Repository, "id" | "path">) => void) | undefined,
): void {
  globalOnRequestConfigure = handler;
}

export function syncRepositoryRunCommandFormState(
  repositoryId: number,
  runCwd: string,
  input: {
    runCommand: string;
    runPreferredUrl: string;
    runAutoOpenPageEnabled: boolean;
    runErrorMonitorEnabled: boolean;
  },
): void {
  const internals = getOrCreateInternals(repositoryId, runCwd);
  internals.runCommand = input.runCommand;
  internals.runPreferredUrl = input.runPreferredUrl;
  internals.runAutoOpenPageEnabled = input.runAutoOpenPageEnabled;
  internals.runErrorMonitorEnabled = input.runErrorMonitorEnabled;
}

export async function startRepositoryRunCommand(input: {
  repository: Pick<Repository, "id" | "path">;
  commandOverride?: string;
  onRequestConfigure?: () => void;
  onRunStarted?: () => void;
}): Promise<void> {
  ensureTerminalListeners();
  const { repository } = input;
  const runCwd = repository.path.trim();
  if (!runCwd) {
    message.warning("仓库路径无效，无法运行。");
    return;
  }
  const internals = getOrCreateInternals(repository.id, runCwd);
  refreshInternalsFromStorage(internals, runCwd);
  const cmd = (input.commandOverride ?? internals.runCommand).trim();
  if (!cmd) {
    input.onRequestConfigure?.() ?? globalOnRequestConfigure?.(repository);
    return;
  }
  try {
    await openTerminalSession(String(repository.id), REPOSITORY_RUNNER_TERMINAL_ID, 120, 36, runCwd).catch(
      () => {
        /* ignore "already opened" */
      },
    );
    internals.errorDetected = false;
    internals.autoFixSent = false;
    internals.autoOpenedRunUrl = false;
    internals.runLogTail = "";
    internals.runChunkBuffer = "";
    clearIdleTimer(internals);
    clearAutoOpenFallbackTimer(internals);
    patchRepoState(repository.id, {
      status: "running",
      statusHint: "启动中...",
      outputPreview: [],
      detectedUrl: null,
    });
    await writeTerminalSession(String(repository.id), REPOSITORY_RUNNER_TERMINAL_ID, `${cmd}\n`);
    patchRepoState(repository.id, { status: "running", statusHint: "运行中" });
    input.onRunStarted?.();
    if (internals.runAutoOpenPageEnabled) {
      internals.autoOpenFallbackTimer = window.setTimeout(() => {
        if (internals.autoOpenedRunUrl) return;
        const fallbackUrl = resolveOpenUrl(internals, getOrCreateRepoState(repository.id).detectedUrl);
        internals.autoOpenedRunUrl = true;
        void openExternalUrl(fallbackUrl);
        patchRepoState(repository.id, { statusHint: `已自动打开地址：${fallbackUrl}` });
      }, 4500);
    } else {
      patchRepoState(repository.id, { statusHint: "运行中（未开启自动打开页面）" });
    }
  } catch (error) {
    const msgText = error instanceof Error ? error.message : String(error);
    message.error(`运行失败: ${msgText}`);
    patchRepoState(repository.id, { status: "idle", statusHint: "启动失败" });
  }
}

export async function stopRepositoryRunCommand(
  repository: Pick<Repository, "id">,
): Promise<void> {
  ensureTerminalListeners();
  const internals = repoInternalsById.get(repository.id);
  patchRepoState(repository.id, { status: "stopping", statusHint: "停止中..." });
  try {
    await writeTerminalSession(String(repository.id), REPOSITORY_RUNNER_TERMINAL_ID, "\u0003");
    if (internals) {
      clearIdleTimer(internals);
      clearAutoOpenFallbackTimer(internals);
    }
    patchRepoState(repository.id, { status: "idle", statusHint: "已停止" });
  } catch (error) {
    const msgText = error instanceof Error ? error.message : String(error);
    message.error(`停止失败: ${msgText}`);
    patchRepoState(repository.id, { status: "idle", statusHint: "停止失败" });
  }
}

export async function toggleRepositoryRunCommand(input: {
  repository: Pick<Repository, "id" | "path">;
  onRequestConfigure?: () => void;
  onRunStarted?: () => void;
}): Promise<void> {
  const state = getOrCreateRepoState(input.repository.id);
  if (state.status === "running" || state.status === "stopping") {
    await stopRepositoryRunCommand(input.repository);
    return;
  }
  await startRepositoryRunCommand(input);
}

import { message } from "antd";
import { subscribeTerminalExit, subscribeTerminalOutput } from "../services/events";
import { openExternalUrl } from "../services/openExternal";
import { openTerminalSession, writeTerminalSession } from "../services/terminal";
import type { Repository } from "../types";
import type { RunCommandOutputLine, RepositoryRunStatus } from "../hooks/useRepositoryRunCommand";
import {
  REPOSITORY_RUNNER_TERMINAL_ID,
  buildRunErrorAutoFixPrompt,
  buildRunErrorFingerprint,
  buildRunErrorMonitorDedupKey,
  decideRunErrorMonitorStep,
  detectRunUrlFromLogText,
  lineHasRunLogIssue,
  normalizeRunOpenUrl,
  readRunAutoOpenPageEnabled,
  readRunRestart,
  repositoryRunCommandStorageKeys,
  shouldSkipRunErrorMonitorSend,
  summarizeRunLogIssueKinds,
  collectRunLogIssues,
  normalizeRunLogOutputChunk,
  wrapCommandWithAutoRestart,
  type RunRestartConfig,
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
  /** 「退出后自动重启」配置（异常退出后按设定间隔自动重启）。 */
  runRestart: RunRestartConfig;
  runLogTail: string;
  runChunkBuffer: string;
  idleTimer: number | null;
  autoOpenFallbackTimer: number | null;
  autoOpenedRunUrl: boolean;
  errorDetected: boolean;
  /** 本次运行是否已请求打开配置面板（报错时只弹一次）。 */
  configureRequested: boolean;
  autoFixSent: boolean;
  autoFixInFlight: boolean;
  lastDispatchAt: number;
  dispatchedFingerprint: string | null;
  lastErrorFingerprint: string | null;
  loopCount: number;
};

const DEFAULT_REPO_STATE: RepoRuntimeState = {
  status: "idle",
  statusHint: "未运行",
  outputPreview: [],
  detectedUrl: null,
};

const repoStateById = new Map<number, RepoRuntimeState>();
const repoInternalsById = new Map<number, RepoRuntimeInternals>();
const globalListeners = new Set<() => void>();
const repoListenersById = new Map<number, Set<() => void>>();

const EMPTY_RUNNING_BY_REPOSITORY_ID: Record<number, boolean> = {};
let runningByRepositoryIdSnapshot: Record<number, boolean> = EMPTY_RUNNING_BY_REPOSITORY_ID;
let runningByRepositoryIdCacheKey = "";

let globalOnAutoFixRunError:
  | ((prompt: string) => void | boolean | Promise<void | boolean>)
  | undefined;
let globalOnRequestConfigure: ((repository: Pick<Repository, "id" | "path">) => void) | undefined;
let terminalListenersReady = false;
let terminalOutputUnlisten: (() => void) | null = null;
let terminalExitUnlisten: (() => void) | null = null;
let hiddenPublishPending = false;
let visibilityListenerReady = false;
/** 待 rAF 合并通知的仓库 id；高频终端输出时避免每 chunk 同步打爆 React。 */
const pendingNotifyRepoIds = new Set<number>();
let notifyRafHandle: number | null = null;
/** 报错监控 UI / 指纹计算节流：同一仓库连续错误流上限制主线程开销。 */
const ERROR_MONITOR_UI_THROTTLE_MS = 500;
const lastErrorMonitorUiAtByRepo = new Map<number, number>();
const lastErrorFingerprintAtByRepo = new Map<number, number>();

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

function notifyRepositoryRunCommandRuntime(repositoryId: number): void {
  const prevRunningKey = runningByRepositoryIdCacheKey;
  refreshRunningByRepositoryIdSnapshot();
  const runningChanged = prevRunningKey !== runningByRepositoryIdCacheKey;

  const repoListeners = repoListenersById.get(repositoryId);
  if (repoListeners) {
    for (const listener of repoListeners) {
      try {
        listener();
      } catch {
        /* ignore subscriber errors */
      }
    }
  }
  if (runningChanged) {
    for (const listener of globalListeners) {
      try {
        listener();
      } catch {
        /* ignore subscriber errors */
      }
    }
  }
}

function notifyAllRepositoryRunCommandRuntimeListeners(): void {
  refreshRunningByRepositoryIdSnapshot();
  for (const listener of globalListeners) {
    try {
      listener();
    } catch {
      /* ignore subscriber errors */
    }
  }
  for (const repoListeners of repoListenersById.values()) {
    for (const listener of repoListeners) {
      try {
        listener();
      } catch {
        /* ignore subscriber errors */
      }
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

function outputPreviewEqual(
  a: RunCommandOutputLine[] | undefined,
  b: RunCommandOutputLine[],
): boolean {
  if (!a) return b.length === 0;
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i]!.text !== b[i]!.text || a[i]!.isError !== b[i]!.isError) return false;
  }
  return true;
}

function flushPendingRepoNotifies(): void {
  notifyRafHandle = null;
  if (pendingNotifyRepoIds.size === 0) return;
  const ids = [...pendingNotifyRepoIds];
  pendingNotifyRepoIds.clear();
  for (const repositoryId of ids) {
    notifyRepositoryRunCommandRuntime(repositoryId);
  }
}

function scheduleRepoNotify(repositoryId: number): void {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") {
    hiddenPublishPending = true;
    return;
  }
  pendingNotifyRepoIds.add(repositoryId);
  if (notifyRafHandle != null) return;
  if (typeof requestAnimationFrame === "function") {
    notifyRafHandle = requestAnimationFrame(() => {
      flushPendingRepoNotifies();
    });
    return;
  }
  flushPendingRepoNotifies();
}

function patchRepoState(repositoryId: number, patch: Partial<RepoRuntimeState>): void {
  const prev = getOrCreateRepoState(repositoryId);
  const next: RepoRuntimeState = {
    status: patch.status ?? prev.status,
    statusHint: patch.statusHint ?? prev.statusHint,
    outputPreview: patch.outputPreview ?? prev.outputPreview,
    detectedUrl: patch.detectedUrl !== undefined ? patch.detectedUrl : prev.detectedUrl,
  };
  if (
    next.status === prev.status &&
    next.statusHint === prev.statusHint &&
    next.detectedUrl === prev.detectedUrl &&
    outputPreviewEqual(prev.outputPreview, next.outputPreview)
  ) {
    return;
  }
  repoStateById.set(repositoryId, next);
  scheduleRepoNotify(repositoryId);
}

function flushHiddenPublishIfNeeded(): void {
  if (!hiddenPublishPending) return;
  hiddenPublishPending = false;
  if (notifyRafHandle != null) {
    if (typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(notifyRafHandle);
    }
    notifyRafHandle = null;
  }
  pendingNotifyRepoIds.clear();
  notifyAllRepositoryRunCommandRuntimeListeners();
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
    const { runKey, runUrlKey, runAutoOpenKey, runRestartKey } =
      repositoryRunCommandStorageKeys(runCwd);
    internals = {
      runCwd,
      runCommand: runKey ? (window.localStorage.getItem(runKey) ?? "") : "",
      runPreferredUrl: runUrlKey ? (window.localStorage.getItem(runUrlKey) ?? "") : "",
      runAutoOpenPageEnabled: readRunAutoOpenPageEnabled(runAutoOpenKey),
      runErrorMonitorEnabled: false,
      runRestart: readRunRestart(runRestartKey),
      runLogTail: "",
      runChunkBuffer: "",
      idleTimer: null,
      autoOpenFallbackTimer: null,
      autoOpenedRunUrl: false,
      errorDetected: false,
      configureRequested: false,
      autoFixSent: false,
      autoFixInFlight: false,
      lastDispatchAt: 0,
      dispatchedFingerprint: null,
      lastErrorFingerprint: null,
      loopCount: 0,
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
  // 进度条 / spinner 常用 \r 覆写同一行；把 \r 当换行会刷爆预览与 React 订阅。
  const plain = normalizeRunLogOutputChunk(chunk);
  const mixed = `${internals.runChunkBuffer}${plain}`;
  const parts = mixed.split("\n");
  internals.runChunkBuffer = parts.pop() ?? "";
  const nextLines = parts.map((line) => line.trim()).filter(Boolean);
  if (nextLines.length === 0) return;
  const mapped = nextLines.map((line) => ({ text: line.slice(0, 500), isError: lineHasRunLogIssue(line) }));
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
  const { runKey, runUrlKey, runAutoOpenKey, runRestartKey } =
    repositoryRunCommandStorageKeys(runCwd);
  internals.runCwd = runCwd;
  internals.runCommand = runKey ? (window.localStorage.getItem(runKey) ?? "") : "";
  internals.runPreferredUrl = runUrlKey ? (window.localStorage.getItem(runUrlKey) ?? "") : "";
  internals.runAutoOpenPageEnabled = readRunAutoOpenPageEnabled(runAutoOpenKey);
  internals.runRestart = readRunRestart(runRestartKey);
}

const RUN_ERROR_MONITOR_DISPATCH_DELAY_MS = 8_000;
/** 同一仓库两次成功指派的最短间隔，避免热更新 / 编译抖动连发。 */
const RUN_ERROR_MONITOR_MIN_INTERVAL_MS = 90_000;

function openRunPage(_repositoryId: number, _internals: RepoRuntimeInternals, url: string): void {
  void openExternalUrl(url);
}

function handleRepositoryRunnerTerminalOutput(repositoryId: number, data: string): void {
  const internals = repoInternalsById.get(repositoryId);
  if (!internals) return;

  const nextTail = `${internals.runLogTail}${data}`.slice(-10_000);
  internals.runLogTail = nextTail;
  appendRunOutputPreview(repositoryId, internals, data);
  const detected = detectRunUrlFromLogText(data) ?? detectRunUrlFromLogText(nextTail);
  if (detected) {
    if (internals.runAutoOpenPageEnabled && !internals.autoOpenedRunUrl) {
      internals.autoOpenedRunUrl = true;
      clearAutoOpenFallbackTimer(internals);
      const preferred = normalizeRunOpenUrl(internals.runPreferredUrl);
      const urlToOpen = preferred ?? detected;
      openRunPage(repositoryId, internals, urlToOpen);
      patchRepoState(repositoryId, {
        detectedUrl: detected,
        statusHint: `已自动打开地址：${urlToOpen}`,
      });
    } else {
      patchRepoState(repositoryId, { detectedUrl: detected });
    }
  }

  if (!internals.runErrorMonitorEnabled) {
    // 监控关闭时仍保留 idle 派发语义（若此前已标记 errorDetected）。
    armAutoFixDispatch(repositoryId, internals, true);
    return;
  }

  const chunkIssues = collectRunLogIssues(data);
  // 仅 error / http 触发自动修复；纯 warning（含过滤前残留）不当作派发条件。
  const actionableIssues = chunkIssues.filter((issue) => issue.kind !== "warning");
  if (actionableIssues.length === 0) {
    // 非报错输出：等日志稳定再派发（保留原 idle 语义，给偶发报错留缓冲）
    armAutoFixDispatch(repositoryId, internals, true);
    return;
  }

  const now = Date.now();
  const lastFpAt = lastErrorFingerprintAtByRepo.get(repositoryId) ?? 0;
  const shouldRefreshFingerprint =
    !internals.lastErrorFingerprint || now - lastFpAt >= ERROR_MONITOR_UI_THROTTLE_MS;
  if (shouldRefreshFingerprint) {
    internals.lastErrorFingerprint = buildRunErrorFingerprint(nextTail);
    lastErrorFingerprintAtByRepo.set(repositoryId, now);
  }
  const fingerprint = internals.lastErrorFingerprint ?? "";
  const decision = decideRunErrorMonitorStep({
    autoFixSent: internals.autoFixSent,
    dispatchedFingerprint: internals.dispatchedFingerprint,
    fingerprint,
    loopCount: internals.loopCount,
  });
  const kindSummary = summarizeRunLogIssueKinds(actionableIssues);
  if (decision.action === "arm-dispatch") {
    internals.errorDetected = true;
    if (internals.autoFixInFlight) {
      maybePatchErrorStatusHint(
        repositoryId,
        now,
        `检测到${kindSummary}，修复任务进行中，已合并等待…`,
      );
      return;
    }
    if (
      internals.lastDispatchAt > 0 &&
      now - internals.lastDispatchAt < RUN_ERROR_MONITOR_MIN_INTERVAL_MS
    ) {
      const remainSec = Math.ceil(
        (RUN_ERROR_MONITOR_MIN_INTERVAL_MS - (now - internals.lastDispatchAt)) / 1000,
      );
      maybePatchErrorStatusHint(
        repositoryId,
        now,
        `检测到${kindSummary}，自动修复冷却中（约 ${remainSec}s）`,
      );
      return;
    }
    if (!internals.configureRequested) {
      internals.configureRequested = true;
      globalOnRequestConfigure?.({ id: repositoryId, path: internals.runCwd });
    }
    maybePatchErrorStatusHint(repositoryId, now, `检测到${kindSummary}，等待自动处理...`);
    // 报错输出不重置派发倒计时，避免循环报错持续输出导致首次派发永不触发
    armAutoFixDispatch(repositoryId, internals, false);
  } else if (decision.action === "report-loop") {
    internals.loopCount = decision.loopCount;
    maybePatchErrorStatusHint(
      repositoryId,
      now,
      `循环${kindSummary}(第 ${decision.loopCount} 次)，AI 已尝试，建议人工介入`,
    );
  } else {
    maybePatchErrorStatusHint(
      repositoryId,
      now,
      `检测到新的${kindSummary}，本次运行 AI 已介入，建议人工介入`,
    );
  }
}

function maybePatchErrorStatusHint(repositoryId: number, now: number, statusHint: string): void {
  const prev = getOrCreateRepoState(repositoryId);
  if (prev.statusHint === statusHint) return;
  const lastAt = lastErrorMonitorUiAtByRepo.get(repositoryId) ?? 0;
  // 节流「第 N 次」等连续变化文案，避免每个报错 chunk 都打到 React。
  if (now - lastAt < ERROR_MONITOR_UI_THROTTLE_MS) return;
  lastErrorMonitorUiAtByRepo.set(repositoryId, now);
  patchRepoState(repositoryId, { statusHint });
}

function armAutoFixDispatch(
  repositoryId: number,
  internals: RepoRuntimeInternals,
  reset: boolean,
): void {
  if (reset) clearIdleTimer(internals);
  if (internals.idleTimer != null) return;
  internals.idleTimer = window.setTimeout(() => {
    void fireAutoFixDispatch(repositoryId, internals);
  }, RUN_ERROR_MONITOR_DISPATCH_DELAY_MS);
}

async function fireAutoFixDispatch(
  repositoryId: number,
  internals: RepoRuntimeInternals,
): Promise<void> {
  internals.idleTimer = null;
  if (!internals.errorDetected || internals.autoFixSent) return;
  if (internals.autoFixInFlight) return;
  if (!globalOnAutoFixRunError) {
    patchRepoState(repositoryId, { statusHint: "自动修复未就绪：指派通道不可用" });
    return;
  }
  const now = Date.now();
  if (
    internals.lastDispatchAt > 0 &&
    now - internals.lastDispatchAt < RUN_ERROR_MONITOR_MIN_INTERVAL_MS
  ) {
    const remainSec = Math.ceil(
      (RUN_ERROR_MONITOR_MIN_INTERVAL_MS - (now - internals.lastDispatchAt)) / 1000,
    );
    patchRepoState(repositoryId, {
      statusHint: `自动修复冷却中（约 ${remainSec}s 后再处理）`,
    });
    return;
  }
  internals.autoFixSent = true;
  internals.autoFixInFlight = true;
  const command = internals.runCommand.trim();
  const tail = internals.runLogTail;
  const dedupKey = buildRunErrorMonitorDedupKey(internals.runCwd, command, tail);
  if (shouldSkipRunErrorMonitorSend(dedupKey, now)) {
    internals.autoFixSent = false;
    internals.autoFixInFlight = false;
    patchRepoState(repositoryId, { statusHint: "检测到重复报错，已跳过重复发送" });
    return;
  }
  // 派发前用完整日志尾刷新指纹，避免流式节流导致指纹落后。
  internals.lastErrorFingerprint = buildRunErrorFingerprint(tail);
  internals.dispatchedFingerprint = internals.lastErrorFingerprint;
  internals.loopCount = 1;
  const prompt = buildRunErrorAutoFixPrompt({ command, tailText: tail });
  try {
    const started = await Promise.resolve(globalOnAutoFixRunError(prompt));
    if (started === false) {
      internals.autoFixSent = false;
      internals.dispatchedFingerprint = null;
      internals.loopCount = 0;
      patchRepoState(repositoryId, { statusHint: "自动修复指派未启动，请检查会话是否可用后重试" });
      message.warning("运行指令自动修复未启动：会话可能忙碌、未就绪或已达并发上限。");
      return;
    }
    internals.lastDispatchAt = Date.now();
    patchRepoState(repositoryId, { statusHint: "已指派独立会话自动修复（不占用主窗口）" });
  } catch (error) {
    internals.autoFixSent = false;
    internals.dispatchedFingerprint = null;
    internals.loopCount = 0;
    const msgText = error instanceof Error ? error.message : String(error);
    patchRepoState(repositoryId, { statusHint: `自动修复派发失败：${msgText}` });
    message.error(`运行指令自动修复派发失败：${msgText}`);
  } finally {
    internals.autoFixInFlight = false;
  }
}

function ensureTerminalListeners(): void {
  if (terminalListenersReady) return;
  terminalListenersReady = true;
  ensureVisibilityFlushListener();

  terminalOutputUnlisten = subscribeTerminalOutput((payload) => {
    const repositoryId = Number(payload.workspaceId);
    if (!Number.isFinite(repositoryId)) return;
    if (payload.terminalId !== REPOSITORY_RUNNER_TERMINAL_ID) return;
    handleRepositoryRunnerTerminalOutput(repositoryId, payload.data);
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
          { text: remain, isError: lineHasRunLogIssue(remain) },
        ].slice(-8),
      });
    }
    internals.runChunkBuffer = "";
    lastErrorMonitorUiAtByRepo.delete(repositoryId);
    lastErrorFingerprintAtByRepo.delete(repositoryId);
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
  globalListeners.add(listener);
  return () => globalListeners.delete(listener);
}

export function subscribeRepositoryRunCommandRuntimeForRepository(
  repositoryId: number,
  listener: () => void,
): () => void {
  let set = repoListenersById.get(repositoryId);
  if (!set) {
    set = new Set();
    repoListenersById.set(repositoryId, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) repoListenersById.delete(repositoryId);
  };
}

/** @internal */
export function notifyRepositoryRunCommandRuntimeForTests(repositoryId: number): void {
  notifyRepositoryRunCommandRuntime(repositoryId);
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
  if (changed) notifyAllRepositoryRunCommandRuntimeListeners();
}

export function setRepositoryRunCommandAutoFixHandler(
  handler: ((prompt: string) => void | boolean | Promise<void | boolean>) | undefined,
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
  const rawCmd = (input.commandOverride ?? internals.runCommand).trim();
  if (!rawCmd) {
    input.onRequestConfigure?.() ?? globalOnRequestConfigure?.(repository);
    return;
  }
  // 启用「退出后自动重启」时，把指令包装成 shell 循环：异常退出（非 0 且非
  // Ctrl+C 的 130）等待设定间隔后自动重启；正常退出或 Ctrl+C 则停止循环。
  const cmd = internals.runRestart.enabled
    ? wrapCommandWithAutoRestart(rawCmd, internals.runRestart.intervalSeconds)
    : rawCmd;
  try {
    await openTerminalSession(String(repository.id), REPOSITORY_RUNNER_TERMINAL_ID, 120, 36, runCwd).catch(
      () => {
        /* ignore "already opened" */
      },
    );
    internals.errorDetected = false;
    internals.configureRequested = false;
    internals.autoFixSent = false;
    internals.autoFixInFlight = false;
    internals.lastDispatchAt = 0;
    internals.dispatchedFingerprint = null;
    internals.lastErrorFingerprint = null;
    internals.loopCount = 0;
    internals.autoOpenedRunUrl = false;
    internals.runLogTail = "";
    internals.runChunkBuffer = "";
    lastErrorMonitorUiAtByRepo.delete(repository.id);
    lastErrorFingerprintAtByRepo.delete(repository.id);
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
        openRunPage(repository.id, internals, fallbackUrl);
        patchRepoState(repository.id, {
          statusHint: `已自动打开地址：${fallbackUrl}`,
        });
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

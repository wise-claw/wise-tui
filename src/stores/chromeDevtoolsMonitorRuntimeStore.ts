import { message } from "antd";
import { subscribeChromeDevtoolsIssue } from "../services/events";
import {
  buildPageMonitorAutoFixPrompt,
  formatChromeDevtoolsIssueLine,
  isPageMonitorDiagnosticKind,
  isPageMonitorIgnorableNoise,
  normalizePageMonitorChromeMode,
  normalizePageMonitorDebugPort,
  startChromeDevtoolsMonitor,
  stopChromeDevtoolsMonitor,
  type ChromeDevtoolsIssue,
  type PageMonitorChromeMode,
} from "../services/chromeDevtoolsMonitor";
import {
  buildRunErrorFingerprint,
  buildRunErrorMonitorDedupKey,
  collectRunLogIssues,
  decideRunErrorMonitorStep,
  normalizeRunOpenUrl,
  shouldSkipRunErrorMonitorSend,
  summarizeRunLogIssueKinds,
} from "../utils/repositoryRunCommand";

export type PageMonitorStatus = "idle" | "starting" | "monitoring" | "stopping";

export type PageMonitorIssueLine = {
  text: string;
  kind: string;
};

export type PageMonitorRuntimeState = {
  status: PageMonitorStatus;
  statusHint: string;
  url: string;
  autoFixEnabled: boolean;
  issuePreview: PageMonitorIssueLine[];
};

type SessionInternals = {
  url: string;
  autoFixEnabled: boolean;
  issueTail: string;
  idleTimer: number | null;
  errorDetected: boolean;
  autoFixSent: boolean;
  /** 正在 createSession / execute，防止并发二次指派。 */
  autoFixInFlight: boolean;
  lastDispatchAt: number;
  dispatchedFingerprint: string | null;
  lastErrorFingerprint: string | null;
  loopCount: number;
};

const DEFAULT_STATE: PageMonitorRuntimeState = {
  status: "idle",
  statusHint: "未监控",
  url: "",
  autoFixEnabled: true,
  issuePreview: [],
};

const stateBySessionId = new Map<string, PageMonitorRuntimeState>();
const internalsBySessionId = new Map<string, SessionInternals>();
const listenersBySessionId = new Map<string, Set<() => void>>();
const globalListeners = new Set<() => void>();

let globalOnAutoFix:
  | ((
      prompt: string,
      meta: { sessionId: string },
    ) => void | boolean | Promise<void | boolean>)
  | undefined;
let issueListenerReady = false;
let issueUnlisten: (() => void) | null = null;

const AUTO_FIX_DELAY_MS = 8_000;
/** 同一监控会话两次成功指派的最短间隔，避免热更新抖动连发。 */
const AUTO_FIX_MIN_INTERVAL_MS = 90_000;

function notify(sessionId: string): void {
  const set = listenersBySessionId.get(sessionId);
  if (set) {
    for (const listener of set) {
      try {
        listener();
      } catch {
        /* ignore */
      }
    }
  }
  for (const listener of globalListeners) {
    try {
      listener();
    } catch {
      /* ignore */
    }
  }
}

function getOrCreateState(sessionId: string): PageMonitorRuntimeState {
  let state = stateBySessionId.get(sessionId);
  if (!state) {
    state = { ...DEFAULT_STATE };
    stateBySessionId.set(sessionId, state);
  }
  return state;
}

function patchState(sessionId: string, patch: Partial<PageMonitorRuntimeState>): void {
  const prev = getOrCreateState(sessionId);
  stateBySessionId.set(sessionId, { ...prev, ...patch });
  notify(sessionId);
}

function getOrCreateInternals(sessionId: string): SessionInternals {
  let internals = internalsBySessionId.get(sessionId);
  if (!internals) {
    internals = {
      url: "",
      autoFixEnabled: true,
      issueTail: "",
      idleTimer: null,
      errorDetected: false,
      autoFixSent: false,
      autoFixInFlight: false,
      lastDispatchAt: 0,
      dispatchedFingerprint: null,
      lastErrorFingerprint: null,
      loopCount: 0,
    };
    internalsBySessionId.set(sessionId, internals);
  }
  return internals;
}

function clearIdleTimer(internals: SessionInternals): void {
  if (internals.idleTimer == null) return;
  window.clearTimeout(internals.idleTimer);
  internals.idleTimer = null;
}

function armAutoFixDispatch(sessionId: string, internals: SessionInternals, reset: boolean): void {
  if (!internals.autoFixEnabled) return;
  if (reset) clearIdleTimer(internals);
  if (internals.idleTimer != null) return;
  internals.idleTimer = window.setTimeout(() => {
    void fireAutoFixDispatch(sessionId, internals);
  }, AUTO_FIX_DELAY_MS);
}

async function fireAutoFixDispatch(sessionId: string, internals: SessionInternals): Promise<void> {
  internals.idleTimer = null;
  if (!internals.autoFixEnabled || !internals.errorDetected || internals.autoFixSent) return;
  if (internals.autoFixInFlight) return;
  if (!globalOnAutoFix) {
    patchState(sessionId, { statusHint: "自动修复未就绪：指派通道不可用" });
    return;
  }
  const issuesSnapshot = internals.issueTail;
  if (!issuesSnapshot.trim()) return;

  const now = Date.now();
  if (internals.lastDispatchAt > 0 && now - internals.lastDispatchAt < AUTO_FIX_MIN_INTERVAL_MS) {
    const remainSec = Math.ceil(
      (AUTO_FIX_MIN_INTERVAL_MS - (now - internals.lastDispatchAt)) / 1000,
    );
    patchState(sessionId, {
      statusHint: `自动修复冷却中（约 ${remainSec}s 后再处理）`,
    });
    return;
  }

  const dedupKey = buildRunErrorMonitorDedupKey(
    `page-monitor:${sessionId}`,
    internals.url,
    issuesSnapshot,
  );
  if (shouldSkipRunErrorMonitorSend(dedupKey, now)) {
    patchState(sessionId, { statusHint: "检测到重复问题，已跳过重复发送" });
    return;
  }

  internals.autoFixSent = true;
  internals.autoFixInFlight = true;
  internals.dispatchedFingerprint = internals.lastErrorFingerprint;
  internals.loopCount = 1;
  const prompt = buildPageMonitorAutoFixPrompt({
    url: internals.url,
    issuesText: issuesSnapshot,
  });
  try {
    const started = await Promise.resolve(globalOnAutoFix(prompt, { sessionId }));
    if (started === false) {
      internals.autoFixSent = false;
      internals.dispatchedFingerprint = null;
      internals.loopCount = 0;
      patchState(sessionId, { statusHint: "自动修复指派未启动，请稍后重试" });
      message.warning("页面监控自动修复未启动：可能已达并发上限或会话未就绪。");
      return;
    }
    internals.lastDispatchAt = Date.now();
    // 已派出的问题从待派发缓冲清掉，后续新报错可形成新指纹并连续指派。
    if (internals.issueTail.startsWith(issuesSnapshot)) {
      internals.issueTail = internals.issueTail.slice(issuesSnapshot.length);
    } else {
      internals.issueTail = "";
    }
    patchState(sessionId, { statusHint: "已指派独立会话自动修复（不占用主窗口）" });
  } catch (error) {
    internals.autoFixSent = false;
    internals.dispatchedFingerprint = null;
    internals.loopCount = 0;
    const msgText = error instanceof Error ? error.message : String(error);
    patchState(sessionId, { statusHint: `自动修复指派失败：${msgText}` });
    message.error(`页面监控自动修复指派失败：${msgText}`);
  } finally {
    internals.autoFixInFlight = false;
  }
}

function handleIssue(payload: ChromeDevtoolsIssue): void {
  const sessionId = (payload.sessionId ?? "").trim();
  if (!sessionId) return;
  const state = stateBySessionId.get(sessionId);
  const internals = internalsBySessionId.get(sessionId);
  if (!state || !internals) return;
  if (state.status !== "monitoring" && state.status !== "starting") return;

  const line = formatChromeDevtoolsIssueLine(payload);
  if (isPageMonitorIgnorableNoise(line) || isPageMonitorIgnorableNoise(payload.message ?? "")) {
    return;
  }
  const issues = collectRunLogIssues(`${line}\n`);
  const diagnostic = isPageMonitorDiagnosticKind(payload.kind);
  if (issues.length === 0 && !diagnostic) return;

  const preview = [
    ...state.issuePreview,
    { text: line, kind: issues[0]?.kind ?? "info" },
  ].slice(-12);

  // 性能 / 耗时类诊断：仅展示，不进修复指纹，也不触发 AI 自动修复。
  if (issues.length === 0) {
    patchState(sessionId, { issuePreview: preview });
    return;
  }

  internals.issueTail = `${internals.issueTail}${line}\n`.slice(-10_000);
  const kindSummary = summarizeRunLogIssueKinds(issues);

  const fingerprint = buildRunErrorFingerprint(internals.issueTail);
  internals.lastErrorFingerprint = fingerprint;
  const decision = decideRunErrorMonitorStep({
    autoFixSent: internals.autoFixSent,
    dispatchedFingerprint: internals.dispatchedFingerprint,
    fingerprint,
    loopCount: internals.loopCount,
    continuous: true,
  });

  if (decision.action === "arm-dispatch") {
    internals.errorDetected = true;
    if (internals.autoFixInFlight) {
      patchState(sessionId, {
        issuePreview: preview,
        statusHint: `检测到${kindSummary}，修复任务进行中，已合并等待…`,
      });
      return;
    }
    const now = Date.now();
    if (
      internals.lastDispatchAt > 0 &&
      now - internals.lastDispatchAt < AUTO_FIX_MIN_INTERVAL_MS
    ) {
      const remainSec = Math.ceil(
        (AUTO_FIX_MIN_INTERVAL_MS - (now - internals.lastDispatchAt)) / 1000,
      );
      patchState(sessionId, {
        issuePreview: preview,
        statusHint: `检测到${kindSummary}，自动修复冷却中（约 ${remainSec}s）`,
      });
      return;
    }
    // 连续模式：新指纹再次排程时放开派发锁，并重置空闲计时以合并短时间内的后续报错。
    if (internals.autoFixSent) {
      internals.autoFixSent = false;
      clearIdleTimer(internals);
    }
    patchState(sessionId, {
      issuePreview: preview,
      statusHint: internals.autoFixEnabled
        ? `检测到${kindSummary}，等待自动处理...`
        : `检测到${kindSummary}`,
    });
    armAutoFixDispatch(sessionId, internals, false);
  } else if (decision.action === "report-loop") {
    internals.loopCount = decision.loopCount;
    patchState(sessionId, {
      issuePreview: preview,
      statusHint: `循环${kindSummary}(第 ${decision.loopCount} 次)，AI 已尝试，建议人工介入`,
    });
  } else {
    patchState(sessionId, {
      issuePreview: preview,
      statusHint: `检测到新的${kindSummary}，本次监控 AI 已介入，建议人工介入`,
    });
  }
}

function ensureIssueListener(): void {
  if (issueListenerReady) return;
  issueListenerReady = true;
  issueUnlisten = subscribeChromeDevtoolsIssue((payload) => {
    handleIssue(payload);
  });
}

export function subscribePageMonitorRuntime(listener: () => void): () => void {
  globalListeners.add(listener);
  return () => globalListeners.delete(listener);
}

export function subscribePageMonitorRuntimeForSession(
  sessionId: string,
  listener: () => void,
): () => void {
  const id = sessionId.trim();
  let set = listenersBySessionId.get(id);
  if (!set) {
    set = new Set();
    listenersBySessionId.set(id, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) listenersBySessionId.delete(id);
  };
}

export function getPageMonitorRuntimeSnapshot(sessionId: string): PageMonitorRuntimeState {
  return getOrCreateState(sessionId.trim());
}

export function setPageMonitorAutoFixHandler(
  handler:
    | ((
        prompt: string,
        meta: { sessionId: string },
      ) => void | boolean | Promise<void | boolean>)
    | undefined,
): void {
  globalOnAutoFix = handler;
}

/** Mark UI after monitored page was refreshed post auto-fix. */
export function notifyPageMonitorReloaded(sessionId: string): void {
  const id = sessionId.trim();
  if (!id) return;
  const state = stateBySessionId.get(id);
  if (!state) return;
  if (state.status !== "monitoring" && state.status !== "starting") return;
  patchState(id, { statusHint: "修复完成，已刷新监控页面，继续监听…" });
}

export function syncPageMonitorFormState(
  sessionId: string,
  input: { url: string; autoFixEnabled: boolean },
): void {
  const id = sessionId.trim();
  if (!id) return;
  const internals = getOrCreateInternals(id);
  internals.url = input.url;
  internals.autoFixEnabled = input.autoFixEnabled;
  patchState(id, { url: input.url, autoFixEnabled: input.autoFixEnabled });
}

export async function startPageMonitor(input: {
  sessionId: string;
  url: string;
  autoFixEnabled?: boolean;
  mode?: PageMonitorChromeMode;
  debugPort?: number;
}): Promise<void> {
  ensureIssueListener();
  const sessionId = input.sessionId.trim();
  const normalized = normalizeRunOpenUrl(input.url);
  if (!sessionId) {
    message.warning("缺少会话，无法启动页面监控。");
    return;
  }
  if (!normalized) {
    message.warning("请输入有效的访问地址（http/https）。");
    return;
  }

  const mode = normalizePageMonitorChromeMode(input.mode);
  const debugPort = normalizePageMonitorDebugPort(input.debugPort);
  const internals = getOrCreateInternals(sessionId);
  clearIdleTimer(internals);
  internals.url = normalized;
  internals.autoFixEnabled = input.autoFixEnabled ?? internals.autoFixEnabled;
  internals.issueTail = "";
  internals.errorDetected = false;
  internals.autoFixSent = false;
  internals.autoFixInFlight = false;
  internals.lastDispatchAt = 0;
  internals.dispatchedFingerprint = null;
  internals.lastErrorFingerprint = null;
  internals.loopCount = 0;

  const startingHint =
    mode === "attach"
      ? `正在附着 Chrome 调试口 ${debugPort}…`
      : mode === "extension"
        ? "正在启动扩展桥（等待 Chrome 扩展附着）…"
        : "正在启动独立 Chrome 监控…";

  patchState(sessionId, {
    status: "starting",
    statusHint: startingHint,
    url: normalized,
    autoFixEnabled: internals.autoFixEnabled,
    issuePreview: [],
  });

  try {
    await startChromeDevtoolsMonitor({
      sessionId,
      url: normalized,
      mode,
      debugPort: mode === "attach" ? debugPort : undefined,
    });
    const modeHint =
      mode === "attach"
        ? `附着 :${debugPort}`
        : mode === "extension"
          ? "Chrome 扩展"
          : "独立窗口";
    patchState(sessionId, {
      status: "monitoring",
      statusHint: internals.autoFixEnabled
        ? `监控中（${modeHint} · AI 自动修复已开）：${normalized}`
        : `监控中（${modeHint}）：${normalized}`,
    });
  } catch (error) {
    const msgText = error instanceof Error ? error.message : String(error);
    patchState(sessionId, {
      status: "idle",
      statusHint: `启动失败：${msgText}`,
    });
    message.error(`页面监控启动失败：${msgText}`);
  }
}

export async function stopPageMonitor(sessionId: string): Promise<void> {
  const id = sessionId.trim();
  if (!id) return;
  const internals = internalsBySessionId.get(id);
  if (internals) clearIdleTimer(internals);
  patchState(id, { status: "stopping", statusHint: "停止中…" });
  try {
    await stopChromeDevtoolsMonitor(id);
    patchState(id, {
      status: "idle",
      statusHint: "已停止监控",
    });
  } catch (error) {
    const msgText = error instanceof Error ? error.message : String(error);
    patchState(id, {
      status: "idle",
      statusHint: `停止失败：${msgText}`,
    });
    message.error(`停止页面监控失败：${msgText}`);
  }
}

export async function togglePageMonitor(input: {
  sessionId: string;
  url: string;
  autoFixEnabled?: boolean;
  mode?: PageMonitorChromeMode;
  debugPort?: number;
}): Promise<void> {
  const state = getPageMonitorRuntimeSnapshot(input.sessionId);
  if (state.status === "monitoring" || state.status === "starting" || state.status === "stopping") {
    await stopPageMonitor(input.sessionId);
    return;
  }
  await startPageMonitor(input);
}

/** @internal */
export function resetPageMonitorRuntimeForTests(): void {
  for (const internals of internalsBySessionId.values()) {
    clearIdleTimer(internals);
  }
  stateBySessionId.clear();
  internalsBySessionId.clear();
  listenersBySessionId.clear();
  globalListeners.clear();
  globalOnAutoFix = undefined;
  if (issueUnlisten) {
    issueUnlisten();
    issueUnlisten = null;
  }
  issueListenerReady = false;
}

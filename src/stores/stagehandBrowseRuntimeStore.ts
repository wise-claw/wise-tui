import {
  formatStagehandResult,
  parseObserveActions,
  parseStagehandPageStatus,
  type StagehandBrowseProbe,
  type StagehandObserveAction,
  type StagehandPageStatus,
} from "../services/stagehandBrowse";

export type StagehandBrowseStatus = "idle" | "starting" | "running" | "stopping";

export type StagehandBrowseLogLine = {
  at: number;
  kind: "info" | "error" | "result";
  text: string;
};

export type StagehandBrowseRuntimeState = {
  status: StagehandBrowseStatus;
  statusHint: string;
  probe: StagehandBrowseProbe | null;
  screenshotPath: string | null;
  pageUrl: string | null;
  pageTitle: string | null;
  observeActions: StagehandObserveAction[];
  logs: StagehandBrowseLogLine[];
};

const DEFAULT_STATE: StagehandBrowseRuntimeState = {
  status: "idle",
  statusHint: "未启动",
  probe: null,
  screenshotPath: null,
  pageUrl: null,
  pageTitle: null,
  observeActions: [],
  logs: [],
};

const stateBySessionId = new Map<string, StagehandBrowseRuntimeState>();
const listenersBySessionId = new Map<string, Set<() => void>>();

function getOrCreate(sessionId: string): StagehandBrowseRuntimeState {
  const existing = stateBySessionId.get(sessionId);
  if (existing) return existing;
  const next = {
    ...DEFAULT_STATE,
    logs: [] as StagehandBrowseLogLine[],
    observeActions: [] as StagehandObserveAction[],
  };
  stateBySessionId.set(sessionId, next);
  return next;
}

function emit(sessionId: string) {
  const listeners = listenersBySessionId.get(sessionId);
  if (!listeners) return;
  for (const listener of listeners) listener();
}

export function getStagehandBrowseRuntimeSnapshot(sessionId: string): StagehandBrowseRuntimeState {
  return getOrCreate(sessionId);
}

export function subscribeStagehandBrowseRuntime(
  sessionId: string,
  listener: () => void,
): () => void {
  let set = listenersBySessionId.get(sessionId);
  if (!set) {
    set = new Set();
    listenersBySessionId.set(sessionId, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
    if (set && set.size === 0) listenersBySessionId.delete(sessionId);
  };
}

export function setStagehandBrowseProbe(sessionId: string, probe: StagehandBrowseProbe | null) {
  const state = getOrCreate(sessionId);
  state.probe = probe;
  emit(sessionId);
}

export function setStagehandBrowseStatus(
  sessionId: string,
  status: StagehandBrowseStatus,
  statusHint: string,
) {
  const state = getOrCreate(sessionId);
  state.status = status;
  state.statusHint = statusHint;
  if (status === "idle") {
    state.pageUrl = null;
    state.pageTitle = null;
    state.observeActions = [];
  }
  emit(sessionId);
}

export function setStagehandBrowsePage(sessionId: string, page: StagehandPageStatus) {
  const state = getOrCreate(sessionId);
  state.pageUrl = page.url;
  state.pageTitle = page.title;
  if (page.running && state.status === "idle") {
    state.status = "running";
    state.statusHint = page.title || page.url || "运行中";
  } else if (page.title || page.url) {
    state.statusHint = page.title || page.url || state.statusHint;
  }
  emit(sessionId);
}

export function setStagehandBrowseObserveActions(
  sessionId: string,
  actions: StagehandObserveAction[],
) {
  const state = getOrCreate(sessionId);
  state.observeActions = actions;
  emit(sessionId);
}

export function appendStagehandBrowseLog(
  sessionId: string,
  kind: StagehandBrowseLogLine["kind"],
  text: string,
) {
  const state = getOrCreate(sessionId);
  const line = { at: Date.now(), kind, text };
  state.logs = [...state.logs.slice(-79), line];
  emit(sessionId);
}

export function setStagehandBrowseScreenshot(sessionId: string, path: string | null) {
  const state = getOrCreate(sessionId);
  state.screenshotPath = path;
  emit(sessionId);
}

export function recordStagehandBrowseResult(sessionId: string, label: string, result: unknown) {
  appendStagehandBrowseLog(sessionId, "result", `${label}\n${formatStagehandResult(result)}`);
  if (result && typeof result === "object" && "path" in result) {
    const path = (result as { path?: unknown }).path;
    if (typeof path === "string" && path.trim()) {
      setStagehandBrowseScreenshot(sessionId, path.trim());
    }
  }
  const page = parseStagehandPageStatus(result);
  if (page.url || page.title) {
    setStagehandBrowsePage(sessionId, page);
  }
  const actions = parseObserveActions(result);
  if (actions.length > 0) {
    setStagehandBrowseObserveActions(sessionId, actions);
  }
}

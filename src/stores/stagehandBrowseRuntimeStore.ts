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
  pageCount: number;
  authSummary: string | null;
  cookieCount: number;
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
  pageCount: 0,
  authSummary: null,
  cookieCount: 0,
  observeActions: [],
  logs: [],
};

const stateBySessionId = new Map<string, StagehandBrowseRuntimeState>();
const listenersBySessionId = new Map<string, Set<() => void>>();

function normalizeSessionId(sessionId: string): string {
  return sessionId.trim();
}

function createDefaultState(): StagehandBrowseRuntimeState {
  return {
    ...DEFAULT_STATE,
    logs: [] as StagehandBrowseLogLine[],
    observeActions: [] as StagehandObserveAction[],
  };
}

function emit(sessionId: string) {
  const listeners = listenersBySessionId.get(sessionId);
  if (!listeners) return;
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      console.warn("[wise:stagehand-runtime] listener threw", error);
    }
  }
}

function updateState(
  sessionId: string,
  updater: (current: StagehandBrowseRuntimeState) => StagehandBrowseRuntimeState,
): void {
  const key = normalizeSessionId(sessionId);
  if (!key) return;
  const current = stateBySessionId.get(key) ?? createDefaultState();
  const next = updater(current);
  if (next === current) return;
  stateBySessionId.set(key, next);
  emit(key);
}

export function getStagehandBrowseRuntimeSnapshot(sessionId: string): StagehandBrowseRuntimeState {
  const key = normalizeSessionId(sessionId);
  return (key && stateBySessionId.get(key)) || DEFAULT_STATE;
}

export function subscribeStagehandBrowseRuntime(
  sessionId: string,
  listener: () => void,
): () => void {
  const key = normalizeSessionId(sessionId);
  if (!key) return () => {};
  let set = listenersBySessionId.get(key);
  if (!set) {
    set = new Set();
    listenersBySessionId.set(key, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
    if (set && set.size === 0) listenersBySessionId.delete(key);
  };
}

export function setStagehandBrowseProbe(sessionId: string, probe: StagehandBrowseProbe | null) {
  updateState(sessionId, (state) =>
    state.probe === probe ? state : { ...state, probe },
  );
}

export function setStagehandBrowseStatus(
  sessionId: string,
  status: StagehandBrowseStatus,
  statusHint: string,
) {
  updateState(sessionId, (state) => {
    const next = {
      ...state,
      status,
      statusHint,
      ...(status === "idle"
        ? {
            pageUrl: null,
            pageTitle: null,
            pageCount: 0,
            authSummary: null,
            cookieCount: 0,
            observeActions:
              state.observeActions.length > 0
                ? ([] as StagehandObserveAction[])
                : state.observeActions,
          }
        : {}),
    };
    if (
      state.status === next.status &&
      state.statusHint === next.statusHint &&
      state.pageUrl === next.pageUrl &&
      state.pageTitle === next.pageTitle &&
      state.pageCount === next.pageCount &&
      state.authSummary === next.authSummary &&
      state.cookieCount === next.cookieCount &&
      state.observeActions === next.observeActions
    ) {
      return state;
    }
    return next;
  });
}

export function setStagehandBrowsePage(sessionId: string, page: StagehandPageStatus) {
  updateState(sessionId, (state) => {
    const status = page.running && state.status === "idle" ? "running" : state.status;
    const statusHint =
      page.running && state.status === "idle"
        ? page.title || page.url || "运行中"
        : page.title || page.url || state.statusHint;
    if (
      state.pageUrl === page.url &&
      state.pageTitle === page.title &&
      state.pageCount === page.pageCount &&
      state.authSummary === page.authSummary &&
      state.cookieCount === page.cookieCount &&
      state.status === status &&
      state.statusHint === statusHint
    ) {
      return state;
    }
    return {
      ...state,
      pageUrl: page.url,
      pageTitle: page.title,
      pageCount: page.pageCount,
      authSummary: page.authSummary,
      cookieCount: page.cookieCount,
      status,
      statusHint,
    };
  });
}

export function setStagehandBrowseObserveActions(
  sessionId: string,
  actions: StagehandObserveAction[],
) {
  updateState(sessionId, (state) =>
    state.observeActions === actions ? state : { ...state, observeActions: actions },
  );
}

export function appendStagehandBrowseLog(
  sessionId: string,
  kind: StagehandBrowseLogLine["kind"],
  text: string,
) {
  updateState(sessionId, (state) => {
    const line = { at: Date.now(), kind, text };
    return { ...state, logs: [...state.logs.slice(-79), line] };
  });
}

export function setStagehandBrowseScreenshot(sessionId: string, path: string | null) {
  updateState(sessionId, (state) =>
    state.screenshotPath === path ? state : { ...state, screenshotPath: path },
  );
}

/** @internal test helper */
export function resetStagehandBrowseRuntimeForTests(): void {
  stateBySessionId.clear();
  listenersBySessionId.clear();
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

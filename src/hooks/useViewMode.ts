import { useCallback, useMemo, useReducer } from "react";
import {
  DEFAULT_COCKPIT_HUB_PANE,
  DEFAULT_VIEW_MODE,
  resolveCockpitHubPane,
  type AuthorPane,
  type CockpitHubPane,
  type InspectMcpHub,
  type InspectSkillsHub,
  type InspectTool,
  type ViewMode,
} from "../types/viewMode";

function isHubOverlayInspectTool(
  tool: InspectTool,
): tool is InspectMcpHub | InspectSkillsHub {
  return tool.kind === "mcp-hub" || tool.kind === "skills-hub";
}

/**
 * 顶层 View 状态机（参见 `.trellis/spec/guides/agent-harness-architecture.md` §3）。
 */
type ViewModeAction =
  | { type: "enter"; mode: ViewMode }
  | { type: "back" }
  | { type: "patch"; partial: ViewModePatch };

/** `patch` 的语义：仅当当前 view 与 partial 同 kind 时，浅合并字段。 */
type ViewModePatch = { kind: "cockpit"; hubPane?: CockpitHubPane };

interface ViewModeState {
  current: ViewMode;
  /** 上一视图（深度 1 历史栈）。null 表示无历史。 */
  prev: ViewMode | null;
}

function viewsEqual(a: ViewMode, b: ViewMode): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "author" && b.kind === "author") return a.pane === b.pane;
  if (a.kind === "cockpit" && b.kind === "cockpit") {
    return resolveCockpitHubPane(a) === resolveCockpitHubPane(b);
  }
  if (a.kind === "inspect" && b.kind === "inspect") {
    return a.tool.kind === b.tool.kind;
  }
  return true;
}

function viewModeReducer(prev: ViewModeState, action: ViewModeAction): ViewModeState {
  switch (action.type) {
    case "enter": {
      if (viewsEqual(prev.current, action.mode)) return prev;
      if (prev.current.kind === "author" && action.mode.kind === "author") {
        return { current: action.mode, prev: prev.prev };
      }
      if (prev.current.kind === "cockpit" && action.mode.kind === "cockpit") {
        return { current: action.mode, prev: prev.prev };
      }
      if (
        prev.current.kind === "inspect" &&
        action.mode.kind === "inspect" &&
        isHubOverlayInspectTool(prev.current.tool) &&
        isHubOverlayInspectTool(action.mode.tool)
      ) {
        return { current: action.mode, prev: prev.prev };
      }
      return { current: action.mode, prev: prev.current };
    }
    case "back": {
      if (prev.prev) return { current: prev.prev, prev: null };
      if (viewsEqual(prev.current, DEFAULT_VIEW_MODE)) return prev;
      return { current: DEFAULT_VIEW_MODE, prev: null };
    }
    case "patch": {
      const view = prev.current;
      if (view.kind !== action.partial.kind) return prev;
      if (action.partial.kind === "cockpit" && view.kind === "cockpit") {
        return { ...prev, current: { ...view, ...action.partial } };
      }
      return prev;
    }
  }
}

export interface UseViewModeApi {
  view: ViewMode;
  enter: (mode: ViewMode) => void;
  back: () => void;
  patch: (partial: ViewModePatch) => void;
  isChat: boolean;
  isCockpit: boolean;
  isAuthor: boolean;
  isInspect: boolean;
  legacy: {
    mcpHubMode: boolean;
    skillsHubMode: boolean;
    missionControlMode: boolean;
  };
}

export function useViewMode(initial: ViewMode = DEFAULT_VIEW_MODE): UseViewModeApi {
  const [state, dispatch] = useReducer(viewModeReducer, { current: initial, prev: null });
  const view = state.current;

  const enter = useCallback((mode: ViewMode) => {
    dispatch({ type: "enter", mode });
  }, []);

  const back = useCallback(() => {
    dispatch({ type: "back" });
  }, []);

  const patch = useCallback((partial: ViewModePatch) => {
    dispatch({ type: "patch", partial });
  }, []);

  const isChat = view.kind === "chat";
  const isCockpit = view.kind === "cockpit";
  const isAuthor = view.kind === "author";
  const isInspect = view.kind === "inspect";

  const legacy = useMemo(
    () => ({
      mcpHubMode:
        (view.kind === "author" && view.pane === "mcp") ||
        (view.kind === "inspect" && view.tool.kind === "mcp-hub"),
      skillsHubMode:
        (view.kind === "author" && view.pane === "skills") ||
        (view.kind === "inspect" && view.tool.kind === "skills-hub"),
      missionControlMode: view.kind === "cockpit",
    }),
    [view],
  );

  return {
    view,
    enter,
    back,
    patch,
    isChat,
    isCockpit,
    isAuthor,
    isInspect,
    legacy,
  };
}

export function authorView(pane: AuthorPane): ViewMode {
  return { kind: "author", pane };
}

export function inspectView(tool: InspectTool): ViewMode {
  return { kind: "inspect", tool };
}

export function cockpitView(hubPane: CockpitHubPane = DEFAULT_COCKPIT_HUB_PANE): ViewMode {
  return hubPane === DEFAULT_COCKPIT_HUB_PANE
    ? { kind: "cockpit" }
    : { kind: "cockpit", hubPane };
}

export function mcpHubInspectTool(): InspectMcpHub {
  return { kind: "mcp-hub" };
}

export function skillsHubInspectTool(): InspectSkillsHub {
  return { kind: "skills-hub" };
}

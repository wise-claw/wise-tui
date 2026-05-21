import { useCallback, useMemo, useReducer } from "react";
import {
  DEFAULT_VIEW_MODE,
  type AuthorPane,
  type InspectCodeGraph,
  type InspectTool,
  type ViewMode,
} from "../types/viewMode";

/**
 * 顶层 View 状态机（参见 `.trellis/spec/guides/agent-harness-architecture.md` §3）。
 *
 * 历史代码用 6 个互斥布尔表达视图模式：每开一个新视图都要在 8+ 个 callback 里
 * 调 5 次 `setXxxMode(false)`，互斥关系是隐式约定，加新模式极易漏分支。
 *
 * 本 hook 用一个 discriminated union 替代之，保证：
 *   1. 编译期模式互斥：只有一个 `kind` 同时活跃，TS 无法表达"两个 mode 都为 true"。
 *   2. 切换语义集中：调用方写 `enter({ kind: "cockpit" })`，不再操心其他视图。
 *   3. `back` 优先回到上一个视图（栈深度 1）；历史为空时回到默认 chat。
 *      Author 内切换 Tab 不压栈，因此「返回」一次即关闭整个工作台配置。
 */

type ViewModeAction =
  | { type: "enter"; mode: ViewMode }
  | { type: "back" }
  | { type: "patch"; partial: ViewModePatch };

/**
 * `patch` 的语义：仅当当前 view 与 partial 同 kind 时，浅合并字段。
 * 用于 cockpit 内 `setAssistantInitialTarget`、code-graph 入口微调等。
 */
type ViewModePatch =
  | { kind: "cockpit"; missionId?: string }
  | { kind: "inspect"; tool: Partial<InspectCodeGraph> & { kind: "code-graph" } };

interface ViewModeState {
  current: ViewMode;
  /** 上一视图（深度 1 历史栈）。null 表示无历史。 */
  prev: ViewMode | null;
}

function viewsEqual(a: ViewMode, b: ViewMode): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "author" && b.kind === "author") return a.pane === b.pane;
  if (a.kind === "cockpit" && b.kind === "cockpit") return a.missionId === b.missionId;
  return true;
}

function viewModeReducer(prev: ViewModeState, action: ViewModeAction): ViewModeState {
  switch (action.type) {
    case "enter": {
      // 跳到自身视为 no-op（不污染历史）。
      if (viewsEqual(prev.current, action.mode)) return prev;
      // 工作台配置内换 Tab：只改 pane，不把上一 Tab 压入历史。
      if (prev.current.kind === "author" && action.mode.kind === "author") {
        return { current: action.mode, prev: prev.prev };
      }
      return { current: action.mode, prev: prev.current };
    }
    case "back": {
      // 有上一视图就回到它；否则退回默认 cockpit 主页。
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
      if (
        action.partial.kind === "inspect" &&
        view.kind === "inspect" &&
        view.tool.kind === "code-graph" &&
        action.partial.tool.kind === "code-graph"
      ) {
        return {
          ...prev,
          current: { ...view, tool: { ...view.tool, ...action.partial.tool } },
        };
      }
      return prev;
    }
  }
}

export interface UseViewModeApi {
  view: ViewMode;
  /** 显式进入某个 view（覆盖式）。等价于历史"先把其它布尔置 false 再开当前"。 */
  enter: (mode: ViewMode) => void;
  /** 退到默认 chat。等价于历史"把当前布尔置 false 且其它已是 false"。 */
  back: () => void;
  /** 浅合并当前 view 字段（仅同 kind 生效）。 */
  patch: (partial: ViewModePatch) => void;

  /** 语义化谓词。 */
  isChat: boolean;
  isCockpit: boolean;
  isAuthor: boolean;
  isInspect: boolean;

  /** 6 个互斥布尔兼容别名。仅供过渡期 layout / sidebar nav 直接读，不要在新代码里依赖。 */
  legacy: {
    mcpHubMode: boolean;
    skillsHubMode: boolean;
    missionControlMode: boolean;
    codeKnowledgeGraphMode: boolean;
    ccWfStudioMode: boolean;
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
      // P0 阶段:author/<mcp|skills> 仍走老的全屏 / 叠层渲染(McpHub overlay /
      // SkillsHub overlay)。AppWorkspaceLayout 透过 `legacy.*` 读这两个旧名走老
      // 分支,行为完全等价。Stage 4 删除 prompts 后,`promptsMode` 名彻底下线。
      mcpHubMode: view.kind === "author" && view.pane === "mcp",
      skillsHubMode: view.kind === "author" && view.pane === "skills",
      missionControlMode: view.kind === "cockpit",
      codeKnowledgeGraphMode: view.kind === "inspect" && view.tool.kind === "code-graph",
      ccWfStudioMode: view.kind === "inspect" && view.tool.kind === "workflow-studio",
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

/** Helper：构造 author/<pane> view，省一层 boilerplate。 */
export function authorView(pane: AuthorPane): ViewMode {
  return { kind: "author", pane };
}

/** Helper：构造 inspect/<tool> view。 */
export function inspectView(tool: InspectTool): ViewMode {
  return { kind: "inspect", tool };
}

/** Helper：构造 cockpit view，可选携带 missionId。 */
export function cockpitView(missionId?: string): ViewMode {
  return missionId ? { kind: "cockpit", missionId } : { kind: "cockpit" };
}

/** Helper：构造默认 code-graph inspect tool（所有 flag 为 false，对应顶栏入口）。 */
export function codeGraphInspectTool(
  overrides?: Partial<InspectCodeGraph>,
): InspectCodeGraph {
  return {
    kind: "code-graph",
    suppressIdleAutoReindex: false,
    lockToEntryRepository: false,
    defaultProjectMultiRepo: false,
    ...overrides,
  };
}

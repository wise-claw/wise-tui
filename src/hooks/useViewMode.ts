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
 *   3. 历史行为等价：`enter` 直接覆盖（与历史 `setXxxMode(true) + 其他全 false` 等价）；
 *      `back` 退到默认 `chat`（与历史 `setXxxMode(false)` 路径等价，因为历史代码里
 *      所有"离开当前视图"的 callback 都会让其它 5 个布尔为 false）。
 *
 * P0 不维护视图历史栈。如果未来需要从 inspect 关闭后回到上一个 cockpit/author，
 * 在本 hook 内加 stack，调用方接口不变。
 */

type ViewModeAction =
  | { type: "enter"; mode: ViewMode }
  | { type: "back" }
  | { type: "patch"; partial: ViewModePatch };

/**
 * `patch` 的语义：仅当当前 view 与 partial 同 kind 时，浅合并字段。
 * 用于 cockpit 内 `setMissionControlInitialTarget`、code-graph 入口微调等。
 */
type ViewModePatch =
  | { kind: "cockpit"; missionId?: string }
  | { kind: "inspect"; tool: Partial<InspectCodeGraph> & { kind: "code-graph" } };

function viewModeReducer(prev: ViewMode, action: ViewModeAction): ViewMode {
  switch (action.type) {
    case "enter":
      return action.mode;
    case "back":
      return DEFAULT_VIEW_MODE;
    case "patch": {
      if (prev.kind !== action.partial.kind) return prev;
      if (action.partial.kind === "cockpit" && prev.kind === "cockpit") {
        return { ...prev, ...action.partial };
      }
      if (
        action.partial.kind === "inspect" &&
        prev.kind === "inspect" &&
        prev.tool.kind === "code-graph" &&
        action.partial.tool.kind === "code-graph"
      ) {
        return { ...prev, tool: { ...prev.tool, ...action.partial.tool } };
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
    promptsMode: boolean;
    mcpHubMode: boolean;
    skillsHubMode: boolean;
    missionControlMode: boolean;
    codeKnowledgeGraphMode: boolean;
    ccWfStudioMode: boolean;
  };
}

export function useViewMode(initial: ViewMode = DEFAULT_VIEW_MODE): UseViewModeApi {
  const [view, dispatch] = useReducer(viewModeReducer, initial);

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
      // P0 阶段：author/<prompts|mcp|skills> 仍走老的全屏 / 叠层渲染（PromptsPanel /
      // McpHub overlay / SkillsHub overlay）。AppWorkspaceLayout 透过 `legacy.*`
      // 读这三个旧名走老分支，行为完全等价。
      // P3 把 author 域折成 AuthorPanel 后，AppWorkspaceLayout 改读 `isAuthor`，
      // 这三个 legacy 名再降级为常量 false 不影响渲染。
      promptsMode: view.kind === "author" && view.pane === "prompts",
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

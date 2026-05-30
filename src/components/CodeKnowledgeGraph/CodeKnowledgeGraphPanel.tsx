import { listen } from "@tauri-apps/api/event";
import { safeUnlistenPromise } from "../../utils/safeTauriUnlisten";
import {
  CloseOutlined,
  DeleteOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { Alert, App, Button, Empty, Modal, Progress, Select, Space, Spin, Tag, Tooltip, Typography } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  clearCodeGraphIndex,
  cancelCodeGraphReindex,
  getCodeGraphIndexStatus,
  getCodeGraphMultiSubgraph,
  getCodeGraphSubgraph,
  searchCodeGraphNodes,
  triggerCodeGraphAssociationBuild,
  triggerCodeGraphProjectSearch,
  triggerCodeGraphReindex,
} from "../../services/codeKnowledgeGraph";
import { filterGraphNodesForSearch } from "../../utils/codeGraphNodeSearch";
import { readVisiblePollIntervalMs } from "../../utils/adaptivePoll";
import { computeSelectedNodeNeighbors } from "../../utils/codeGraphSelectedNeighbors";
import {
  parseCodeGraphNodeSearchResponse,
  parseCodeGraphSubgraphResponse,
} from "../../utils/codeKnowledgeGraphResponse";
import type {
  CodeGraphIndexStatusResponse,
  CodeGraphSubgraphDirection,
  CodeGraphSubgraphRequest,
  CodeGraphSubgraphResponse,
  GraphNode,
} from "../../types/codeKnowledgeGraph";
import { isCodeGraphIndexBenignUserAbortError } from "../../types/codeKnowledgeGraph";
import { CodeGraphSourcePreview } from "./CodeGraphSourcePreview";
import {
  CodeKnowledgeGraphChartColumn,
  type CodeKnowledgeGraphChartColumnHandle,
  HOP_SELECT_OPTIONS,
  type SubgraphHopScope,
} from "./CodeKnowledgeGraphChartColumn";
import {
  CodeGraphAssociationPopover,
  type AssociationGraphConfig,
} from "./CodeGraphAssociationPopover";
import { CodeGraphRepositoryPopover, type CodeGraphRepoDropdownSelection } from "./CodeGraphRepositoryPopover";
import { InspectorPanel } from "./InspectorPanel";
import "./CodeKnowledgeGraphPanel.css";

interface RepositoryInfo {
  id: number;
  name: string;
  path: string;
  repositoryType?: "frontend" | "backend" | "document";
}

interface Props {
  repositoryId: number | null;
  repositories?: RepositoryInfo[];
  /** 全库搜索覆盖的仓库；省略时仅搜索当前 `repositoryId` */
  searchRepositoryIds?: number[];
  onSelectRepository?: (repoId: number) => void;
  onClose?: () => void;
  /** 侧栏「在编辑器中打开」：非 Monaco 类型或预览失败时使用 */
  onOpenRepositoryFile?: (relativePath: string) => void;
  /** 从 Wise 全局移除仓库（Popover 内删除） */
  onRemoveRepository?: (repositoryId: number) => void | Promise<void>;
  /** 添加游离仓库（Popover 底栏「分析新仓库」） */
  onOpenAddRepository?: () => void | Promise<void>;
  /**
   * 为 true 时：当前仓 `idle` 也不会自动触发 `triggerCodeGraphReindex`。
   * 用于侧栏「查看检索」仅打开面板，由用户点击「开始检索」。
   */
  suppressIdleAutoReindex?: boolean;
  /**
   * 侧栏「图谱操作 → 查看检索」进入时为 true：标题旁仅展示当前仓名（不可点选切换），
   * 并隐藏「全部仓库」关联检索入口；子图与搜索范围仅限本仓库。
   */
  lockToEntryRepository?: boolean;
  /**
   * 侧栏项目「图谱操作 → 查看检索」进入时为 true：若项目内候选仓库 ≥2，默认选中多仓关联合并视图（与仓库下拉底部「(a + b)」一致）。
   */
  defaultProjectMultiRepoAssociation?: boolean;
}

const SUBGRAPH_SEARCH_DEBOUNCE_MS = 220;
const SUBGRAPH_SEARCH_MIN_QUERY_LEN = 1;

/** 图谱默认占主区域宽度约 2/3（与 GitNexus 主画布比例接近） */
const GRAPH_PANE_DEFAULT_PCT = 200 / 3;
const GRAPH_PANE_MIN_PCT = 22;
const GRAPH_PANE_MAX_PCT = 88;
const GRAPH_PANE_MIN_GRAPH_PX = 220;
const GRAPH_PANE_MIN_RIGHT_PX = 200;
const SPLITTER_WIDTH_PX = 6;

/** 防止 React StrictMode / 重复 effect 在短时间内对同一仓触发两次 `triggerCodeGraphReindex`。 */
const AUTO_REINDEX_DEBOUNCE_MS = 2000;

function normalizeSubgraphHopScope(v: unknown): SubgraphHopScope {
  if (v === "all") return "all";
  const n =
    typeof v === "string" ? Number.parseInt(String(v).trim(), 10) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n)) return 2;
  const clamped = Math.min(10, Math.max(1, Math.floor(Number(n))));
  return clamped as SubgraphHopScope;
}

/** 默认子图 hop：与后端「计代价边」一致，约等于上下各两级（`contains` 不计入 hop） */
const DEFAULT_CODE_GRAPH_SUBGRAPH_HOP: SubgraphHopScope = 2;

function scopeStatusOf(
  byId: Record<number, CodeGraphIndexStatusResponse>,
  id: number,
): CodeGraphIndexStatusResponse {
  return byId[id] ?? { status: "idle", repositoryId: id };
}

function aggregateScopeProgress(
  ids: number[],
  byId: Record<number, CodeGraphIndexStatusResponse>,
): number {
  if (ids.length === 0) return 0;
  let sum = 0;
  for (const id of ids) {
    const s = scopeStatusOf(byId, id);
    if (s.status === "done") sum += 100;
    else if (s.status === "indexing") sum += Math.max(1, s.progress ?? 1);
  }
  return Math.round(sum / ids.length);
}

function repoIndexStatusLabel(status: CodeGraphIndexStatusResponse["status"]): string {
  switch (status) {
    case "done":
      return "已完成";
    case "indexing":
      return "索引中";
    case "error":
      return "失败";
    default:
      return "未开始";
  }
}

export function CodeKnowledgeGraphPanel({
  repositoryId,
  repositories,
  searchRepositoryIds: searchRepositoryIdsProp,
  onSelectRepository,
  onClose,
  onOpenRepositoryFile,
  onRemoveRepository,
  onOpenAddRepository,
  suppressIdleAutoReindex = false,
  lockToEntryRepository = false,
  defaultProjectMultiRepoAssociation = false,
}: Props) {
  const { message } = App.useApp();
  const [indexStatus, setIndexStatus] = useState<CodeGraphIndexStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [subgraphData, setSubgraphData] = useState<CodeGraphSubgraphResponse | null>(null);
  const [subgraphHopScope, setSubgraphHopScope] = useState<SubgraphHopScope>(DEFAULT_CODE_GRAPH_SUBGRAPH_HOP);
  const [subgraphFocusId, setSubgraphFocusId] = useState<string | undefined>(undefined);
  /** `undefined`：双向子图 */
  const [subgraphDirection, setSubgraphDirection] = useState<CodeGraphSubgraphDirection | undefined>(undefined);
  /** 上卷/下钻与当前状态相同时仍须重拉子图（按工具栏 hop），递增以触发 effect */
  const [subgraphRefreshKey, setSubgraphRefreshKey] = useState(0);
  /** 多仓合并范围：候选来自 `searchRepositoryIds` 或仅当前仓 */
  const [associationConfig, setAssociationConfig] = useState<AssociationGraphConfig>({
    mode: "all",
    customRepositoryIds: [],
  });
  /** 仓库下拉：active 标在仓库行还是底部关联合并行 */
  const [repoDropdownSelection, setRepoDropdownSelection] =
    useState<CodeGraphRepoDropdownSelection>("repository");
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [subgraphLoading, setSubgraphLoading] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chartColumnRef = useRef<CodeKnowledgeGraphChartColumnHandle | null>(null);
  const splitLayoutRef = useRef<HTMLDivElement | null>(null);
  /** 项目入口默认多仓视图：每种候选集合只自动切换一次 */
  const projectMultiRepoDefaultKeyRef = useRef<string | null>(null);
  /** 区分「首次进入」与侧栏切换活跃仓：后者应回到单仓下拉视图 */
  const prevRepositoryIdForDropdownRef = useRef<number | null>(null);
  /** 图谱列占 split 区域宽度的百分比（右侧为剩余 + 中间 6px 分隔条） */
  const [graphPanePercent, setGraphPanePercent] = useState(GRAPH_PANE_DEFAULT_PCT);
  const [subgraphSearchInput, setSubgraphSearchInput] = useState("");
  const [subgraphSearchDebounced, setSubgraphSearchDebounced] = useState("");
  const [searchRemoteHits, setSearchRemoteHits] = useState<GraphNode[]>([]);
  const [searchRemoteLoading, setSearchRemoteLoading] = useState(false);
  const pendingCrossRepoSearchPickRef = useRef<GraphNode | null>(null);
  const lastAutoReindexTriggerRef = useRef<{ repositoryId: number; at: number } | null>(null);
  /** 用户「清空索引」后：该仓处于 idle 时不再自动检索，直至手动「开始检索」或从仓库菜单对该仓触发检索 */
  const suppressIdleAutoReindexForRepoIdRef = useRef<number | null>(null);
  /** 多仓项目检索（索引 + 仓库组 + API 关联）整段流程进行中 */
  const [projectSearchActive, setProjectSearchActive] = useState(false);
  const [scopedIndexByRepoId, setScopedIndexByRepoId] = useState<
    Record<number, CodeGraphIndexStatusResponse>
  >({});

  const associationCandidateIds = useMemo(() => {
    if (lockToEntryRepository && repositoryId != null) {
      return [repositoryId];
    }
    const fromProp =
      searchRepositoryIdsProp?.filter((id) => typeof id === "number" && Number.isFinite(id)) ?? [];
    const base =
      fromProp.length > 0
        ? fromProp
        : repositoryId != null
          ? [repositoryId]
          : [];
    return [...new Set(base)].slice(0, 20);
  }, [lockToEntryRepository, searchRepositoryIdsProp, repositoryId]);

  const associationCandidatesKey = useMemo(
    () => [...associationCandidateIds].sort((a, b) => a - b).join(","),
    [associationCandidateIds],
  );

  const associationScopeRepoIds = useMemo(() => {
    if (associationCandidateIds.length === 0) {
      return repositoryId != null ? [repositoryId] : [];
    }
    if (associationCandidateIds.length === 1) {
      return associationCandidateIds;
    }
    if (associationConfig.mode === "all") {
      return [...associationCandidateIds];
    }
    const picked = associationConfig.customRepositoryIds.filter((id) =>
      associationCandidateIds.includes(id),
    );
    if (picked.length === 0 && repositoryId != null) {
      return [repositoryId];
    }
    return [...new Set(picked)].slice(0, 20);
  }, [associationCandidateIds, associationConfig, repositoryId]);

  const indexWatchRepoIds = useMemo(() => {
    if (associationScopeRepoIds.length >= 2) {
      if (projectSearchActive || repoDropdownSelection === "association") {
        return associationScopeRepoIds;
      }
    }
    return repositoryId != null ? [repositoryId] : [];
  }, [associationScopeRepoIds, projectSearchActive, repoDropdownSelection, repositoryId]);

  const fetchStatus = useCallback(async () => {
    const ids =
      indexWatchRepoIds.length > 0
        ? indexWatchRepoIds
        : repositoryId != null
          ? [repositoryId]
          : [];
    if (ids.length === 0) {
      setLoading(false);
      return;
    }
    try {
      const entries = await Promise.all(
        ids.map(async (id) => [id, await getCodeGraphIndexStatus(id)] as const),
      );
      setScopedIndexByRepoId((prev) => {
        const next = { ...prev };
        for (const [id, status] of entries) {
          next[id] = status;
        }
        return next;
      });
      if (repositoryId != null) {
        const current = entries.find(([id]) => id === repositoryId)?.[1];
        if (current) {
          setIndexStatus(current);
          if (current.status === "error") {
            if (isCodeGraphIndexBenignUserAbortError(current.error)) {
              setIndexError(null);
            } else {
              setIndexError(current.error ?? "索引失败");
            }
          } else if (current.status === "done" || current.status === "indexing") {
            setIndexError(null);
          }
        }
      }
      const anyIndexing = entries.some(([, s]) => s.status === "indexing");
      if (!projectSearchActive && !anyIndexing && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      } else if ((projectSearchActive || anyIndexing) && !pollRef.current) {
        pollRef.current = setInterval(() => {
          if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
          void fetchStatus();
        }, readVisiblePollIntervalMs(1500, 6000));
      }
    } catch (e) {
      console.warn("[code-graph] getCodeGraphIndexStatus failed", e);
    } finally {
      setLoading(false);
    }
  }, [repositoryId, indexWatchRepoIds, projectSearchActive]);

  const markScopeOptimisticIndexing = useCallback(
    (ids: number[]) => {
      if (ids.length === 0) return;
      setScopedIndexByRepoId((prev) => {
        const next = { ...prev };
        for (const id of ids) {
          next[id] = { status: "indexing", repositoryId: id, progress: 1 };
        }
        return next;
      });
      if (repositoryId != null && ids.includes(repositoryId)) {
        setIndexStatus({ status: "indexing", repositoryId, progress: 1 });
      }
    },
    [repositoryId],
  );

  // Listen for index events from the spawned Rust task
  useEffect(() => {
    const unsubs: Promise<() => void>[] = [];

    const completeUnsub = listen("code-graph-index-complete", () => {
      setIndexError(null);
      void fetchStatus();
    });
    unsubs.push(completeUnsub);

    const errorUnsub = listen("code-graph-index-error", (event: any) => {
      if (event.payload?.repositoryId === repositoryId) {
        const errMsg = String(event.payload.error ?? "索引失败");
        if (isCodeGraphIndexBenignUserAbortError(errMsg)) {
          setIndexError(null);
          void fetchStatus();
        } else {
          setIndexError(errMsg);
          if (repositoryId) {
            setIndexStatus({ status: "error", repositoryId, progress: 0 });
          }
        }
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
    });
    unsubs.push(errorUnsub);

    const assocOk = listen("code-graph-association-build-complete", (event: any) => {
      const raw = event.payload?.repositoryIds;
      const ids: number[] = Array.isArray(raw)
        ? raw.filter((x: unknown) => typeof x === "number" && Number.isFinite(x))
        : [];
      if (repositoryId != null && ids.includes(repositoryId)) {
        setIndexError(null);
        void fetchStatus();
        setSubgraphRefreshKey((k) => k + 1);
      }
      if (ids.length >= 2) {
        message.success("GitNexus 仓库组已同步，多仓合并子图已更新");
      }
    });
    unsubs.push(assocOk);

    const assocErr = listen("code-graph-association-build-error", (event: any) => {
      message.error(String(event.payload?.error ?? "GitNexus 仓库组同步失败"));
      const raw = event.payload?.repositoryIds;
      const ids: number[] = Array.isArray(raw)
        ? raw.filter((x: unknown) => typeof x === "number" && Number.isFinite(x))
        : [];
      if (repositoryId != null && ids.includes(repositoryId)) {
        void fetchStatus();
      }
    });
    unsubs.push(assocErr);

    const projectOk = listen("code-graph-project-search-complete", (event: any) => {
      setProjectSearchActive(false);
      const raw = event.payload?.repositoryIds;
      const ids: number[] = Array.isArray(raw)
        ? raw.filter((x: unknown) => typeof x === "number" && Number.isFinite(x))
        : [];
      if (repositoryId != null && ids.includes(repositoryId)) {
        setIndexError(null);
        void fetchStatus();
        setSubgraphRefreshKey((k) => k + 1);
      } else if (ids.length >= 2) {
        void fetchStatus();
        setSubgraphRefreshKey((k) => k + 1);
      }
      const bridgeEdges = event.payload?.apiAssociation?.bridgeEdges;
      if (typeof bridgeEdges === "number" && bridgeEdges > 0) {
        message.success(`多仓检索完成，已关联 ${bridgeEdges} 条前后端 API 调用`);
      } else if (ids.length >= 2) {
        message.success("多仓检索完成");
      }
    });
    unsubs.push(projectOk);

    const projectErr = listen("code-graph-project-search-error", (event: any) => {
      setProjectSearchActive(false);
      message.error(String(event.payload?.error ?? "多仓检索失败"));
      const raw = event.payload?.repositoryIds;
      const ids: number[] = Array.isArray(raw)
        ? raw.filter((x: unknown) => typeof x === "number" && Number.isFinite(x))
        : [];
      if (repositoryId != null && ids.includes(repositoryId)) {
        void fetchStatus();
      }
    });
    unsubs.push(projectErr);

    return () => {
      unsubs.forEach((p) => safeUnlistenPromise(p));
    };
  }, [repositoryId, fetchStatus]);

  useEffect(() => {
    void fetchStatus();
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [fetchStatus]);

  /** 打开图谱且当前仓从未建索引（idle）时自动开始检索（顶栏入口）；侧栏「查看检索」经 `suppressIdleAutoReindex` 关闭。清空索引后不会自动重建。 */
  useEffect(() => {
    if (suppressIdleAutoReindex) return;
    if (loading || repositoryId == null || !indexStatus) return;
    if (indexStatus.repositoryId !== repositoryId) return;
    if (indexStatus.status !== "idle") return;
    if (suppressIdleAutoReindexForRepoIdRef.current === repositoryId) {
      return;
    }

    const now = Date.now();
    const prev = lastAutoReindexTriggerRef.current;
    if (
      prev != null &&
      prev.repositoryId === repositoryId &&
      now - prev.at < AUTO_REINDEX_DEBOUNCE_MS
    ) {
      return;
    }
    lastAutoReindexTriggerRef.current = { repositoryId, at: now };

    let cancelled = false;
    void (async () => {
      setIndexError(null);
      try {
        if (associationScopeRepoIds.length >= 2) {
          setProjectSearchActive(true);
          markScopeOptimisticIndexing(associationScopeRepoIds);
          await triggerCodeGraphProjectSearch(associationScopeRepoIds);
        } else {
          markScopeOptimisticIndexing([repositoryId]);
          await triggerCodeGraphReindex({ repositoryId });
        }
        if (!cancelled) {
          message.info(
            associationScopeRepoIds.length >= 2
              ? "已自动开始多仓检索（含前后端 API 关联），完成后将自动刷新。"
              : "已为当前仓库自动开始后台检索（GitNexus analyze + 图谱导入），完成后将自动刷新。",
          );
          void fetchStatus();
        }
      } catch (e) {
        setProjectSearchActive(false);
        lastAutoReindexTriggerRef.current = null;
        if (!cancelled) {
          console.warn("[code-graph] auto triggerCodeGraphReindex failed", e);
          message.error("自动开始检索失败，请点击「开始检索」重试。");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [suppressIdleAutoReindex, loading, repositoryId, indexStatus, fetchStatus, associationScopeRepoIds, markScopeOptimisticIndexing]);

  useEffect(() => {
    const pending = pendingCrossRepoSearchPickRef.current;
    if (pending && pending.repoId === repositoryId) {
      pendingCrossRepoSearchPickRef.current = null;
      setSubgraphFocusId(pending.id);
      setSubgraphDirection("downstream");
      setSubgraphRefreshKey((k) => k + 1);
      setSelectedNode(pending);
      return;
    }
    if (pending) {
      pendingCrossRepoSearchPickRef.current = null;
    }

    setSubgraphFocusId(undefined);
    setSubgraphHopScope(DEFAULT_CODE_GRAPH_SUBGRAPH_HOP);
    setSubgraphDirection(undefined);
    setSubgraphRefreshKey(0);
    setSelectedNode(null);
    setSubgraphData(null);
    setGraphPanePercent(GRAPH_PANE_DEFAULT_PCT);
    setSubgraphSearchInput("");
    setSubgraphSearchDebounced("");
    setSearchRemoteHits([]);
    setAssociationConfig({ mode: "all", customRepositoryIds: [] });
    /** 不在此强制 `repository`：项目「查看检索」入口需保留多仓关联合并，见 `defaultProjectMultiRepoAssociation` 与 `prevRepositoryIdForDropdownRef`。 */
  }, [repositoryId]);

  useEffect(() => {
    if (repositoryId == null) {
      prevRepositoryIdForDropdownRef.current = null;
      return;
    }
    const prev = prevRepositoryIdForDropdownRef.current;
    if (prev !== null && prev !== repositoryId) {
      setRepoDropdownSelection("repository");
    }
    prevRepositoryIdForDropdownRef.current = repositoryId;
  }, [repositoryId]);

  useEffect(() => {
    if (!lockToEntryRepository) return;
    setAssociationConfig({ mode: "all", customRepositoryIds: [] });
    setRepoDropdownSelection("repository");
  }, [lockToEntryRepository]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setSubgraphSearchDebounced(subgraphSearchInput.trim());
    }, SUBGRAPH_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [subgraphSearchInput]);

  /** 子图与节点搜索实际查询的仓库：仓库菜单为「单仓 active」时仅当前仓；选中底部「关联合并」时用关联范围 */
  const subgraphRepositoryIds = useMemo(() => {
    if (repositoryId == null) return [];
    if (repoDropdownSelection === "repository") {
      return [repositoryId];
    }
    return associationScopeRepoIds;
  }, [repoDropdownSelection, repositoryId, associationScopeRepoIds]);

  /** 仓库菜单内多仓入口文案，如 (vocs-web + crewAI) — 来自关联配置，与当前画布是否多仓无关 */
  const associationScopeDisplay = useMemo(() => {
    const ids = associationScopeRepoIds;
    const repos = repositories ?? [];
    if (ids.length < 2) return null;
    const names = ids
      .map((id) => repos.find((r) => r.id === id)?.name)
      .filter((n): n is string => Boolean(n));
    if (names.length < 2) return null;
    const maxInline = 4;
    if (names.length <= maxInline) {
      return `(${names.join(" + ")})`;
    }
    return `(${names.slice(0, 3).join(" + ")} + …共${names.length}仓)`;
  }, [associationScopeRepoIds, repositories]);

  useEffect(() => {
    if (associationScopeRepoIds.length < 2) {
      setRepoDropdownSelection("repository");
    }
  }, [associationScopeRepoIds.length]);

  useEffect(() => {
    if (!defaultProjectMultiRepoAssociation) {
      projectMultiRepoDefaultKeyRef.current = null;
      return;
    }
    if (lockToEntryRepository) return;
    if (associationCandidateIds.length < 2) return;
    if (projectMultiRepoDefaultKeyRef.current === associationCandidatesKey) return;
    projectMultiRepoDefaultKeyRef.current = associationCandidatesKey;
    setAssociationConfig({ mode: "all", customRepositoryIds: [] });
    setRepoDropdownSelection("association");
    setSelectedNode(null);
    setSubgraphFocusId(undefined);
    setSubgraphDirection(undefined);
    setSubgraphRefreshKey((k) => k + 1);
    return () => {
      projectMultiRepoDefaultKeyRef.current = null;
    };
  }, [
    defaultProjectMultiRepoAssociation,
    lockToEntryRepository,
    associationCandidateIds.length,
    associationCandidatesKey,
  ]);

  const handleRepoMenuPickRepository = useCallback(
    (repoId: number) => {
      setRepoDropdownSelection("repository");
      onSelectRepository?.(repoId);
    },
    [onSelectRepository],
  );

  useEffect(() => {
    if (!repositoryId) {
      setSubgraphLoading(false);
      return;
    }
    const uniqueIds = [...new Set(subgraphRepositoryIds)].filter((id) => Number.isFinite(id)) as number[];
    const targetIds = uniqueIds.length > 0 ? uniqueIds : [repositoryId];
    const multiTarget = targetIds.length >= 2;
    const subgraphIndexReady = multiTarget
      ? !projectSearchActive &&
        targetIds.every((id) => scopedIndexByRepoId[id]?.status === "done")
      : indexStatus?.status === "done" && indexStatus.repositoryId === repositoryId;
    if (!subgraphIndexReady) {
      setSubgraphLoading(false);
      return;
    }

    let cancelled = false;
    setSubgraphLoading(true);

    void (async () => {
      try {
        if (targetIds.length === 1) {
          const rid = targetIds[0];
          const req: CodeGraphSubgraphRequest = { repositoryId: rid };
          const focusForApi = selectedNode?.id ?? subgraphFocusId;
          if (focusForApi) req.focusNodeId = focusForApi;
          if (subgraphHopScope !== "all") req.hop = subgraphHopScope;
          if (subgraphDirection) req.direction = subgraphDirection;
          const raw = await getCodeGraphSubgraph(req);
          if (cancelled) return;
          setSubgraphData(parseCodeGraphSubgraphResponse(raw));
        } else {
          const hopArg = subgraphHopScope === "all" ? undefined : subgraphHopScope;
          const focusForApi = selectedNode?.id ?? subgraphFocusId;
          const raw = await getCodeGraphMultiSubgraph(targetIds, {
            focusNodeId: focusForApi,
            hop: hopArg,
            includeCrossRepoEdges: true,
          });
          if (cancelled) return;
          setSubgraphData(parseCodeGraphSubgraphResponse(raw));
        }
      } catch {
        if (!cancelled) setSubgraphData(null);
      } finally {
        if (!cancelled) setSubgraphLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      setSubgraphLoading(false);
    };
  }, [
    repositoryId,
    indexStatus?.status,
    indexStatus?.repositoryId,
    subgraphRepositoryIds,
    subgraphFocusId,
    subgraphHopScope,
    subgraphDirection,
    subgraphRefreshKey,
    selectedNode?.id,
    projectSearchActive,
    scopedIndexByRepoId,
  ]);

  useEffect(() => {
    if (subgraphSearchDebounced.length < SUBGRAPH_SEARCH_MIN_QUERY_LEN) {
      setSearchRemoteHits([]);
      setSearchRemoteLoading(false);
      return;
    }
    if (!repositoryId || subgraphRepositoryIds.length === 0) {
      setSearchRemoteHits([]);
      setSearchRemoteLoading(false);
      return;
    }
    const searchTargetIds = [...new Set(subgraphRepositoryIds)].filter((id) =>
      Number.isFinite(id),
    ) as number[];
    const multiSearch = searchTargetIds.length >= 2;
    const searchIndexReady = multiSearch
      ? !projectSearchActive &&
        searchTargetIds.every((id) => scopedIndexByRepoId[id]?.status === "done")
      : indexStatus?.status === "done" && indexStatus.repositoryId === repositoryId;
    if (!searchIndexReady) {
      setSearchRemoteHits([]);
      setSearchRemoteLoading(false);
      return;
    }

    let cancelled = false;
    setSearchRemoteLoading(true);

    void (async () => {
      try {
        const raw = await searchCodeGraphNodes({
          repositoryIds: subgraphRepositoryIds,
          query: subgraphSearchDebounced,
          limit: 120,
        });
        const parsed = parseCodeGraphNodeSearchResponse(raw);
        const ranked = filterGraphNodesForSearch(parsed, subgraphSearchDebounced, 100);
        if (!cancelled) {
          setSearchRemoteHits(ranked);
        }
      } catch {
        if (!cancelled) {
          setSearchRemoteHits([]);
        }
      } finally {
        if (!cancelled) {
          setSearchRemoteLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    subgraphSearchDebounced,
    subgraphRepositoryIds,
    repositoryId,
    indexStatus?.status,
    indexStatus?.repositoryId,
    projectSearchActive,
    scopedIndexByRepoId,
  ]);

  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleReindex = useCallback(async () => {
    if (!repositoryId) return;
    const watchIds =
      associationScopeRepoIds.length >= 2 ? associationScopeRepoIds : [repositoryId];
    if (
      projectSearchActive ||
      watchIds.some((id) => scopedIndexByRepoId[id]?.status === "indexing")
    ) {
      message.info("检索已在进行中，请稍候。");
      return;
    }
    setIndexError(null);
    try {
      suppressIdleAutoReindexForRepoIdRef.current = null;
      if (associationScopeRepoIds.length >= 2) {
        setProjectSearchActive(true);
        markScopeOptimisticIndexing(associationScopeRepoIds);
        await triggerCodeGraphProjectSearch(associationScopeRepoIds);
        message.info(
          "已开始多仓检索：各仓 GitNexus 分析、GitNexus 仓库组同步，并关联前端 src/api 与后端接口。完成后将自动刷新。",
        );
      } else {
        markScopeOptimisticIndexing([repositoryId]);
        await triggerCodeGraphReindex({ repositoryId });
      }
      void fetchStatus();
    } catch (e) {
      setProjectSearchActive(false);
      console.warn("[code-graph] triggerCodeGraphReindex failed", e);
      message.error("提交检索失败");
    }
  }, [
    repositoryId,
    indexStatus?.status,
    indexStatus?.repositoryId,
    fetchStatus,
    associationScopeRepoIds,
    scopedIndexByRepoId,
    projectSearchActive,
    markScopeOptimisticIndexing,
  ]);

  const handlePauseReindex = useCallback(async () => {
    if (!repositoryId) return;
    try {
      const o = await cancelCodeGraphReindex(repositoryId);
      if (o.clearedStaleIndexingStatus) {
        void fetchStatus();
      }
    } catch (e) {
      console.warn("[code-graph] cancelCodeGraphReindex failed", e);
    }
  }, [repositoryId, fetchStatus]);

  const handleClearGraphIndex = useCallback(() => {
    if (!repositoryId) return;
    if (indexStatus?.status === "indexing" && indexStatus.repositoryId === repositoryId) {
      message.warning("检索进行中时无法清空索引，请稍候结束后再试。");
      return;
    }
    Modal.confirm({
      title: "清空该仓库的代码图谱索引？",
      content:
        "将删除本地数据库中该仓库的图谱节点、边与索引进度（不含磁盘上的源码）。可用于排除旧版索引或异常中断后的残留。清空后不会自动检索，需手动点击「开始检索」。",
      okText: "清空",
      okType: "danger",
      cancelText: "取消",
      onOk: async () => {
        try {
          await clearCodeGraphIndex(repositoryId);
          lastAutoReindexTriggerRef.current = null;
          suppressIdleAutoReindexForRepoIdRef.current = repositoryId;
          setIndexError(null);
          setSubgraphData(null);
          setSelectedNode(null);
          setSubgraphRefreshKey((k) => k + 1);
          void fetchStatus();
        } catch (e) {
          console.warn("[code-graph] clearCodeGraphIndex failed", e);
          message.error("清空索引失败");
        }
      },
    });
  }, [repositoryId, indexStatus?.status, indexStatus?.repositoryId, fetchStatus]);

  const handleReindexRepository = useCallback(
    async (targetId: number) => {
      if (
        indexStatus?.status === "indexing" &&
        indexStatus.repositoryId === targetId
      ) {
        message.info("该仓库检索已在进行中。");
        return;
      }
      setIndexError(null);
      try {
        if (targetId === repositoryId) {
          suppressIdleAutoReindexForRepoIdRef.current = null;
        }
        await triggerCodeGraphReindex({ repositoryId: targetId });
        message.info(
          targetId === repositoryId
            ? "已开始后台检索代码仓库（GitNexus analyze + 图谱导入），完成后将自动刷新。"
            : "已开始后台检索所选代码仓库（GitNexus analyze + 图谱导入），完成后可切换查看。",
        );
        void fetchStatus();
      } catch (e) {
        console.warn("[code-graph] triggerCodeGraphReindex (repo menu) failed", e);
        message.error("提交检索失败");
      }
    },
    [repositoryId, indexStatus?.status, indexStatus?.repositoryId, fetchStatus],
  );

  const handleAssociationBuild = useCallback(async (ids: number[]) => {
    if (ids.length < 2) return;
    try {
      await triggerCodeGraphAssociationBuild(ids);
      message.info("已在后台同步 GitNexus 仓库组（create / add / sync），完成后将自动刷新。");
    } catch {
      message.error("提交仓库组同步失败");
    }
  }, []);

  /** 仓库菜单内「合并图谱」入口：清空画布并强制重拉当前关联范围内的多仓子图 */
  const handleViewMergedGraphFromRepoMenu = useCallback(() => {
    if (associationScopeRepoIds.length < 2) return;
    setRepoDropdownSelection("association");
    setSelectedNode(null);
    setSubgraphFocusId(undefined);
    setSubgraphDirection(undefined);
    setSubgraphHopScope(DEFAULT_CODE_GRAPH_SUBGRAPH_HOP);
    setSubgraphData(null);
    setSubgraphRefreshKey((k) => k + 1);
  }, [associationScopeRepoIds]);

  /** 退出仓库菜单中的多仓合并视图：范围缩为仅当前仓库（不调用移除仓库） */
  const handleDismissAssociationScope = useCallback(() => {
    if (repositoryId == null) return;
    setAssociationConfig({ mode: "custom", customRepositoryIds: [repositoryId] });
    setRepoDropdownSelection("repository");
    setSubgraphRefreshKey((k) => k + 1);
    message.success("已退出多仓合并视图");
  }, [repositoryId]);

  const handleAssociationApplied = useCallback((scopeRepositoryIds: number[]) => {
    if (scopeRepositoryIds.length >= 2) {
      setRepoDropdownSelection("association");
    } else {
      setRepoDropdownSelection("repository");
    }
    setSubgraphRefreshKey((k) => k + 1);
  }, []);

  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelectedNode(node);
    setSubgraphFocusId(node.id);
    setSubgraphDirection(undefined);
  }, []);

  const handleStageClearSelection = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const handleSubgraphRollUp = useCallback(() => {
    if (!selectedNode) return;
    // 清空画布与旧子图数据，再按「上卷」逻辑重拉；避免 Sigma 仍显示上一段子图节点
    setSubgraphData(null);
    setSubgraphLoading(true);
    setSubgraphFocusId(selectedNode.id);
    setSubgraphDirection("upstream");
    setSubgraphRefreshKey((k) => k + 1);
  }, [selectedNode]);

  const handleSubgraphDrillDown = useCallback(() => {
    if (!selectedNode) return;
    setSubgraphData(null);
    setSubgraphLoading(true);
    setSubgraphFocusId(selectedNode.id);
    setSubgraphDirection("downstream");
    setSubgraphRefreshKey((k) => k + 1);
  }, [selectedNode]);

  const handleGraphSplitPointerDown = useCallback(
    (e: import("react").PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const root = splitLayoutRef.current;
      const handle = e.currentTarget;
      if (!root) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const rect = root.getBoundingClientRect();
      const w = rect.width;
      if (w <= SPLITTER_WIDTH_PX + GRAPH_PANE_MIN_GRAPH_PX + GRAPH_PANE_MIN_RIGHT_PX) {
        handle.releasePointerCapture(e.pointerId);
        return;
      }
      const maxPct = Math.max(
        GRAPH_PANE_MIN_PCT,
        ((w - SPLITTER_WIDTH_PX - GRAPH_PANE_MIN_RIGHT_PX) / w) * 100,
      );
      const minPct = Math.min(GRAPH_PANE_MAX_PCT, (GRAPH_PANE_MIN_GRAPH_PX / w) * 100);
      const lo = Math.min(minPct, maxPct);
      const hi = Math.max(minPct, maxPct);
      const startX = e.clientX;
      const startPct = graphPanePercent;

      const clampPct = (pct: number) => Math.min(hi, Math.max(lo, pct));

      const onMove = (ev: PointerEvent) => {
        const deltaPct = ((ev.clientX - startX) / w) * 100;
        setGraphPanePercent(clampPct(startPct + deltaPct));
      };
      const onUp = (ev: PointerEvent) => {
        if (handle.hasPointerCapture(ev.pointerId)) {
          handle.releasePointerCapture(ev.pointerId);
        }
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [graphPanePercent],
  );

  const subgraphSearchOptions = useMemo(() => {
    if (subgraphSearchDebounced.length < SUBGRAPH_SEARCH_MIN_QUERY_LEN) return [];
    return searchRemoteHits.map((node) => {
      const repoLabel =
        subgraphRepositoryIds.length > 1
          ? (repositories?.find((r) => r.id === node.repoId)?.name ?? `仓库 ${node.repoId}`)
          : "";
      return {
        value: node.id,
        label: (
          <div className="app-code-graph-search-option">
            <span className="app-code-graph-search-option-title">{node.label}</span>
            <span className="app-code-graph-search-option-meta">
              {repoLabel ? `${repoLabel} · ` : ""}
              {node.kind} · {node.path}
            </span>
          </div>
        ),
      };
    });
  }, [
    searchRemoteHits,
    subgraphSearchDebounced,
    subgraphRepositoryIds.length,
    repositories,
  ]);

  const handleSubgraphSearchPick = useCallback(
    (nodeId: string) => {
      const node =
        searchRemoteHits.find((x) => x.id === nodeId) ?? subgraphData?.nodes.find((x) => x.id === nodeId);
      if (!node) return;

      setSubgraphSearchInput("");
      setSubgraphSearchDebounced("");

      if (node.repoId !== repositoryId) {
        pendingCrossRepoSearchPickRef.current = node;
        onSelectRepository?.(node.repoId);
      } else {
        setSelectedNode(node);
        setSubgraphFocusId(node.id);
        setSubgraphDirection("downstream");
        setSubgraphRefreshKey((k) => k + 1);
      }
    },
    [searchRemoteHits, subgraphData, repositoryId, onSelectRepository],
  );

  useEffect(() => {
    if (subgraphLoading || !selectedNode || !subgraphData?.nodes.length) return;
    if (!subgraphData.nodes.some((n) => n.id === selectedNode.id)) return;
    const id = selectedNode.id;
    requestAnimationFrame(() => {
      chartColumnRef.current?.focusNodeById(id);
    });
  }, [subgraphLoading, subgraphData, selectedNode]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);

  const subgraphHopLabel = useMemo(
    () => (subgraphHopScope === "all" ? "全部" : `hop ${subgraphHopScope}`),
    [subgraphHopScope],
  );

  /** 有限 hop 时画布按 hop 排布的根：选中点优先，否则为子图 API 焦点（如上卷/下钻/搜索定位） */
  const chartLayeredLayoutRootId = useMemo(() => {
    if (subgraphHopScope === "all" || !subgraphData?.nodes.length) return null;
    const root = selectedNode?.id ?? subgraphFocusId;
    if (!root || !subgraphData.nodes.some((n) => n.id === root)) return null;
    return root;
  }, [subgraphHopScope, subgraphData, selectedNode?.id, subgraphFocusId]);

  const { relatedNeighborEntries, relatedNeighborTotal } = useMemo(() => {
    if (!selectedNode || !subgraphData?.nodes.length) {
      return { relatedNeighborEntries: [], relatedNeighborTotal: 0 };
    }
    const { visible, totalNeighborCount } = computeSelectedNodeNeighbors(
      subgraphData.nodes,
      subgraphData.edges,
      selectedNode.id,
    );
    return { relatedNeighborEntries: visible, relatedNeighborTotal: totalNeighborCount };
  }, [selectedNode, subgraphData]);

  const renderIndexedBody = () => {
    if (!subgraphData?.nodes.length && subgraphLoading) {
      return (
        <div className="app-code-graph-centered-loading">
          <Spin description="加载子图中..." />
        </div>
      );
    }
    if (!subgraphData?.nodes.length && !subgraphLoading) {
      return (
        <Empty
          description="子图为空，当前仓库可能无已索引的源码（索引范围与 GitNexus 仓库语言扩展一致）"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      );
    }
    const data = subgraphData!;
    return (
      <div className="app-code-graph-split-with-overlay">
        {subgraphLoading && (
          <div className="app-code-graph-refresh-overlay" aria-busy="true" aria-live="polite">
            <Spin description="按新 hop 加载子图…" />
          </div>
        )}
        <div
          ref={splitLayoutRef}
          className="app-code-graph-graph-root app-code-graph-graph-root--split"
          style={{
            gridTemplateColumns: `${graphPanePercent}% ${SPLITTER_WIDTH_PX}px minmax(${GRAPH_PANE_MIN_RIGHT_PX}px, 1fr)`,
          }}
        >
          <div className="app-code-graph-chart-wrap">
            <CodeKnowledgeGraphChartColumn
              ref={chartColumnRef}
              subgraphData={data}
              selectedNode={selectedNode}
              onSelectNode={handleNodeClick}
              onStageClick={handleStageClearSelection}
              subgraphHopLabel={subgraphHopLabel}
              layeredLayoutRootId={chartLayeredLayoutRootId}
              subgraphHopScope={subgraphHopScope}
              onSubgraphRollUp={handleSubgraphRollUp}
              onSubgraphDrillDown={handleSubgraphDrillDown}
            />
          </div>
          <div
            className="app-code-graph-splitter"
            role="separator"
            aria-orientation="vertical"
            aria-label="拖动调整图谱与侧栏宽度"
            onPointerDown={handleGraphSplitPointerDown}
          />
          <div className="app-code-graph-right-column">
            <div className="app-code-graph-right-column-meta">
              <InspectorPanel
                node={selectedNode}
                relatedNeighbors={relatedNeighborEntries}
                relatedNeighborTotal={relatedNeighborTotal}
                onSelectRelatedNode={handleNodeClick}
                repositoryPath={repositoryPathForSelectedGraphNode}
                repositorySummaries={repositories?.map((r) => ({ id: r.id, name: r.name }))}
                onOpenRepositoryFile={onOpenRepositoryFile}
              />
            </div>
            <CodeGraphSourcePreview
              repositoryPath={repositoryPathForSelectedGraphNode}
              selectedNode={selectedNode}
            />
          </div>
        </div>
      </div>
    );
  };

  const currentRepo = useMemo(
    () => repositories?.find((r) => r.id === repositoryId) ?? null,
    [repositories, repositoryId],
  );

  /** 侧栏 IDE / Monaco：按节点所属仓库拼接绝对路径，避免与当前下拉仓库不一致时打开错误目录 */
  const repositoryPathForSelectedGraphNode = useMemo(() => {
    if (!repositories?.length) return currentRepo?.path ?? null;
    const rid = selectedNode?.repoId ?? repositoryId;
    if (rid == null) return currentRepo?.path ?? null;
    return repositories.find((r) => r.id === rid)?.path ?? currentRepo?.path ?? null;
  }, [repositories, selectedNode?.repoId, repositoryId, currentRepo?.path]);

  if (loading) {
    return (
      <div className="app-code-graph-panel">
        <header className="app-code-graph-header">
          <Typography.Title level={5} style={{ margin: 0 }}>
            代码图谱
          </Typography.Title>
        </header>
        <div className="app-code-graph-content">
          <div className="app-code-graph-centered-loading">
            <Spin description="加载中..." />
          </div>
        </div>
      </div>
    );
  }

  const indexWatchIds =
    indexWatchRepoIds.length > 0
      ? indexWatchRepoIds
      : repositoryId != null
        ? [repositoryId]
        : [];
  const isMultiScope = indexWatchIds.length >= 2;
  const scopedStatuses = indexWatchIds.map((id) => scopeStatusOf(scopedIndexByRepoId, id));
  const isAllDoneInScope =
    indexWatchIds.length > 0 && scopedStatuses.every((s) => s.status === "done");
  const isAnyIndexingInScope =
    projectSearchActive || scopedStatuses.some((s) => s.status === "indexing");
  const scopeIndexingDone = isMultiScope && isAllDoneInScope && projectSearchActive;
  const isIndexedForView = isMultiScope ? isAllDoneInScope : indexStatus?.status === "done";
  const showIndexingUI =
    projectSearchActive ||
    (!isIndexedForView &&
      (isAnyIndexingInScope || indexStatus?.status === "indexing"));
  const indexingProgress = isMultiScope
    ? scopeIndexingDone
      ? 95
      : aggregateScopeProgress(indexWatchIds, scopedIndexByRepoId)
    : (indexStatus?.progress ?? 1);
  const indexingTitle = isMultiScope
    ? scopeIndexingDone
      ? `正在为 ${associationScopeDisplay ?? "多仓"} 同步 GitNexus 仓库组并关联前后端 API…`
      : `正在为 ${associationScopeDisplay ?? "多仓"} 运行 GitNexus 分析…`
    : `正在为 ${currentRepo?.name ?? "该仓库"} 运行 GitNexus 分析…`;
  const isIndexed = isIndexedForView;
  const isIndexing = showIndexingUI;
  const hasData = subgraphData && subgraphData.nodes.length > 0;

  return (
    <div className="app-code-graph-panel">
      <header className="app-code-graph-header">
        <div className="app-code-graph-header-top">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Typography.Title level={5} style={{ margin: 0 }}>
              代码图谱
            </Typography.Title>
            {lockToEntryRepository ? (
              <Tag>{currentRepo?.name ?? (repositoryId != null ? `仓库 #${repositoryId}` : "当前仓库")}</Tag>
            ) : repositories && repositories.length > 0 && onSelectRepository ? (
              <CodeGraphRepositoryPopover
                repositories={repositories}
                activeRepositoryId={repositoryId}
                activeRepositoryIndexed={isIndexed && !showIndexingUI}
                menuSelection={repoDropdownSelection}
                graphScopeTriggerLabel={
                  repoDropdownSelection === "association" && associationScopeRepoIds.length > 1
                    ? associationScopeDisplay ?? `多仓库（${associationScopeRepoIds.length}）`
                    : null
                }
                onSelectRepository={handleRepoMenuPickRepository}
                onReindexRepository={handleReindexRepository}
                onRemoveRepository={onRemoveRepository}
                onOpenAddRepository={onOpenAddRepository}
                associationScopeDisplay={associationScopeDisplay}
                onViewMergedGraph={
                  associationScopeDisplay ? handleViewMergedGraphFromRepoMenu : undefined
                }
                associationScopeRepositoryIds={
                  associationScopeRepoIds.length >= 2 ? associationScopeRepoIds : undefined
                }
                onReindexAssociationScope={
                  associationScopeRepoIds.length >= 2
                    ? (ids) => void handleAssociationBuild(ids)
                    : undefined
                }
                onDismissAssociationScope={
                  associationScopeRepoIds.length >= 2 ? handleDismissAssociationScope : undefined
                }
                associationScopeDisabled={!isIndexed}
              />
            ) : currentRepo ? (
              <Tag>{currentRepo.name}</Tag>
            ) : null}
            {!lockToEntryRepository ? (
              <CodeGraphAssociationPopover
                repositories={repositories ?? []}
                candidateRepositoryIds={associationCandidateIds}
                activeRepositoryId={repositoryId}
                value={associationConfig}
                onChange={setAssociationConfig}
                onApplied={handleAssociationApplied}
                onAssociationBuild={handleAssociationBuild}
                syncDisabled={!isIndexed}
              />
            ) : null}
          </div>
          <Space>
            {indexStatus?.indexVersion && (
              <Tag color="blue">v{indexStatus.indexVersion}</Tag>
            )}
            {isIndexed && <Tag color="green">已检索</Tag>}
            {isIndexing && <Tag color="orange">检索中...</Tag>}
            {indexError && <Tag color="red">检索失败</Tag>}
            {hasData && (
              <Tag>{subgraphData!.nodes.length} 节点 · {subgraphData!.edges.length} 边</Tag>
            )}
            {onClose && (
              <Button
                type="text"
                size="small"
                icon={<CloseOutlined />}
                aria-label="关闭代码图谱"
                title="关闭"
                onClick={onClose}
              />
            )}
          </Space>
        </div>
        <div className="app-code-graph-header-actions">
          {isIndexed && repositoryId && (
            <div className="app-code-graph-subgraph-toolbar app-code-graph-subgraph-toolbar--header">
              <Typography.Text type="secondary" className="app-code-graph-subgraph-toolbar-label">
                hop
              </Typography.Text>
              <Select<SubgraphHopScope>
                size="small"
                className="app-code-graph-hop-select"
                popupMatchSelectWidth={false}
                value={subgraphHopScope}
                onChange={(v) => setSubgraphHopScope(normalizeSubgraphHopScope(v))}
                options={HOP_SELECT_OPTIONS}
                aria-label="子图 hop"
                title={
                  subgraphHopScope === "all"
                    ? "不限制 hop：子图尽量完整，画布用力导向排布。"
                    : "默认 hop 2：从焦点沿入/出边各约「两级」计代价边（contains 不占 hop）；选中节点后从后端只拉该邻域。可调大 hop 或选「全部」看更大范围。"
                }
                disabled={!hasData || subgraphLoading}
              />
              <Select
                showSearch
                allowClear
                className="app-code-graph-node-search app-code-graph-node-search--header"
                classNames={{ popup: { root: "app-code-graph-node-search-dropdown" } }}
                popupMatchSelectWidth={false}
                size="small"
                placeholder={
                  subgraphRepositoryIds.length > 1
                    ? "搜索已索引节点（多仓库：名称 / 路径）"
                    : "搜索已索引节点（名称 / 路径）"
                }
                suffixIcon={<SearchOutlined />}
                filterOption={false}
                searchValue={subgraphSearchInput}
                onSearch={setSubgraphSearchInput}
                onSelect={(id) => handleSubgraphSearchPick(String(id))}
                onClear={() => {
                  setSubgraphSearchInput("");
                  setSubgraphSearchDebounced("");
                }}
                options={subgraphSearchOptions}
                disabled={!hasData || subgraphLoading}
                notFoundContent={
                  searchRemoteLoading ? (
                    <span style={{ padding: "0 8px" }}>搜索中…</span>
                  ) : subgraphSearchDebounced.length < SUBGRAPH_SEARCH_MIN_QUERY_LEN ? (
                    `至少输入 ${SUBGRAPH_SEARCH_MIN_QUERY_LEN} 个字符`
                  ) : (
                    "无匹配节点"
                  )
                }
                listHeight={320}
                virtual={false}
              />
            </div>
          )}
          <Space size={8} wrap>
            <Button
              danger
              size="small"
              icon={<DeleteOutlined />}
              disabled={!repositoryId || showIndexingUI}
              onClick={handleClearGraphIndex}
            >
              清空索引
            </Button>
            <Tooltip
              title={
                !repositoryId
                  ? "请先选择仓库"
                  : !showIndexingUI
                    ? "当前没有正在进行的检索任务"
                    : indexStatus?.repositoryId !== repositoryId && !isMultiScope
                      ? `正在索引其他仓库（#${indexStatus?.repositoryId}），请稍候`
                      : ""
              }
              placement="top"
            >
              <Button
                size="small"
                icon={<PauseCircleOutlined />}
                onClick={() => void handlePauseReindex()}
                disabled={!repositoryId || !showIndexingUI}
              >
                暂停检索
              </Button>
            </Tooltip>
            <Button
              type="primary"
              size="small"
              icon={<PlayCircleOutlined />}
              onClick={() => void handleReindex()}
              disabled={!repositoryId || showIndexingUI}
            >
              {isIndexed ? "重新检索" : "开始检索"}
            </Button>
          </Space>
        </div>
      </header>
      <div className="app-code-graph-content">
        {!repositoryId ? (
          <Empty
            description="请从上方仓库菜单选择要检索的仓库"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : indexError ? (
          <div className="app-code-graph-index-error-wrap">
            <Alert
              type="error"
              className="app-code-graph-index-error-alert"
              message="检索失败"
              description={indexError}
              showIcon
            />
            <Button type="primary" size="small" onClick={() => void handleReindex()}>
              重试
            </Button>
          </div>
        ) : showIndexingUI ? (
            <div className="app-code-graph-centered-loading">
              <div className="app-code-graph-indexing-inner">
                <Progress
                  type="circle"
                  percent={indexingProgress}
                  size={120}
                  status="active"
                  format={(percent) => (
                    <span style={{ fontSize: 20 }}>
                      {percent ?? 0}%
                    </span>
                  )}
                />
                <Typography.Text type="secondary" style={{ textAlign: "center" }}>
                  {indexingTitle}
                </Typography.Text>
                {isMultiScope ? (
                  <Space size={[8, 8]} wrap style={{ justifyContent: "center", marginTop: 8 }}>
                    {indexWatchIds.map((id) => {
                      const repoName =
                        repositories?.find((r) => r.id === id)?.name ?? `仓库 #${id}`;
                      const status = scopeStatusOf(scopedIndexByRepoId, id);
                      const color =
                        status.status === "done"
                          ? "green"
                          : status.status === "indexing"
                            ? "orange"
                            : status.status === "error"
                              ? "red"
                              : "default";
                      return (
                        <Tag key={id} color={color}>
                          {repoName} · {repoIndexStatusLabel(status.status)}
                          {status.status === "indexing" && typeof status.progress === "number"
                            ? ` ${status.progress}%`
                            : ""}
                        </Tag>
                      );
                    })}
                  </Space>
                ) : null}
                {!isMultiScope &&
                indexStatus &&
                typeof indexStatus.indexingFilesTotal === "number" &&
                indexStatus.indexingFilesTotal > 0 ? (
                  <div style={{ marginTop: 6, textAlign: "center", maxWidth: "min(92vw, 720px)" }}>
                    <Space size={8} wrap align="start" style={{ justifyContent: "center" }}>
                      <Typography.Text type="secondary">
                        已扫描源文件 {indexStatus.indexingFilesDone ?? 0} / {indexStatus.indexingFilesTotal}
                      </Typography.Text>
                      {indexStatus.indexingCurrentFile ? (
                        <>
                          <Typography.Text type="secondary">·</Typography.Text>
                          <Typography.Text
                            copyable={{ text: indexStatus.indexingCurrentFile }}
                            code
                            ellipsis={{ tooltip: indexStatus.indexingCurrentFile }}
                            style={{ maxWidth: "min(80vw, 520px)", textAlign: "left" }}
                          >
                            {indexStatus.indexingCurrentFile}
                          </Typography.Text>
                        </>
                      ) : null}
                    </Space>
                  </div>
                ) : null}
                <Typography.Paragraph
                  type="secondary"
                  style={{ textAlign: "center", maxWidth: 420, marginTop: 8, marginBottom: 0, fontSize: 12 }}
                >
                  {isMultiScope
                    ? "多仓检索包含各仓 GitNexus 分析、仓库组同步与前后端 API 关联；完成后将自动展示合并图谱。"
                    : "大仓库单文件解析可能很慢；若路径长时间不变，说明正卡在该文件的读取或解析。可点上方「暂停检索」随时停止，或关闭面板稍候后再点「重新检索」重试。"}
                </Typography.Paragraph>
              </div>
            </div>
        ) : !isIndexed ? (
            <Empty
              description={
                associationScopeRepoIds.length >= 2
                  ? `尚未建立知识图谱，点击上方「开始检索」为多仓（${associationScopeDisplay}）建立索引并关联前后端 API`
                  : `尚未建立知识图谱，点击上方「开始检索」为 ${currentRepo?.name ?? "该仓库"} 进行全仓分析`
              }
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
        ) : (
          renderIndexedBody()
        )}
      </div>
    </div>
  );
}

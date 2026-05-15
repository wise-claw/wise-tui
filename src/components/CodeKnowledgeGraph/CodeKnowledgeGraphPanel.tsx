import { listen } from "@tauri-apps/api/event";
import {
  CloseOutlined,
  PlayCircleOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { Alert, Button, Empty, message, Progress, Select, Space, Spin, Tag, Typography } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getCodeGraphIndexStatus,
  getCodeGraphMultiSubgraph,
  getCodeGraphSubgraph,
  searchCodeGraphNodes,
  triggerCodeGraphAssociationBuild,
  triggerCodeGraphReindex,
} from "../../services/codeKnowledgeGraph";
import { filterGraphNodesForSearch } from "../../utils/codeGraphNodeSearch";
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
import { CodeGraphRepositoryPopover } from "./CodeGraphRepositoryPopover";
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

function normalizeSubgraphHopScope(v: unknown): SubgraphHopScope {
  if (v === "all") return "all";
  const n =
    typeof v === "string" ? Number.parseInt(String(v).trim(), 10) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n)) return 3;
  const clamped = Math.min(10, Math.max(1, Math.floor(Number(n))));
  return clamped as SubgraphHopScope;
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
}: Props) {
  const [indexStatus, setIndexStatus] = useState<CodeGraphIndexStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [reindexing, setReindexing] = useState(false);
  const [subgraphData, setSubgraphData] = useState<CodeGraphSubgraphResponse | null>(null);
  const [subgraphHopScope, setSubgraphHopScope] = useState<SubgraphHopScope>(3);
  const [subgraphFocusId, setSubgraphFocusId] = useState<string | undefined>(undefined);
  /** `undefined`：双向子图 */
  const [subgraphDirection, setSubgraphDirection] = useState<CodeGraphSubgraphDirection | undefined>(undefined);
  /** 上卷/下钻与当前状态相同时仍须重拉子图（按工具栏层数），递增以触发 effect */
  const [subgraphRefreshKey, setSubgraphRefreshKey] = useState(0);
  /** 多仓合并范围：候选来自 `searchRepositoryIds` 或仅当前仓 */
  const [associationConfig, setAssociationConfig] = useState<AssociationGraphConfig>({
    mode: "all",
    customRepositoryIds: [],
  });
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [subgraphLoading, setSubgraphLoading] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chartColumnRef = useRef<CodeKnowledgeGraphChartColumnHandle | null>(null);
  const splitLayoutRef = useRef<HTMLDivElement | null>(null);
  /** 图谱列占 split 区域宽度的百分比（右侧为剩余 + 中间 6px 分隔条） */
  const [graphPanePercent, setGraphPanePercent] = useState(GRAPH_PANE_DEFAULT_PCT);
  const [subgraphSearchInput, setSubgraphSearchInput] = useState("");
  const [subgraphSearchDebounced, setSubgraphSearchDebounced] = useState("");
  const [searchRemoteHits, setSearchRemoteHits] = useState<GraphNode[]>([]);
  const [searchRemoteLoading, setSearchRemoteLoading] = useState(false);
  const pendingCrossRepoSearchPickRef = useRef<GraphNode | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!repositoryId) {
      setLoading(false);
      return;
    }
    try {
      const status = await getCodeGraphIndexStatus(repositoryId);
      setIndexStatus(status);

      if (status.status === "done") {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } else if (status.status === "error") {
        setIndexError(status.error ?? "索引失败");
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } else if (status.status === "indexing") {
        // Start polling for index completion
        if (!pollRef.current) {
          pollRef.current = setInterval(() => {
            void fetchStatus();
          }, 2000);
        }
      }
    } catch {
      // Ignore fetch errors
    } finally {
      setLoading(false);
    }
  }, [repositoryId]);

  // Listen for index events from the spawned Rust task
  useEffect(() => {
    const unsubs: Promise<() => void>[] = [];

    const completeUnsub = listen("code-graph-index-complete", (event: any) => {
      if (event.payload?.repositoryId === repositoryId) {
        setIndexError(null);
        void fetchStatus();
      }
    });
    unsubs.push(completeUnsub);

    const errorUnsub = listen("code-graph-index-error", (event: any) => {
      if (event.payload?.repositoryId === repositoryId) {
        setIndexError(event.payload.error ?? "索引失败");
        if (repositoryId) {
          setIndexStatus({ status: "error", repositoryId, progress: 0 });
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
        message.success("多仓关联图谱构建完成");
      }
    });
    unsubs.push(assocOk);

    const assocErr = listen("code-graph-association-build-error", (event: any) => {
      message.error(String(event.payload?.error ?? "多仓关联构建失败"));
      const raw = event.payload?.repositoryIds;
      const ids: number[] = Array.isArray(raw)
        ? raw.filter((x: unknown) => typeof x === "number" && Number.isFinite(x))
        : [];
      if (repositoryId != null && ids.includes(repositoryId)) {
        void fetchStatus();
      }
    });
    unsubs.push(assocErr);

    return () => {
      unsubs.forEach((p) => p.then((fn) => fn()));
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
    setSubgraphHopScope(3);
    setSubgraphDirection(undefined);
    setSubgraphRefreshKey(0);
    setSelectedNode(null);
    setSubgraphData(null);
    setGraphPanePercent(GRAPH_PANE_DEFAULT_PCT);
    setSubgraphSearchInput("");
    setSubgraphSearchDebounced("");
    setSearchRemoteHits([]);
    setAssociationConfig({ mode: "all", customRepositoryIds: [] });
  }, [repositoryId]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setSubgraphSearchDebounced(subgraphSearchInput.trim());
    }, SUBGRAPH_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [subgraphSearchInput]);

  const associationCandidateIds = useMemo(() => {
    const fromProp =
      searchRepositoryIdsProp?.filter((id) => typeof id === "number" && Number.isFinite(id)) ?? [];
    const base =
      fromProp.length > 0
        ? fromProp
        : repositoryId != null
          ? [repositoryId]
          : [];
    return [...new Set(base)].slice(0, 20);
  }, [searchRepositoryIdsProp, repositoryId]);

  const resolvedGraphRepoIds = useMemo(() => {
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

  /** 仓库菜单内多仓入口文案，如 (vocs-web + crewAI) */
  const associationScopeDisplay = useMemo(() => {
    const ids = resolvedGraphRepoIds;
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
  }, [resolvedGraphRepoIds, repositories]);

  useEffect(() => {
    if (!repositoryId) {
      setSubgraphLoading(false);
      return;
    }
    if (indexStatus?.status !== "done" || indexStatus.repositoryId !== repositoryId) {
      setSubgraphLoading(false);
      return;
    }

    const uniqueIds = [...new Set(resolvedGraphRepoIds)].filter((id) => Number.isFinite(id)) as number[];
    const targetIds = uniqueIds.length > 0 ? uniqueIds : [repositoryId];

    let cancelled = false;
    setSubgraphLoading(true);

    void (async () => {
      try {
        if (targetIds.length === 1) {
          const rid = targetIds[0];
          const req: CodeGraphSubgraphRequest = { repositoryId: rid };
          if (subgraphFocusId) req.focusNodeId = subgraphFocusId;
          if (subgraphHopScope !== "all") req.hop = subgraphHopScope;
          if (subgraphDirection) req.direction = subgraphDirection;
          const raw = await getCodeGraphSubgraph(req);
          if (cancelled) return;
          setSubgraphData(parseCodeGraphSubgraphResponse(raw));
        } else {
          const hopArg = subgraphHopScope === "all" ? undefined : subgraphHopScope;
          const raw = await getCodeGraphMultiSubgraph(targetIds, {
            focusNodeId: subgraphFocusId,
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
    resolvedGraphRepoIds,
    subgraphFocusId,
    subgraphHopScope,
    subgraphDirection,
    subgraphRefreshKey,
  ]);

  useEffect(() => {
    if (subgraphSearchDebounced.length < SUBGRAPH_SEARCH_MIN_QUERY_LEN) {
      setSearchRemoteHits([]);
      setSearchRemoteLoading(false);
      return;
    }
    if (!repositoryId || resolvedGraphRepoIds.length === 0) {
      setSearchRemoteHits([]);
      setSearchRemoteLoading(false);
      return;
    }
    if (indexStatus?.status !== "done" || indexStatus.repositoryId !== repositoryId) {
      setSearchRemoteHits([]);
      setSearchRemoteLoading(false);
      return;
    }

    let cancelled = false;
    setSearchRemoteLoading(true);

    void (async () => {
      try {
        const raw = await searchCodeGraphNodes({
          repositoryIds: resolvedGraphRepoIds,
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
    resolvedGraphRepoIds,
    repositoryId,
    indexStatus?.status,
    indexStatus?.repositoryId,
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
    setReindexing(true);
    setSubgraphData(null);
    setSelectedNode(null);
    setSubgraphFocusId(undefined);
    setSubgraphHopScope(3);
    setSubgraphDirection(undefined);
    setSubgraphRefreshKey(0);
    try {
      await triggerCodeGraphReindex({ repositoryId });
      setIndexStatus({ status: "indexing", repositoryId, progress: 1 });
      setIndexError(null);
    } catch {
      // Show error in status
    } finally {
      setReindexing(false);
    }
  }, [repositoryId]);

  const handleReindexRepository = useCallback(
    async (targetId: number) => {
      if (targetId === repositoryId) {
        await handleReindex();
        return;
      }
      try {
        await triggerCodeGraphReindex({ repositoryId: targetId });
        const name = repositories?.find((r) => r.id === targetId)?.name ?? String(targetId);
        message.success(`已为「${name}」提交重建索引`);
      } catch {
        message.error("提交索引失败");
      }
    },
    [repositoryId, handleReindex, repositories],
  );

  const handleAssociationBuild = useCallback(async (ids: number[]) => {
    if (ids.length < 2) return;
    try {
      await triggerCodeGraphAssociationBuild(ids);
      message.info("已在后台开始多仓关联构建（各仓索引、OpenAPI/合成路由、HTTP 桥接），请稍候。");
    } catch {
      message.error("提交多仓关联构建失败");
    }
  }, []);

  /** 仓库菜单内「合并图谱」入口：清空画布并强制重拉当前关联范围内的多仓子图 */
  const handleViewMergedGraphFromRepoMenu = useCallback(() => {
    if (resolvedGraphRepoIds.length < 2) return;
    setSelectedNode(null);
    setSubgraphFocusId(undefined);
    setSubgraphDirection(undefined);
    setSubgraphHopScope(3);
    setSubgraphData(null);
    setSubgraphRefreshKey((k) => k + 1);
  }, [resolvedGraphRepoIds]);

  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelectedNode(node);
  }, []);

  const handleStageClearSelection = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const handleSubgraphRollUp = useCallback(() => {
    if (!selectedNode) return;
    setSubgraphFocusId(selectedNode.id);
    setSubgraphDirection("upstream");
    setSubgraphRefreshKey((k) => k + 1);
  }, [selectedNode]);

  const handleSubgraphDrillDown = useCallback(() => {
    if (!selectedNode) return;
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
        resolvedGraphRepoIds.length > 1
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
    resolvedGraphRepoIds.length,
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
          description="子图为空，当前仓库可能无已索引的源码或配置（与 GitNexus 语言扩展对齐，含 Spring Boot 常用文件）"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      );
    }
    const data = subgraphData!;
    return (
      <div className="app-code-graph-split-with-overlay">
        {subgraphLoading && (
          <div className="app-code-graph-refresh-overlay" aria-busy="true" aria-live="polite">
            <Spin description="按新范围加载子图…" />
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
                repositoryPath={repositoryPathForSelectedGraphNode}
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

  const subgraphHopLabel = useMemo(
    () => (subgraphHopScope === "all" ? "全部" : `${subgraphHopScope} 层`),
    [subgraphHopScope],
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

  const isIndexed = indexStatus?.status === "done";
  const isIndexing = indexStatus?.status === "indexing";
  const hasData = subgraphData && subgraphData.nodes.length > 0;

  return (
    <div className="app-code-graph-panel">
      <header className="app-code-graph-header">
        <div className="app-code-graph-header-top">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Typography.Title level={5} style={{ margin: 0 }}>
              代码图谱
            </Typography.Title>
            {repositories && repositories.length > 0 && onSelectRepository ? (
              <CodeGraphRepositoryPopover
                repositories={repositories}
                activeRepositoryId={repositoryId}
                activeRepositoryIndexed={isIndexed && indexStatus?.repositoryId === repositoryId}
                graphScopeTriggerLabel={
                  resolvedGraphRepoIds.length > 1
                    ? associationScopeDisplay ?? `多仓库（${resolvedGraphRepoIds.length}）`
                    : null
                }
                onSelectRepository={onSelectRepository}
                onReindexRepository={handleReindexRepository}
                onRemoveRepository={onRemoveRepository}
                onOpenAddRepository={onOpenAddRepository}
                associationScopeDisplay={associationScopeDisplay}
                onViewMergedGraph={
                  associationScopeDisplay ? handleViewMergedGraphFromRepoMenu : undefined
                }
                associationScopeDisabled={!isIndexed}
              />
            ) : currentRepo ? (
              <Tag>{currentRepo.name}</Tag>
            ) : null}
            <CodeGraphAssociationPopover
              repositories={repositories ?? []}
              candidateRepositoryIds={associationCandidateIds}
              activeRepositoryId={repositoryId}
              value={associationConfig}
              onChange={setAssociationConfig}
              onApplied={() => setSubgraphRefreshKey((k) => k + 1)}
              onAssociationBuild={handleAssociationBuild}
              disabled={!isIndexed}
            />
          </div>
          <Space>
            {indexStatus?.indexVersion && (
              <Tag color="blue">v{indexStatus.indexVersion}</Tag>
            )}
            {isIndexed && <Tag color="green">已索引</Tag>}
            {isIndexing && <Tag color="orange">索引中...</Tag>}
            {indexError && <Tag color="red">索引失败</Tag>}
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
                范围
              </Typography.Text>
              <Select<SubgraphHopScope>
                size="small"
                className="app-code-graph-hop-select"
                popupMatchSelectWidth={false}
                value={subgraphHopScope}
                onChange={(v) => setSubgraphHopScope(normalizeSubgraphHopScope(v))}
                options={HOP_SELECT_OPTIONS}
                aria-label="子图层数"
                disabled={!hasData || subgraphLoading}
              />
              <Select
                showSearch
                allowClear
                className="app-code-graph-node-search app-code-graph-node-search--header"
                size="small"
                placeholder={
                  resolvedGraphRepoIds.length > 1
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
                virtual={subgraphSearchOptions.length > 120}
              />
            </div>
          )}
          <Button
            type="primary"
            size="small"
            icon={reindexing ? <Spin size="small" /> : <PlayCircleOutlined />}
            onClick={handleReindex}
            disabled={!repositoryId || reindexing}
            loading={reindexing}
          >
            {isIndexed ? "重建索引" : "开始索引"}
          </Button>
        </div>
      </header>
      <div className="app-code-graph-content">
        {!repositoryId ? (
          <Empty
            description="请从上方仓库菜单选择要索引的仓库"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : indexError ? (
          <div style={{ maxWidth: 480, padding: 24 }}>
            <Alert
              type="error"
              message="索引失败"
              description={indexError}
              showIcon
              style={{ marginBottom: 16 }}
            />
            <Button type="primary" onClick={handleReindex} disabled={reindexing}>
              重试
            </Button>
          </div>
        ) : !isIndexed ? (
          isIndexing ? (
            <div style={{ textAlign: "center", maxWidth: 320, padding: 24 }}>
              <div style={{ marginBottom: 16 }}>
                <Spin size="large" />
              </div>
              <Progress
                type="circle"
                percent={indexStatus?.progress ?? 0}
                size={120}
                format={(percent) => (
                  <span style={{ fontSize: 20 }}>
                    {percent ?? 0}%
                  </span>
                )}
              />
              <Typography.Text type="secondary" style={{ marginTop: 16, display: "block" }}>
                正在为 {currentRepo?.name ?? "该仓库"} 建立索引...
              </Typography.Text>
            </div>
          ) : (
            <Empty
              description={
                `尚未建立知识图谱索引，点击上方「开始索引」为 ${currentRepo?.name ?? "该仓库"} 建立索引`
              }
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            >
              <Button type="primary" onClick={handleReindex} disabled={reindexing}>
                开始索引
              </Button>
            </Empty>
          )
        ) : (
          renderIndexedBody()
        )}
      </div>
    </div>
  );
}

import { listen } from "@tauri-apps/api/event";
import {
  CloseOutlined,
  PlayCircleOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { Alert, Button, Empty, Progress, Select, Space, Spin, Tag, Typography } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getCodeGraphIndexStatus,
  getCodeGraphSubgraph,
  searchCodeGraphNodes,
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
import { InspectorPanel } from "./InspectorPanel";
import "./CodeKnowledgeGraphPanel.css";

interface RepositoryInfo {
  id: number;
  name: string;
  path: string;
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

export function CodeKnowledgeGraphPanel({
  repositoryId,
  repositories,
  searchRepositoryIds: searchRepositoryIdsProp,
  onSelectRepository,
  onClose,
  onOpenRepositoryFile,
}: Props) {
  const [indexStatus, setIndexStatus] = useState<CodeGraphIndexStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [reindexing, setReindexing] = useState(false);
  const [subgraphData, setSubgraphData] = useState<CodeGraphSubgraphResponse | null>(null);
  const [subgraphHopScope, setSubgraphHopScope] = useState<SubgraphHopScope>(3);
  const [subgraphFocusId, setSubgraphFocusId] = useState<string | undefined>(undefined);
  /** `undefined`：双向子图 */
  const [subgraphDirection, setSubgraphDirection] = useState<CodeGraphSubgraphDirection | undefined>(undefined);
  /** 上卷/下钻与当前状态相同时仍须重拉子图（按工具栏跳数），递增以触发 effect */
  const [subgraphRefreshKey, setSubgraphRefreshKey] = useState(0);
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
  }, [repositoryId]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setSubgraphSearchDebounced(subgraphSearchInput.trim());
    }, SUBGRAPH_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [subgraphSearchInput]);

  useEffect(() => {
    if (!repositoryId) {
      setSubgraphLoading(false);
      return;
    }
    if (indexStatus?.status !== "done" || indexStatus.repositoryId !== repositoryId) {
      setSubgraphLoading(false);
      return;
    }

    let cancelled = false;
    setSubgraphLoading(true);

    (async () => {
      try {
        const req: CodeGraphSubgraphRequest = { repositoryId };
        if (subgraphFocusId) req.focusNodeId = subgraphFocusId;
        if (subgraphHopScope !== "all") req.hop = subgraphHopScope;
        if (subgraphDirection) req.direction = subgraphDirection;
        const raw = await getCodeGraphSubgraph(req);
        if (cancelled) return;
        setSubgraphData(parseCodeGraphSubgraphResponse(raw));
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
    subgraphFocusId,
    subgraphHopScope,
    subgraphDirection,
    subgraphRefreshKey,
  ]);

  const effectiveSearchRepoIds = useMemo(() => {
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

  useEffect(() => {
    if (subgraphSearchDebounced.length < SUBGRAPH_SEARCH_MIN_QUERY_LEN) {
      setSearchRemoteHits([]);
      setSearchRemoteLoading(false);
      return;
    }
    if (!repositoryId || effectiveSearchRepoIds.length === 0) {
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
          repositoryIds: effectiveSearchRepoIds,
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
    effectiveSearchRepoIds,
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
        effectiveSearchRepoIds.length > 1
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
    effectiveSearchRepoIds.length,
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
    if (subgraphLoading) {
      return (
        <div className="app-code-graph-centered-loading">
          <Spin tip="加载子图中..." />
        </div>
      );
    }
    if (subgraphData && subgraphData.nodes.length > 0) {
      return (
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
              subgraphData={subgraphData}
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
      );
    }
    return (
      <Empty
        description="子图为空，当前仓库可能无已索引的源码或配置（与 GitNexus 语言扩展对齐，含 Spring Boot 常用文件）"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    );
  };

  const currentRepo = useMemo(
    () => repositories?.find((r) => r.id === repositoryId) ?? null,
    [repositories, repositoryId],
  );

  const subgraphHopLabel = useMemo(
    () => (subgraphHopScope === "all" ? "全部" : `${subgraphHopScope} 跳`),
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
            <Spin tip="加载中..." />
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
            {currentRepo && (
              <Tag>{currentRepo.name}</Tag>
            )}
            {onSelectRepository && repositories && repositories.length > 1 && (
              <Select
                size="small"
                style={{ width: 160 }}
                placeholder="选择仓库"
                value={repositoryId}
                onChange={(id: number) => onSelectRepository(id)}
                options={repositories.map((r) => ({ label: r.name, value: r.id }))}
              />
            )}
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
          {isIndexed && repositoryId && !subgraphLoading && (
            <div className="app-code-graph-subgraph-toolbar app-code-graph-subgraph-toolbar--header">
              <Typography.Text type="secondary" className="app-code-graph-subgraph-toolbar-label">
                范围
              </Typography.Text>
              <Select<SubgraphHopScope>
                size="small"
                className="app-code-graph-hop-select"
                popupMatchSelectWidth={false}
                value={subgraphHopScope}
                onChange={setSubgraphHopScope}
                options={HOP_SELECT_OPTIONS}
                aria-label="子图跳数"
                disabled={!hasData}
              />
              <Select
                showSearch
                allowClear
                className="app-code-graph-node-search app-code-graph-node-search--header"
                size="small"
                placeholder={
                  effectiveSearchRepoIds.length > 1
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
            description="请先选择要索引的仓库"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          >
            {onSelectRepository && repositories && repositories.length > 0 && (
              <Select
                style={{ width: 200 }}
                placeholder="选择仓库"
                onChange={(id: number) => onSelectRepository(id)}
                options={repositories.map((r) => ({ label: r.name, value: r.id }))}
              />
            )}
          </Empty>
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

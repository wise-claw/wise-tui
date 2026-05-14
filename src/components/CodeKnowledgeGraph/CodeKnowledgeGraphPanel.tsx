import { listen } from "@tauri-apps/api/event";
import {
  PlayCircleOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { Alert, Button, Empty, Progress, Select, Space, Spin, Tag, Typography } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getCodeGraphIndexStatus,
  getCodeGraphSubgraph,
  triggerCodeGraphReindex,
} from "../../services/codeKnowledgeGraph";
import { filterGraphNodesForSearch } from "../../utils/codeGraphNodeSearch";
import { parseCodeGraphSubgraphResponse } from "../../utils/codeKnowledgeGraphResponse";
import type {
  CodeGraphIndexStatusResponse,
  CodeGraphSubgraphDirection,
  CodeGraphSubgraphRequest,
  CodeGraphSubgraphResponse,
  GraphNode,
} from "../../types/codeKnowledgeGraph";
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
  onSelectRepository?: (repoId: number) => void;
  onClose?: () => void;
  /** 在仓库内置编辑器（Monaco）中打开相对路径 */
  onOpenRepositoryFile?: (relativePath: string) => void;
}

const SUBGRAPH_SEARCH_DEBOUNCE_MS = 220;
const SUBGRAPH_SEARCH_MIN_QUERY_LEN = 1;

export function CodeKnowledgeGraphPanel({
  repositoryId,
  repositories,
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
  /** `undefined`：双向子图；侧栏「展开子图」会清回双向 */
  const [subgraphDirection, setSubgraphDirection] = useState<CodeGraphSubgraphDirection | undefined>(undefined);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [subgraphLoading, setSubgraphLoading] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chartColumnRef = useRef<CodeKnowledgeGraphChartColumnHandle | null>(null);
  const [subgraphSearchInput, setSubgraphSearchInput] = useState("");
  const [subgraphSearchDebounced, setSubgraphSearchDebounced] = useState("");

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
    setSubgraphFocusId(undefined);
    setSubgraphHopScope(3);
    setSubgraphDirection(undefined);
    setSelectedNode(null);
    setSubgraphData(null);
  }, [repositoryId]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setSubgraphSearchDebounced(subgraphSearchInput.trim());
    }, SUBGRAPH_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [subgraphSearchInput]);

  useEffect(() => {
    setSubgraphSearchInput("");
    setSubgraphSearchDebounced("");
  }, [subgraphData]);

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
  }, [repositoryId, indexStatus?.status, indexStatus?.repositoryId, subgraphFocusId, subgraphHopScope, subgraphDirection]);

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

  const handleNodeExpand = useCallback((node: GraphNode) => {
    setSubgraphFocusId(node.id);
    setSubgraphDirection(undefined);
    setSelectedNode(node);
  }, []);

  const handleSubgraphRollUp = useCallback(() => {
    if (!selectedNode) return;
    setSubgraphFocusId(selectedNode.id);
    setSubgraphDirection("upstream");
  }, [selectedNode]);

  const handleSubgraphDrillDown = useCallback(() => {
    if (!selectedNode) return;
    setSubgraphFocusId(selectedNode.id);
    setSubgraphDirection("downstream");
  }, [selectedNode]);

  const subgraphSearchOptions = useMemo(() => {
    if (!subgraphData?.nodes.length) return [];
    if (subgraphSearchDebounced.length < SUBGRAPH_SEARCH_MIN_QUERY_LEN) return [];
    return filterGraphNodesForSearch(subgraphData.nodes, subgraphSearchDebounced).map((node) => ({
      value: node.id,
      label: (
        <div className="app-code-graph-search-option">
          <span className="app-code-graph-search-option-title">{node.label}</span>
          <span className="app-code-graph-search-option-meta">
            {node.kind} · {node.path}
          </span>
        </div>
      ),
    }));
  }, [subgraphData?.nodes, subgraphSearchDebounced]);

  const handleSubgraphSearchPick = useCallback(
    (nodeId: string) => {
      if (!subgraphData?.nodes.length) return;
      const node = subgraphData.nodes.find((x) => x.id === nodeId);
      if (!node) return;
      handleNodeClick(node);
      setSubgraphSearchInput("");
      setSubgraphSearchDebounced("");
      requestAnimationFrame(() => {
        chartColumnRef.current?.focusNodeById(nodeId);
      });
    },
    [subgraphData, handleNodeClick],
  );

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
          className="app-code-graph-graph-root"
          style={{
            display: "flex",
            flex: 1,
            alignSelf: "stretch",
            width: "100%",
            minWidth: 0,
            minHeight: 0,
          }}
        >
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
          <div style={{ width: 280, borderLeft: "1px solid var(--ant-color-border)", overflow: "auto" }}>
            <InspectorPanel
              node={selectedNode}
              onNodeExpand={handleNodeExpand}
              onOpenRepositoryFile={onOpenRepositoryFile}
              repositoryId={repositoryId}
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
                icon={<ReloadOutlined />}
                onClick={onClose}
              />
            )}
          </Space>
        </div>
        <div className="app-code-graph-header-actions">
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
          {isIndexed && hasData && !subgraphLoading && subgraphData && (
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
              />
              <div className="app-code-graph-subgraph-toolbar-spacer" aria-hidden />
              <Select
                showSearch
                allowClear
                className="app-code-graph-node-search"
                size="small"
                placeholder="搜索节点（名称 / 路径）"
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
                  subgraphSearchDebounced.length < SUBGRAPH_SEARCH_MIN_QUERY_LEN
                    ? `至少输入 ${SUBGRAPH_SEARCH_MIN_QUERY_LEN} 个字符`
                    : "无匹配节点"
                }
                listHeight={320}
                virtual={subgraphData.nodes.length > 120}
              />
            </div>
          )}
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

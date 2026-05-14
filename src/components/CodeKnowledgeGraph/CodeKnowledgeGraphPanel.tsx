import {
  PlayCircleOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { Button, Empty, Select, Space, Spin, Tag, Typography } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getCodeGraphIndexStatus,
  getCodeGraphSubgraph,
  triggerCodeGraphReindex,
} from "../../services/codeKnowledgeGraph";
import { parseCodeGraphSubgraphResponse } from "../../utils/codeKnowledgeGraphResponse";
import type { CodeGraphIndexStatusResponse, CodeGraphSubgraphResponse, GraphNode } from "../../types/codeKnowledgeGraph";
import { GraphCanvas } from "./GraphCanvas";
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
}

export function CodeKnowledgeGraphPanel({ repositoryId, repositories, onSelectRepository, onClose }: Props) {
  const [indexStatus, setIndexStatus] = useState<CodeGraphIndexStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [reindexing, setReindexing] = useState(false);
  const [subgraphData, setSubgraphData] = useState<CodeGraphSubgraphResponse | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [subgraphLoading, setSubgraphLoading] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!repositoryId) {
      setLoading(false);
      return;
    }
    try {
      const status = await getCodeGraphIndexStatus(repositoryId);
      setIndexStatus(status);

      // If indexed, fetch subgraph
      if (status.status === "done") {
        setSubgraphLoading(true);
        try {
          const raw = await getCodeGraphSubgraph({ repositoryId, hop: 1 });
          const parsed = parseCodeGraphSubgraphResponse(raw);
          setSubgraphData(parsed);
        } catch {
          // Ignore subgraph fetch errors
        } finally {
          setSubgraphLoading(false);
        }

        // Stop polling once indexed
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
    try {
      await triggerCodeGraphReindex({ repositoryId });
      setIndexStatus({ status: "indexing", repositoryId });
    } catch {
      // Show error in status
    } finally {
      setReindexing(false);
    }
  }, [repositoryId]);

  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelectedNode(node);
  }, []);

  const handleNodeExpand = useCallback(
    async (node: GraphNode) => {
      if (!repositoryId) return;
      setSubgraphLoading(true);
      try {
        const raw = await getCodeGraphSubgraph({ repositoryId, focusNodeId: node.id, hop: 1 });
        const parsed = parseCodeGraphSubgraphResponse(raw);
        setSubgraphData(parsed);
        setSelectedNode(node);
      } catch {
        // Ignore errors
      } finally {
        setSubgraphLoading(false);
      }
    },
    [repositoryId],
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

  const graphContent = useMemo(() => {
    if (subgraphLoading) {
      return <Spin tip="加载子图中..." />;
    }
    if (subgraphData && subgraphData.nodes.length > 0) {
      return (
        <div style={{ display: "flex", height: "100%", width: "100%" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <GraphCanvas data={subgraphData} onNodeClick={handleNodeClick} />
          </div>
          <div style={{ width: 280, borderLeft: "1px solid var(--ant-color-border)", overflow: "auto" }}>
            <InspectorPanel
              node={selectedNode}
              onNodeExpand={handleNodeExpand}
              repositoryId={repositoryId}
            />
          </div>
        </div>
      );
    }
    return (
      <Empty
        description="子图为空，当前仓库可能无 TypeScript/JavaScript 文件"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    );
  }, [subgraphLoading, subgraphData, selectedNode, handleNodeClick, handleNodeExpand, repositoryId]);

  const currentRepo = useMemo(
    () => repositories?.find((r) => r.id === repositoryId) ?? null,
    [repositories, repositoryId],
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
          <Spin tip="加载中..." />
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
        ) : !isIndexed ? (
          <Empty
            description={
              isIndexing
                ? "正在索引代码，请稍候..."
                : `尚未建立知识图谱索引，点击上方「开始索引」为 ${currentRepo?.name ?? "该仓库"} 建立索引`
            }
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          >
            {!isIndexing && (
              <Button type="primary" onClick={handleReindex} disabled={reindexing}>
                开始索引
              </Button>
            )}
          </Empty>
        ) : (
          graphContent
        )}
      </div>
    </div>
  );
}

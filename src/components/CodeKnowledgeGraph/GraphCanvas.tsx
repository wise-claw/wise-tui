import type { GraphNode, CodeGraphSubgraphResponse } from "../../types/codeKnowledgeGraph";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ZoomInOutlined,
  ZoomOutOutlined,
  ArrowsAltOutlined,
  AimOutlined,
  RollbackOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
} from "@ant-design/icons";
import { useCodeGraphSigma } from "../../hooks/useCodeGraphSigma";
import { codeSubgraphToGraphology } from "../../utils/codeGraphSigmaAdapter";
import "./CodeKnowledgeGraphPanel.css";

interface GraphCanvasProps {
  data: CodeGraphSubgraphResponse | null;
  onNodeClick?: (node: GraphNode) => void;
  /** Mirrors GitNexus: clearing canvas selection updates app state */
  onStageClick?: () => void;
  /** Current inspector / app selection — drives Focus control and sync after `setGraph` */
  selectedNode?: GraphNode | null;
}

export function GraphCanvas({ data, onNodeClick, onStageClick, selectedNode }: GraphCanvasProps) {
  const nodeById = useMemo(() => {
    if (!data) return new Map<string, GraphNode>();
    return new Map(data.nodes.map((n) => [n.id, n]));
  }, [data]);

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      const node = nodeById.get(nodeId);
      if (node) onNodeClick?.(node);
    },
    [nodeById, onNodeClick],
  );

  const [hoveredLabel, setHoveredLabel] = useState<string | null>(null);

  const handleNodeHover = useCallback(
    (nodeId: string | null) => {
      if (!nodeId || !data) {
        setHoveredLabel(null);
        return;
      }
      const node = nodeById.get(nodeId);
      setHoveredLabel(node?.label ?? null);
    },
    [data, nodeById],
  );

  const {
    containerRef,
    sigmaRef,
    sigmaReady,
    setGraph,
    zoomIn,
    zoomOut,
    resetZoom,
    focusNode,
    isLayoutRunning,
    startLayout,
    stopLayout,
    selectedNode: sigmaSelectedId,
    setSelectedNode: setSigmaSelectedNode,
  } = useCodeGraphSigma({
    onNodeClick: handleNodeClick,
    onNodeHover: handleNodeHover,
    onStageClick,
  });

  useEffect(() => {
    if (!sigmaReady || !data || data.nodes.length === 0) return;
    const g = codeSubgraphToGraphology(data);
    setGraph(g);
  }, [sigmaReady, data, setGraph]);

  useEffect(() => {
    if (selectedNode) setSigmaSelectedNode(selectedNode.id);
    else setSigmaSelectedNode(null);
  }, [selectedNode, setSigmaSelectedNode]);

  const handleFocusSelected = useCallback(() => {
    if (selectedNode) focusNode(selectedNode.id);
  }, [selectedNode, focusNode]);

  const handleClearSelection = useCallback(() => {
    onStageClick?.();
    setSigmaSelectedNode(null);
    resetZoom();
  }, [onStageClick, setSigmaSelectedNode, resetZoom]);

  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma || !sigmaReady) return;
    const onResize = () => sigma.resize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [sigmaRef, sigmaReady]);

  if (!data || data.nodes.length === 0) return null;

  return (
    <div className="app-graph-canvas-root">
      <div className="app-graph-canvas-gradient" aria-hidden />

      <div ref={containerRef} className="sigma-container app-graph-sigma-host" />

      {hoveredLabel && !sigmaSelectedId && (
        <div className="app-graph-hover-chip">
          <span className="app-graph-hover-chip-text">{hoveredLabel}</span>
        </div>
      )}

      {sigmaSelectedId && selectedNode && (
        <div className="app-graph-selection-chip">
          <span className="app-graph-selection-dot" />
          <span className="app-graph-hover-chip-text">{selectedNode.label}</span>
          <span className="app-graph-selection-kind">({selectedNode.kind})</span>
          <button type="button" className="app-graph-selection-clear" onClick={handleClearSelection}>
            清除
          </button>
        </div>
      )}

      <div className="app-graph-controls">
        <ControlBtn onClick={zoomIn} title="放大">
          <ZoomInOutlined />
        </ControlBtn>
        <ControlBtn onClick={zoomOut} title="缩小">
          <ZoomOutOutlined />
        </ControlBtn>
        <ControlBtn onClick={resetZoom} title="适应屏幕">
          <ArrowsAltOutlined />
        </ControlBtn>

        <div className="app-graph-controls-divider" />

        {selectedNode && (
          <ControlBtn onClick={handleFocusSelected} title="聚焦选中节点" accent>
            <AimOutlined />
          </ControlBtn>
        )}

        {sigmaSelectedId && (
          <ControlBtn onClick={handleClearSelection} title="清除选中">
            <RollbackOutlined />
          </ControlBtn>
        )}

        <div className="app-graph-controls-divider" />

        <ControlBtn
          onClick={isLayoutRunning ? stopLayout : startLayout}
          title={isLayoutRunning ? "停止布局" : "重新布局"}
          accent={isLayoutRunning}
          pulse={isLayoutRunning}
        >
          {isLayoutRunning ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
        </ControlBtn>
      </div>

      {isLayoutRunning && (
        <div className="app-graph-layout-toast">
          <span className="app-graph-layout-dot" />
          <span className="app-graph-layout-text">布局优化中…</span>
        </div>
      )}
    </div>
  );
}

function ControlBtn({
  children,
  onClick,
  title,
  accent,
  pulse,
}: {
  children: ReactNode;
  onClick: () => void;
  title: string;
  accent?: boolean;
  pulse?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      className={`app-graph-control-btn${accent ? " app-graph-control-btn--accent" : ""}${pulse ? " app-graph-control-btn--pulse" : ""}`}
      style={{
        opacity: hovered ? 1 : 0.92,
      }}
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
    </button>
  );
}

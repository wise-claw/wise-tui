import type { GraphNode, CodeGraphSubgraphResponse } from "../../types/codeKnowledgeGraph";
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Graph from "graphology";
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

export interface GraphCanvasHandle {
  focusNodeById(nodeId: string): void;
}

export interface GraphCanvasProps {
  data: CodeGraphSubgraphResponse | null;
  onNodeClick?: (node: GraphNode) => void;
  /** Mirrors GitNexus: clearing canvas selection updates app state */
  onStageClick?: () => void;
  /** Current inspector / app selection — drives Focus control and sync after `setGraph` */
  selectedNode?: GraphNode | null;
  /** 与工具栏子图层数文案一致（如「3 层」「全部」） */
  subgraphHopLabel?: string;
  /** 以当前选中节点为焦点，仅沿入边按当前层数展开子图 */
  onSubgraphRollUp?: () => void;
  /** 以当前选中节点为焦点，仅沿出边按当前层数展开子图 */
  onSubgraphDrillDown?: () => void;
}

const GraphCanvasInner = forwardRef<GraphCanvasHandle, GraphCanvasProps>(function GraphCanvasInner(
  {
    data,
    onNodeClick,
    onStageClick,
    selectedNode,
    subgraphHopLabel = "当前范围",
    onSubgraphRollUp,
    onSubgraphDrillDown,
  },
  ref,
) {
  const nodeById = useMemo(() => {
    if (!data) return new Map<string, GraphNode>();
    return new Map(data.nodes.map((n) => [n.id, n]));
  }, [data]);

  const nodeByIdRef = useRef(nodeById);
  nodeByIdRef.current = nodeById;

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      const node = nodeById.get(nodeId);
      if (node) onNodeClick?.(node);
    },
    [nodeById, onNodeClick],
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
    onStageClick,
  });

  useImperativeHandle(
    ref,
    () => ({
      focusNodeById: (nodeId: string) => {
        if (!nodeByIdRef.current.has(nodeId)) return;
        focusNode(nodeId);
      },
    }),
    [focusNode],
  );

  useEffect(() => {
    if (!sigmaReady) return;
    if (!data || data.nodes.length === 0) {
      setGraph(new Graph());
      return;
    }
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

      {sigmaSelectedId && selectedNode && (
        <div className="app-graph-selection-chip">
          <span className="app-graph-selection-dot" />
          <span className="app-graph-hover-chip-text">{selectedNode.label}</span>
          <span className="app-graph-selection-kind">({selectedNode.kind})</span>
          {onSubgraphRollUp && onSubgraphDrillDown && (
            <div className="app-graph-selection-nav-group">
              <button
                type="button"
                className="app-graph-selection-nav"
                title={`上卷：以当前节点为焦点，仅沿入边展开 ${subgraphHopLabel}（与工具栏「范围」一致）`}
                onClick={onSubgraphRollUp}
              >
                上卷
              </button>
              <button
                type="button"
                className="app-graph-selection-nav"
                title={`下钻：以当前节点为焦点，仅沿出边展开 ${subgraphHopLabel}（与工具栏「范围」一致）`}
                onClick={onSubgraphDrillDown}
              >
                下钻
              </button>
            </div>
          )}
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
});

/** 默认浅比较：`data` 每次子图请求均为新引用：勿再用仅 `prev.data === next.data` 的自定义 equal，否则范围切换后可能不触发 `setGraph`。 */
export const GraphCanvas = memo(GraphCanvasInner);

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

import type { GraphNode, CodeGraphSubgraphResponse, CodeGraphSubgraphHopScope } from "../../types/codeKnowledgeGraph";
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
  /** 与工具栏 hop 文案一致（如「hop 3」「全部」） */
  subgraphHopLabel?: string;
  /** 以当前选中节点为焦点，仅沿入边按当前 hop 展开子图 */
  onSubgraphRollUp?: () => void;
  /** 以当前选中节点为焦点，仅沿出边按当前 hop 展开子图 */
  onSubgraphDrillDown?: () => void;
  /**
   * 有限 hop（非「全部」）时：以此节点为父自上而下排布；优先 `selectedNode`，否则用子图焦点 id。
   * 若不在当前 `data` 内则回退力导向。
   */
  layeredLayoutRootId?: string | null;
  /**
   * 与工具栏 hop 一致：为有限值且已选中节点时，仅保留以选中点为心、双向 hop 代价 ≤ 该值的子图，其余节点与边隐藏。
   */
  visibilityHopLimit?: CodeGraphSubgraphHopScope;
}

const GraphCanvasInner = forwardRef<GraphCanvasHandle, GraphCanvasProps>(function GraphCanvasInner(
  {
    data,
    onNodeClick,
    onStageClick,
    selectedNode,
    subgraphHopLabel = "当前 hop",
    onSubgraphRollUp,
    onSubgraphDrillDown,
    layeredLayoutRootId = null,
    visibilityHopLimit = "all",
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
    applyNeighborhoodHopMask,
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

  const layeredRootForLayout = useMemo(() => {
    if (!layeredLayoutRootId || !data?.nodes.length) return null;
    return data.nodes.some((n) => n.id === layeredLayoutRootId) ? layeredLayoutRootId : null;
  }, [layeredLayoutRootId, data]);

  useEffect(() => {
    if (!sigmaReady) return;
    if (!data || data.nodes.length === 0) {
      setGraph(new Graph());
      return;
    }
    const g = codeSubgraphToGraphology(data);
    setGraph(g, layeredRootForLayout ? { layeredRootId: layeredRootForLayout } : undefined);
  }, [sigmaReady, data, layeredRootForLayout, setGraph]);

  useEffect(() => {
    if (!sigmaReady) return;
    if (!data?.nodes.length) {
      applyNeighborhoodHopMask(null, "all");
      return;
    }
    const limit = visibilityHopLimit ?? "all";
    if (limit === "all" || !selectedNode) {
      applyNeighborhoodHopMask(null, "all");
    } else {
      applyNeighborhoodHopMask(selectedNode.id, limit);
    }
  }, [
    sigmaReady,
    data,
    selectedNode?.id,
    selectedNode,
    visibilityHopLimit,
    applyNeighborhoodHopMask,
  ]);

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
                title={`上卷：以当前节点为焦点，仅沿入边展开 ${subgraphHopLabel}（与工具栏 hop 一致）`}
                onClick={onSubgraphRollUp}
              >
                上卷
              </button>
              <button
                type="button"
                className="app-graph-selection-nav"
                title={`下钻：以当前节点为焦点，仅沿出边展开 ${subgraphHopLabel}（与工具栏 hop 一致）`}
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

/** 默认浅比较：`data` 每次子图请求均为新引用：勿再用仅 `prev.data === next.data` 的自定义 equal，否则 hop 切换后可能不触发 `setGraph`。 */
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

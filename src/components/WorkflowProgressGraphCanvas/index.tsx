import { Graph, type Edge as X6Edge, type Node as X6Node } from "@antv/x6";
import { Popover } from "antd";
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { EmployeeItem, WorkflowGraph } from "../../types";
import {
  createGraphNodeFromSnapshotNode,
  ensureWorkflowX6Nodes,
  getMaterialNodeStyle,
  refreshNodePorts,
  workflowGraphToCanvasSnapshot,
  type CanvasSnapshot,
  type MaterialTheme,
} from "../workflowGraph/workflowX6CanvasShared";
import "./index.css";

const DEFAULT_EDGE_ATTRS = {
  stroke: "#5F95FF",
  strokeWidth: 2,
  targetMarker: "classic" as const,
};

function resetNodeHighlight(node: X6Node) {
  const data = (node.getData() ?? {}) as { kind?: string; theme?: MaterialTheme };
  if (node.shape === "rect" && (data.kind === "start" || data.kind === "end")) {
    const isStart = data.kind === "start";
    node.setAttrs({
      body: {
        strokeWidth: 1,
        stroke: isStart ? "#1677FF" : "#FF4D4F",
        fill: isStart ? "#E6F4FF" : "#FFF1F0",
      },
    });
    return;
  }
  const theme = data.theme ?? "green";
  const style = getMaterialNodeStyle(theme);
  node.setAttrs({
    body: { strokeWidth: 1, stroke: style.border, fill: "#fff" },
  });
}

function applyNodeHighlight(node: X6Node) {
  node.setAttrs({
    body: { strokeWidth: 3, stroke: "#FAAD14" },
  });
}

function resetEdgeVisual(edge: X6Edge) {
  edge.setAttrs({
    line: {
      ...DEFAULT_EDGE_ATTRS,
      strokeDasharray: 0,
      style: { animation: "none" },
    },
  });
}

function applyFlowEdge(edge: X6Edge) {
  edge.setAttrs({
    line: {
      stroke: "#FAAD14",
      strokeWidth: 3,
      targetMarker: "classic",
      strokeDasharray: "8 5",
      style: { animation: "app-workflow-progress-edge-flow 0.85s linear infinite" },
    },
  });
}

export interface WorkflowProgressGraphCanvasProps {
  workflowGraph: WorkflowGraph | null;
  employees: EmployeeItem[];
  activeNodeId: string | null;
  flowSourceId: string | null;
  flowTargetId: string | null;
  /** Fixed height for drawer embedding */
  height?: number;
  className?: string;
  /** 悬停任务类节点时展示（返回 null 则不出现浮层） */
  renderNodeHoverContent?: (nodeId: string) => ReactNode | null;
  /** 点击节点（如任务节点） */
  onNodeClick?: (nodeId: string) => void;
}

function snapshotFingerprint(snapshot: CanvasSnapshot): string {
  return JSON.stringify({
    n: snapshot.nodes.map((node) => [node.id, node.x, node.y, node.kind, node.title, node.materialKey, node.employeeId]),
    e: snapshot.edges.map((edge) => [edge.id, edge.source, edge.target, edge.sourcePort, edge.targetPort]),
  });
}

type HoverState = { nodeId: string; content: ReactNode; rect: DOMRect } | null;

export const WorkflowProgressGraphCanvas = memo(function WorkflowProgressGraphCanvasInner({
  workflowGraph,
  employees,
  activeNodeId,
  flowSourceId,
  flowTargetId,
  height = 220,
  className,
  renderNodeHoverContent,
  onNodeClick,
}: WorkflowProgressGraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const hoverHandlersRef = useRef({ renderNodeHoverContent, onNodeClick });
  hoverHandlersRef.current = { renderNodeHoverContent, onNodeClick };

  const [hover, setHover] = useState<HoverState>(null);
  const hoverEnterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHoverEnterTimer = () => {
    if (hoverEnterTimerRef.current) {
      clearTimeout(hoverEnterTimerRef.current);
      hoverEnterTimerRef.current = null;
    }
  };
  const clearHoverLeaveTimer = () => {
    if (hoverLeaveTimerRef.current) {
      clearTimeout(hoverLeaveTimerRef.current);
      hoverLeaveTimerRef.current = null;
    }
  };

  const employeeNameById = useMemo(() => Object.fromEntries(employees.map((e) => [e.id, e.name])), [employees]);
  const canvasSnapshot = useMemo(() => workflowGraphToCanvasSnapshot(workflowGraph), [workflowGraph]);
  const structureKey = useMemo(() => snapshotFingerprint(canvasSnapshot), [canvasSnapshot]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    ensureWorkflowX6Nodes();
    const graph = new Graph({
      container: el,
      grid: { size: 10, visible: true },
      panning: true,
      mousewheel: { enabled: true, minScale: 0.35, maxScale: 2.2 },
      interacting: {
        nodeMovable: false,
        edgeMovable: false,
        arrowheadMovable: false,
        vertexMovable: false,
        vertexAddable: false,
        vertexDeletable: false,
        magnetConnectable: false,
      },
    });
    graphRef.current = graph;

    const onNodeMouseEnter = ({ node }: { node: X6Node }) => {
      const fn = hoverHandlersRef.current.renderNodeHoverContent;
      if (!fn) return;
      clearHoverEnterTimer();
      clearHoverLeaveTimer();
      hoverEnterTimerRef.current = setTimeout(() => {
        const content = fn(node.id);
        if (content == null) {
          return;
        }
        const view = graph.findViewByCell(node);
        const dom = view?.container;
        if (!dom) return;
        const rect = dom.getBoundingClientRect();
        setHover({ nodeId: node.id, content, rect });
      }, 140);
    };

    const onNodeMouseLeave = () => {
      clearHoverEnterTimer();
      hoverLeaveTimerRef.current = setTimeout(() => setHover(null), 220);
    };

    const onBlankMouseDown = () => {
      setHover(null);
    };

    const onNodeClickHandler = ({ node, e }: { node: X6Node; e: { stopPropagation?: () => void } }) => {
      e.stopPropagation?.();
      hoverHandlersRef.current.onNodeClick?.(node.id);
    };

    graph.on("node:mouseenter", onNodeMouseEnter);
    graph.on("node:mouseleave", onNodeMouseLeave);
    graph.on("blank:mousedown", onBlankMouseDown);
    graph.on("node:click", onNodeClickHandler);

    return () => {
      clearHoverEnterTimer();
      clearHoverLeaveTimer();
      graph.off("node:mouseenter", onNodeMouseEnter);
      graph.off("node:mouseleave", onNodeMouseLeave);
      graph.off("blank:mousedown", onBlankMouseDown);
      graph.off("node:click", onNodeClickHandler);
      graph.dispose();
      graphRef.current = null;
    };
  }, []);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    ensureWorkflowX6Nodes();
    graph.clearCells();
    if (canvasSnapshot.nodes.length === 0) return;
    canvasSnapshot.nodes.forEach((node) => {
      graph.addNode(createGraphNodeFromSnapshotNode(node, employeeNameById));
    });
    canvasSnapshot.edges.forEach((edge) => {
      graph.addEdge({
        id: edge.id,
        source: { cell: edge.source, port: edge.sourcePort },
        target: { cell: edge.target, port: edge.targetPort },
        attrs: { line: { ...DEFAULT_EDGE_ATTRS } },
      });
    });
    graph.getNodes().forEach((node) => refreshNodePorts(graph, node, false));
    graph.centerContent();
    setHover(null);
  }, [canvasSnapshot, employeeNameById]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    if (canvasSnapshot.nodes.length === 0) return;

    graph.getNodes().forEach((node) => resetNodeHighlight(node));
    graph.getEdges().forEach((edge) => resetEdgeVisual(edge));

    if (activeNodeId) {
      const cell = graph.getCellById(activeNodeId);
      if (cell?.isNode()) applyNodeHighlight(cell as X6Node);
    }

    if (flowSourceId && flowTargetId) {
      const edge = graph.getEdges().find((e) => e.getSourceCellId() === flowSourceId && e.getTargetCellId() === flowTargetId);
      if (edge) applyFlowEdge(edge);
    }
  }, [activeNodeId, flowSourceId, flowTargetId, structureKey, canvasSnapshot.nodes.length]);

  if (!workflowGraph || canvasSnapshot.nodes.length === 0) {
    return null;
  }

  return (
    <div className={["app-workflow-progress-graph", className].filter(Boolean).join(" ")} style={{ height, position: "relative" }}>
      <div ref={containerRef} className="app-workflow-progress-graph__viewport" />
      {hover ? (
        <Popover
          open
          mouseEnterDelay={0}
          mouseLeaveDelay={280}
          placement="rightTop"
          zIndex={1100}
          getPopupContainer={() => containerRef.current?.parentElement ?? document.body}
          onOpenChange={(next) => {
            if (!next) {
              setHover(null);
            }
          }}
          content={
            <div
              className="app-workflow-progress-graph__hover-pop"
              onMouseEnter={() => {
                clearHoverLeaveTimer();
              }}
            >
              {hover.content}
            </div>
          }
        >
          <div
            aria-hidden
            style={{
              position: "fixed",
              left: hover.rect.left,
              top: hover.rect.top,
              width: Math.max(1, hover.rect.width),
              height: Math.max(1, hover.rect.height),
              pointerEvents: "none",
            }}
          />
        </Popover>
      ) : null}
    </div>
  );
});

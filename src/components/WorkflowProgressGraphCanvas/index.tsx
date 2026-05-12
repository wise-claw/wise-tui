import { Graph, type Edge as X6Edge, type Node as X6Node } from "@antv/x6";
import { memo, useEffect, useMemo, useRef } from "react";
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
}

function snapshotFingerprint(snapshot: CanvasSnapshot): string {
  return JSON.stringify({
    n: snapshot.nodes.map((node) => [node.id, node.x, node.y, node.kind, node.title, node.materialKey, node.employeeId]),
    e: snapshot.edges.map((edge) => [edge.id, edge.source, edge.target, edge.sourcePort, edge.targetPort]),
  });
}

export const WorkflowProgressGraphCanvas = memo(function WorkflowProgressGraphCanvasInner({
  workflowGraph,
  employees,
  activeNodeId,
  flowSourceId,
  flowTargetId,
  height = 220,
  className,
}: WorkflowProgressGraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<Graph | null>(null);
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
    return () => {
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
  }, [activeNodeId, flowSourceId, flowTargetId, structureKey]);

  if (!workflowGraph || canvasSnapshot.nodes.length === 0) {
    return null;
  }

  return (
    <div className={["app-workflow-progress-graph", className].filter(Boolean).join(" ")} style={{ height }}>
      <div ref={containerRef} className="app-workflow-progress-graph__viewport" />
    </div>
  );
});

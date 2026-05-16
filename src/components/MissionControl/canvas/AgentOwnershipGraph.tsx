import { useEffect, useRef } from "react";
import { Empty, Spin, Typography } from "antd";
import { ApartmentOutlined } from "@ant-design/icons";
import type { TrellisAgentOwnershipGraph } from "../../../services/trellisRuntime";

interface AgentOwnershipGraphProps {
  graph: TrellisAgentOwnershipGraph | null;
  loading?: boolean;
}

const NODE_COLORS: Record<string, string> = {
  agent: "var(--mission-accent)",
  task: "var(--mission-warning)",
  repository: "var(--mission-info)",
  session: "var(--mission-success)",
  requirement: "var(--mission-error)",
};

const NODE_RADIUS: Record<string, number> = {
  agent: 18,
  task: 14,
  repository: 12,
  session: 10,
  requirement: 10,
};

/** Pure SVG ownership graph — lightweight, no D3 dependency */
export function AgentOwnershipGraph({ graph, loading }: AgentOwnershipGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!graph || !svgRef.current) return;
    renderGraph(svgRef.current, graph);
  }, [graph]);

  if (!graph) {
    if (loading) return <div style={{ padding: 24, textAlign: "center" }}><Spin size="small" /></div>;
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 Agent 所有权数据" />;
  }

  if (graph.nodes.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前无活跃的 Agent 关系" />;
  }

  return (
    <div className="ownership-graph">
      <div className="ownership-graph__header">
        <ApartmentOutlined />
        <Typography.Text strong style={{ fontSize: 12 }}>Agent 所有权图谱</Typography.Text>
        <span className="ownership-graph__stats">
          {graph.nodes.length} 节点 · {graph.edges.length} 边 · {graph.runs.length} 运行
        </span>
      </div>
      <svg
        ref={svgRef}
        className="ownership-graph__svg"
        viewBox="0 0 800 400"
        preserveAspectRatio="xMidYMid meet"
      />
    </div>
  );
}

function renderGraph(svg: SVGSVGElement, graph: TrellisAgentOwnershipGraph) {
  // Clear
  svg.innerHTML = "";

  const { nodes, edges } = graph;
  if (nodes.length === 0) return;

  const width = svg.clientWidth || 800;
  const height = svg.clientHeight || 400;
  const cx = width / 2;
  const cy = height / 2;

  // Simple force-directed layout: agents in center ring, tasks middle, repos outer
  const positions = new Map<string, { x: number; y: number }>();
  // Group by type
  const agents = nodes.filter((n) => n.nodeType === "agent");
  const tasks = nodes.filter((n) => n.nodeType === "task");
  const repos = nodes.filter((n) => n.nodeType === "repository");
  const others = nodes.filter((n) => !["agent", "task", "repository"].includes(n.nodeType));

  // Layout: center ring = agents, middle = tasks, outer = repos + others
  const centerLayer = agents;
  const middleLayer = tasks;
  const outerLayer = [...repos, ...others];

  // Arrange nodes in concentric circles
  function arrangeCircle(layer: typeof nodes, radius: number, startAngle = 0) {
    const count = layer.length;
    layer.forEach((node, i) => {
      const angle = startAngle + (2 * Math.PI * i) / Math.max(count, 1);
      positions.set(node.id, {
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle) * 0.6, // ellipse
      });
    });
  }

  arrangeCircle(centerLayer, Math.min(width, height) * 0.12);
  arrangeCircle(middleLayer, Math.min(width, height) * 0.25);
  arrangeCircle(outerLayer, Math.min(width, height) * 0.38);

  // Draw edges
  const edgeLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
  for (const edge of edges) {
    const from = positions.get(edge.source);
    const to = positions.get(edge.target);
    if (!from || !to) continue;

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(from.x));
    line.setAttribute("y1", String(from.y));
    line.setAttribute("x2", String(to.x));
    line.setAttribute("y2", String(to.y));
    line.setAttribute("stroke", "var(--mission-border-strong)");
    line.setAttribute("stroke-width", "1");
    line.setAttribute("opacity", "0.5");
    edgeLayer.appendChild(line);
  }
  svg.appendChild(edgeLayer);

  // Draw nodes
  const nodeLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
  for (const node of nodes) {
    const pos = positions.get(node.id);
    if (!pos) continue;

    const r = NODE_RADIUS[node.nodeType] ?? 10;
    const color = (node.status === "running" ? "var(--mission-info)" : NODE_COLORS[node.nodeType]) ?? "var(--mission-dim)";

    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");

    // Glow for running
    if (node.status === "running") {
      const glow = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      glow.setAttribute("cx", String(pos.x));
      glow.setAttribute("cy", String(pos.y));
      glow.setAttribute("r", String(r + 4));
      glow.setAttribute("fill", "none");
      glow.setAttribute("stroke", "var(--mission-info)");
      glow.setAttribute("stroke-width", "2");
      glow.setAttribute("opacity", "0.3");
      glow.innerHTML = '<animate attributeName="opacity" values="0.3;0.6;0.3" dur="1.5s" repeatCount="indefinite"/>';
      g.appendChild(glow);
    }

    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", String(pos.x));
    circle.setAttribute("cy", String(pos.y));
    circle.setAttribute("r", String(r));
    circle.setAttribute("fill", color);
    circle.setAttribute("stroke", "var(--mission-surface)");
    circle.setAttribute("stroke-width", "2");
    g.appendChild(circle);

    // Label
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", String(pos.x));
    text.setAttribute("y", String(pos.y + r + 14));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("fill", "var(--mission-muted)");
    text.setAttribute("font-size", "10");
    text.setAttribute("font-family", "inherit");
    text.textContent = node.label.slice(0, 18);
    g.appendChild(text);

    nodeLayer.appendChild(g);
  }
  svg.appendChild(nodeLayer);
}

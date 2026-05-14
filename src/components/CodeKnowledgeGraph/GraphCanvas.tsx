import { useEffect, useRef, useState } from "react";
import type { GraphNode, CodeGraphSubgraphResponse } from "../../types/codeKnowledgeGraph";
import { WebGLRenderer } from "./WebGLRenderer";

interface GraphCanvasProps {
  data: CodeGraphSubgraphResponse | null;
  onNodeClick?: (node: GraphNode) => void;
}

// Auto-enable WebGL when edges exceed this threshold
const WEBGL_EDGE_THRESHOLD = 500;

export function GraphCanvas({ data, onNodeClick }: GraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<WebGLRenderer | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const animFrameRef = useRef<number>(0);

  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [layoutReady, setLayoutReady] = useState(false);

  // Container resize
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.floor(entry.contentRect.width);
        const h = Math.floor(entry.contentRect.height);
        if (w > 0 && h > 0) setDimensions({ width: w, height: h });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Create worker and compute layout when data changes
  useEffect(() => {
    if (!data?.nodes || data.nodes.length === 0) {
      positionsRef.current.clear();
      setLayoutReady(false);
      return;
    }

    // Create worker from the TS file via Blob URL
    if (workerRef.current) workerRef.current.terminate();

    const worker = new Worker(new URL("./layoutWorker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent) => {
      const { positions } = e.data;
      const posMap = new Map<string, { x: number; y: number }>();
      for (const p of positions) {
        posMap.set(p.id, { x: p.x, y: p.y });
      }
      positionsRef.current = posMap;
      setLayoutReady(true);
    };

    worker.postMessage({
      nodes: data.nodes.map((n) => ({ id: n.id })),
      edges: data.edges.map((e) => ({ source: e.source, target: e.target })),
      width: dimensions.width,
      height: dimensions.height,
    });

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [data, dimensions]);

  // Initialize renderer when dimensions are ready
  useEffect(() => {
    if (!canvasRef.current) return;
    if (rendererRef.current) rendererRef.current.dispose();

    try {
      rendererRef.current = new WebGLRenderer({
        canvas: canvasRef.current,
        width: dimensions.width,
        height: dimensions.height,
        onNodeHover: (node) => setHoveredNode(node),
        onNodeClick,
      });
    } catch {
      // WebGL not supported — fallback handled below
    }

    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, [dimensions.width, dimensions.height, onNodeClick]);

  // Render loop
  useEffect(() => {
    if (!layoutReady || !rendererRef.current || !data) return;

    rendererRef.current.resize(dimensions.width, dimensions.height);

    const loop = () => {
      if (rendererRef.current && positionsRef.current.size > 0) {
        const zoomLevel = rendererRef.current.getZoomLevel();
        rendererRef.current.render(data.nodes, data.edges, positionsRef.current, zoomLevel);
      }
      animFrameRef.current = requestAnimationFrame(loop);
    };
    animFrameRef.current = requestAnimationFrame(loop);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [layoutReady, data, dimensions]);

  // Resize renderer when container changes
  useEffect(() => {
    rendererRef.current?.resize(dimensions.width, dimensions.height);
  }, [dimensions]);

  if (!data || data.nodes.length === 0) {
    return null;
  }

  const useWebgl = data.edges.length > WEBGL_EDGE_THRESHOLD;

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", position: "relative" }}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block", cursor: hoveredNode ? "pointer" : "grab" }}
      />
      <div style={{ position: "absolute", bottom: 8, left: 8, fontSize: 11, opacity: 0.6 }}>
        {useWebgl ? "WebGL" : "Canvas"} · 滚轮缩放 · 拖拽平移 · 点击节点查看详情
        {!layoutReady && " · 计算布局中..."}
      </div>
    </div>
  );
}

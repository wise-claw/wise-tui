import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import Sigma from "sigma";
import Graph from "graphology";
import FA2Layout from "graphology-layout-forceatlas2/worker";
import forceAtlas2 from "graphology-layout-forceatlas2";
import noverlap from "graphology-layout-noverlap";
import EdgeCurveProgram from "@sigma/edge-curve";
import type { CodeGraphSigmaEdgeAttrs, CodeGraphSigmaNodeAttrs } from "../utils/codeGraphSigmaAdapter";

const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
    : { r: 100, g: 100, b: 100 };
};

const rgbToHex = (r: number, g: number, b: number): string =>
  `#${[r, g, b]
    .map((x) => {
      const hex = Math.max(0, Math.min(255, Math.round(x))).toString(16);
      return hex.length === 1 ? `0${hex}` : hex;
    })
    .join("")}`;

const dimColor = (hex: string, amount: number): string => {
  const rgb = hexToRgb(hex);
  const darkBg = { r: 18, g: 18, b: 28 };
  return rgbToHex(
    darkBg.r + (rgb.r - darkBg.r) * amount,
    darkBg.g + (rgb.g - darkBg.g) * amount,
    darkBg.b + (rgb.b - darkBg.b) * amount,
  );
};

const brightenColor = (hex: string, factor: number): string => {
  const rgb = hexToRgb(hex);
  return rgbToHex(
    rgb.r + ((255 - rgb.r) * (factor - 1)) / factor,
    rgb.g + ((255 - rgb.g) * (factor - 1)) / factor,
    rgb.b + ((255 - rgb.b) * (factor - 1)) / factor,
  );
};

/** Reducers run every frame during pan/zoom — cache dim/brighten results by (hex, param). */
const DIM_COLOR_CACHE = new Map<string, string>();
const BRIGHTEN_COLOR_CACHE = new Map<string, string>();

function dimColorCached(hex: string, amount: number): string {
  const key = `${hex}|${amount}`;
  let v = DIM_COLOR_CACHE.get(key);
  if (v === undefined) {
    v = dimColor(hex, amount);
    if (DIM_COLOR_CACHE.size > 400) DIM_COLOR_CACHE.clear();
    DIM_COLOR_CACHE.set(key, v);
  }
  return v;
}

function brightenColorCached(hex: string, factor: number): string {
  const key = `${hex}|${factor}`;
  let v = BRIGHTEN_COLOR_CACHE.get(key);
  if (v === undefined) {
    v = brightenColor(hex, factor);
    if (BRIGHTEN_COLOR_CACHE.size > 400) BRIGHTEN_COLOR_CACHE.clear();
    BRIGHTEN_COLOR_CACHE.set(key, v);
  }
  return v;
}

export interface UseCodeGraphSigmaOptions {
  onNodeClick?: (nodeId: string) => void;
  onNodeHover?: (nodeId: string | null) => void;
  onStageClick?: () => void;
}

/** Matches GitNexus `graphology-layout-noverlap` param shape (`settings` nested). */
const NOVERLAP_SETTINGS = {
  maxIterations: 20,
  settings: { ratio: 1.1, margin: 10, expansion: 1.05 },
};

const getFA2Settings = (nodeCount: number) => {
  const isSmall = nodeCount < 500;
  const isMedium = nodeCount >= 500 && nodeCount < 2000;
  const isLarge = nodeCount >= 2000 && nodeCount < 10000;

  return {
    gravity: isSmall ? 0.8 : isMedium ? 0.5 : isLarge ? 0.3 : 0.15,
    scalingRatio: isSmall ? 15 : isMedium ? 30 : isLarge ? 60 : 100,
    slowDown: isSmall ? 1 : isMedium ? 2 : isLarge ? 3 : 5,
    barnesHutOptimize: nodeCount > 200,
    barnesHutTheta: isLarge ? 0.8 : 0.6,
    strongGravityMode: false,
    outboundAttractionDistribution: true,
    linLogMode: false,
    adjustSizes: true,
    edgeWeightInfluence: 1,
  };
};

const getLayoutDuration = (nodeCount: number): number => {
  if (nodeCount > 10000) return 45000;
  if (nodeCount > 5000) return 35000;
  if (nodeCount > 2000) return 30000;
  if (nodeCount > 1000) return 30000;
  if (nodeCount > 500) return 25000;
  return 20000;
};

/**
 * FA2 Web Worker 在运行期会持续把坐标写回 graph，Sigma 跟着高频重绘，节点会一直「抖」。
 * 常见代码子图规模下改为一笔同步 `assign`，最后只做一次 `refresh`，观感稳定。
 */
const SYNC_FA2_MAX_NODES = 2000;

function getSyncFa2Iterations(n: number): number {
  if (n <= 2) return 48;
  if (n <= 8) return 110;
  if (n <= 24) return 180;
  if (n <= 80) return 300;
  if (n <= 300) return 440;
  if (n <= 900) return 560;
  return Math.min(680, 480 + Math.floor(n / 6));
}

export interface UseCodeGraphSigmaReturn {
  containerRef: RefObject<HTMLDivElement | null>;
  sigmaRef: RefObject<Sigma | null>;
  sigmaReady: boolean;
  setGraph: (graph: Graph<CodeGraphSigmaNodeAttrs, CodeGraphSigmaEdgeAttrs>) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  focusNode: (nodeId: string) => void;
  isLayoutRunning: boolean;
  startLayout: () => void;
  stopLayout: () => void;
  selectedNode: string | null;
  setSelectedNode: (nodeId: string | null) => void;
  refresh: () => void;
}

export function useCodeGraphSigma(options: UseCodeGraphSigmaOptions = {}): UseCodeGraphSigmaReturn {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph<CodeGraphSigmaNodeAttrs, CodeGraphSigmaEdgeAttrs> | null>(null);
  const layoutRef = useRef<FA2Layout | null>(null);
  const selectedNodeRef = useRef<string | null>(null);
  const layoutTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [isLayoutRunning, setIsLayoutRunning] = useState(false);
  const [selectedNode, setSelectedNodeState] = useState<string | null>(null);
  const [sigmaReady, setSigmaReady] = useState(false);

  const setSelectedNode = useCallback((nodeId: string | null) => {
    if (selectedNodeRef.current === nodeId) {
      return;
    }
    selectedNodeRef.current = nodeId;
    setSelectedNodeState(nodeId);

    const sigma = sigmaRef.current;
    if (!sigma) return;
    sigma.refresh();
  }, []);

  const runLayout = useCallback((graph: Graph<CodeGraphSigmaNodeAttrs, CodeGraphSigmaEdgeAttrs>) => {
    const nodeCount = graph.order;
    if (nodeCount === 0) return;

    if (layoutRef.current) {
      layoutRef.current.kill();
      layoutRef.current = null;
    }
    if (layoutTimeoutRef.current) {
      clearTimeout(layoutTimeoutRef.current);
      layoutTimeoutRef.current = null;
    }

    const inferredSettings = forceAtlas2.inferSettings(graph);
    const customSettings = getFA2Settings(nodeCount);
    let settings = { ...inferredSettings, ...customSettings };

    if (nodeCount <= SYNC_FA2_MAX_NODES) {
      if (nodeCount < 160) {
        settings = {
          ...settings,
          slowDown: Math.max(settings.slowDown ?? 1, 7),
          gravity: Math.min(1.25, (settings.gravity ?? 0.8) + 0.2),
        };
      }
      const iterations = getSyncFa2Iterations(nodeCount);
      forceAtlas2.assign(graph, { iterations, settings });
      noverlap.assign(graph, NOVERLAP_SETTINGS);
      sigmaRef.current?.refresh();
      setIsLayoutRunning(false);
      return;
    }

    const layout = new FA2Layout(graph, { settings });
    layoutRef.current = layout;
    layout.start();
    setIsLayoutRunning(true);

    const duration = getLayoutDuration(nodeCount);

    layoutTimeoutRef.current = setTimeout(() => {
      if (layoutRef.current) {
        layoutRef.current.stop();
        layoutRef.current = null;
        noverlap.assign(graph, NOVERLAP_SETTINGS);
        sigmaRef.current?.refresh();
        setIsLayoutRunning(false);
      }
    }, duration);
  }, []);

  const setGraphInternal = useCallback(
    (newGraph: Graph<CodeGraphSigmaNodeAttrs, CodeGraphSigmaEdgeAttrs>) => {
      const sigma = sigmaRef.current;
      if (!sigma) return;

      if (layoutRef.current) {
        layoutRef.current.kill();
        layoutRef.current = null;
      }
      if (layoutTimeoutRef.current) {
        clearTimeout(layoutTimeoutRef.current);
        layoutTimeoutRef.current = null;
      }

      graphRef.current = newGraph;
      sigma.setGraph(newGraph);
      selectedNodeRef.current = null;
      setSelectedNodeState(null);

      runLayout(newGraph);
      // 与布局后的节点坐标、归一化范围对齐；否则相机会按旧 extent 解释，随后 process 再跑会「跳走」
      sigma.refresh();
      // 不用 animatedReset：500ms 与 focus 的 animate 叠在一起，且收尾会拉回默认视角
      sigma.getCamera().setState({ x: 0.5, y: 0.5, ratio: 1, angle: 0 });
    },
    [runLayout],
  );

  const pendingGraphRef = useRef<Graph<CodeGraphSigmaNodeAttrs, CodeGraphSigmaEdgeAttrs> | null>(null);

  const setGraphOrQueue = useCallback(
    (newGraph: Graph<CodeGraphSigmaNodeAttrs, CodeGraphSigmaEdgeAttrs>) => {
      if (!sigmaRef.current) {
        pendingGraphRef.current = newGraph;
        return;
      }
      setGraphInternal(newGraph);
    },
    [setGraphInternal],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let disposed = false;
    let pollId: ReturnType<typeof setInterval> | null = null;

    const tryInit = () => {
      if (disposed || sigmaRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const graph = new Graph<CodeGraphSigmaNodeAttrs, CodeGraphSigmaEdgeAttrs>();
      graphRef.current = graph;

      const sigma = new Sigma(graph, containerRef.current, {
        renderLabels: true,
        labelFont: "JetBrains Mono, monospace",
        labelSize: 11,
        labelWeight: "500",
        labelColor: { color: "#e4e4ed" },
        labelRenderedSizeThreshold: 8,
        labelDensity: 0.1,
        labelGridCellSize: 70,
        defaultNodeColor: "#6b7280",
        defaultEdgeColor: "#2a2a3a",
        defaultEdgeType: "curved",
        edgeProgramClasses: {
          curved: EdgeCurveProgram,
        },
        defaultDrawNodeHover: (context, data, settings) => {
          const label = data.label;
          if (!label) return;
          const size = settings.labelSize || 11;
          const font = settings.labelFont || "JetBrains Mono, monospace";
          const weight = settings.labelWeight || "500";
          context.font = `${weight} ${size}px ${font}`;
          const textWidth = context.measureText(label).width;
          const nodeSize = data.size || 8;
          const x = data.x;
          const y = data.y - nodeSize - 10;
          const paddingX = 8;
          const paddingY = 5;
          const height = size + paddingY * 2;
          const width = textWidth + paddingX * 2;
          const radius = 4;
          context.fillStyle = "#12121c";
          context.beginPath();
          context.roundRect(x - width / 2, y - height / 2, width, height, radius);
          context.fill();
          context.strokeStyle = data.color || "#6366f1";
          context.lineWidth = 2;
          context.stroke();
          context.fillStyle = "#f5f5f7";
          context.textAlign = "center";
          context.textBaseline = "middle";
          context.fillText(label, x, y);
          context.beginPath();
          context.arc(data.x, data.y, nodeSize + 4, 0, Math.PI * 2);
          context.strokeStyle = data.color || "#6366f1";
          context.lineWidth = 2;
          context.globalAlpha = 0.5;
          context.stroke();
          context.globalAlpha = 1;
        },
        minCameraRatio: 0.002,
        maxCameraRatio: 50,
        hideEdgesOnMove: true,
        zIndex: true,
        nodeReducer: (node, data) => {
          if (data.hidden) {
            return { ...data, hidden: true };
          }
          const currentSelected = selectedNodeRef.current;
          const g = graphRef.current;
          if (!currentSelected || !g) {
            return data;
          }
          const res = { ...data };
          const isSelected = node === currentSelected;
          const isNeighbor = g.hasEdge(node, currentSelected) || g.hasEdge(currentSelected, node);
          if (isSelected) {
            res.color = data.color;
            res.size = (data.size || 8) * 1.8;
            res.zIndex = 2;
            res.highlighted = true;
          } else if (isNeighbor) {
            res.color = data.color;
            res.size = (data.size || 8) * 1.3;
            res.zIndex = 1;
          } else {
            res.color = dimColorCached(data.color, 0.25);
            res.size = (data.size || 8) * 0.6;
            res.zIndex = 0;
          }
          return res;
        },
        edgeReducer: (edge, data) => {
          const currentSelected = selectedNodeRef.current;
          const g = graphRef.current;
          if (!g) return data;
          if (!currentSelected) {
            return data;
          }
          const res = { ...data };
          const [source, target] = g.extremities(edge);
          const isConnected = source === currentSelected || target === currentSelected;
          if (isConnected) {
            res.color = brightenColorCached(data.color, 1.5);
            res.size = Math.max(3, (data.size || 1) * 4);
            res.zIndex = 2;
          } else {
            res.color = dimColorCached(data.color, 0.1);
            res.size = 0.3;
            res.zIndex = 0;
          }
          return res;
        },
      });

      sigmaRef.current = sigma;

      sigma.on("clickNode", ({ node }) => {
        setSelectedNode(node);
        optionsRef.current.onNodeClick?.(node);
      });

      sigma.on("clickStage", () => {
        setSelectedNode(null);
        optionsRef.current.onStageClick?.();
      });

      sigma.on("enterNode", ({ node }) => {
        optionsRef.current.onNodeHover?.(node);
        if (containerRef.current) containerRef.current.style.cursor = "pointer";
      });

      sigma.on("leaveNode", () => {
        optionsRef.current.onNodeHover?.(null);
        if (containerRef.current) containerRef.current.style.cursor = "grab";
      });

      setSigmaReady(true);
      if (pollId) {
        clearInterval(pollId);
        pollId = null;
      }

      if (pendingGraphRef.current) {
        const pending = pendingGraphRef.current;
        pendingGraphRef.current = null;
        graphRef.current = pending;
        sigma.setGraph(pending);
        selectedNodeRef.current = null;
        setSelectedNodeState(null);
        runLayout(pending);
        sigma.refresh();
        sigma.getCamera().setState({ x: 0.5, y: 0.5, ratio: 1, angle: 0 });
      }
    };

    const ro = new ResizeObserver(() => {
      if (sigmaRef.current && containerRef.current) {
        sigmaRef.current.resize();
        return;
      }
      tryInit();
    });
    ro.observe(el);
    tryInit();
    pollId = setInterval(tryInit, 100);

    return () => {
      disposed = true;
      ro.disconnect();
      if (pollId) clearInterval(pollId);
      if (layoutTimeoutRef.current) {
        clearTimeout(layoutTimeoutRef.current);
        layoutTimeoutRef.current = null;
      }
      layoutRef.current?.kill();
      layoutRef.current = null;
      sigmaRef.current?.kill();
      sigmaRef.current = null;
      graphRef.current = null;
      pendingGraphRef.current = null;
      setSigmaReady(false);
    };
  }, [runLayout, setSelectedNode]);

  const focusNode = useCallback((nodeId: string) => {
    const sigma = sigmaRef.current;
    const g = graphRef.current;
    if (!sigma || !g || !g.hasNode(nodeId)) return;

    // 相机 state 的 x/y 在「framed graph」空间，不能用 graphology 里的原始坐标（见 sigma 坐标系文档）
    const sigmaWithDisplay = sigma as Sigma & {
      getNodeDisplayData?: (id: string) => { x?: number; y?: number } | undefined;
    };
    let display = sigmaWithDisplay.getNodeDisplayData?.(nodeId);
    if (display == null || typeof display.x !== "number" || typeof display.y !== "number") {
      sigma.refresh();
      display = sigmaWithDisplay.getNodeDisplayData?.(nodeId);
    }
    if (display == null || typeof display.x !== "number" || typeof display.y !== "number") {
      return;
    }

    selectedNodeRef.current = nodeId;
    setSelectedNodeState(nodeId);

    sigma.getCamera().animate({ x: display.x, y: display.y, ratio: 0.15 }, { duration: 400 });
  }, []);

  const zoomIn = useCallback(() => {
    sigmaRef.current?.getCamera().animatedZoom({ duration: 200 });
  }, []);

  const zoomOut = useCallback(() => {
    sigmaRef.current?.getCamera().animatedUnzoom({ duration: 200 });
  }, []);

  const resetZoom = useCallback(() => {
    sigmaRef.current?.getCamera().animatedReset({ duration: 300 });
    setSelectedNode(null);
  }, [setSelectedNode]);

  const startLayout = useCallback(() => {
    const g = graphRef.current;
    if (!g || g.order === 0) return;
    runLayout(g);
  }, [runLayout]);

  const stopLayout = useCallback(() => {
    if (layoutTimeoutRef.current) {
      clearTimeout(layoutTimeoutRef.current);
      layoutTimeoutRef.current = null;
    }
    if (layoutRef.current) {
      layoutRef.current.stop();
      layoutRef.current = null;
      const g = graphRef.current;
      if (g) {
        noverlap.assign(g, NOVERLAP_SETTINGS);
        sigmaRef.current?.refresh();
      }
      setIsLayoutRunning(false);
    }
  }, []);

  const refresh = useCallback(() => {
    sigmaRef.current?.refresh();
  }, []);

  return {
    containerRef,
    sigmaRef,
    sigmaReady,
    setGraph: setGraphOrQueue,
    zoomIn,
    zoomOut,
    resetZoom,
    focusNode,
    isLayoutRunning,
    startLayout,
    stopLayout,
    selectedNode,
    setSelectedNode,
    refresh,
  };
}

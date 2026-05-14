/**
 * Shared X6 workflow canvas types and graph ↔ snapshot helpers used by
 * WorkflowConfigModal and read-only viewers (e.g. progress monitor).
 */
import { Graph, type Node as X6Node } from "@antv/x6";
import type { WorkflowGraph, WorkflowGraphNodeData, WorkflowStageOutcomeCriterion } from "../../types";
import { normalizeWorkflowStageOutcomeCriteria } from "../../utils/workflowStageOutcomeCriteria";
import { normalizeStageTaskBasisRefsFromNodeData } from "../../services/workflowGraphRuntime";

export type MaterialTheme = "blue" | "green" | "orange";

export interface MaterialItem {
  key: string;
  iconText: string;
  title: string;
  desc: string;
  inputPlaceholder: string;
  theme: MaterialTheme;
}

export interface CanvasNodeItem {
  id: string;
  kind: "start" | "material" | "end";
  x: number;
  y: number;
  title: string;
  materialKey?: string;
  theme?: MaterialTheme;
  stageTask?: string;
  employeeId?: string;
  stageSuccessCriteria?: WorkflowStageOutcomeCriterion[];
  stageTaskBasisRefs?: string[];
  stageTaskBasisRef?: string;
  acceptanceEnabled?: boolean;
  acceptanceCriteria?: string;
  passthroughData?: Record<string, unknown>;
}

export interface CanvasEdgeItem {
  id: string;
  source: string;
  target: string;
  sourcePort?: string;
  targetPort?: string;
}

export interface CanvasSnapshot {
  nodes: CanvasNodeItem[];
  edges: CanvasEdgeItem[];
}

export function normalizeCanvasSnapshot(snapshot: CanvasSnapshot): CanvasSnapshot {
  const startNodes = snapshot.nodes.filter((node) => node.kind === "start");
  const endNodes = snapshot.nodes.filter((node) => node.kind === "end");
  const materialNodes = snapshot.nodes.filter((node) => node.kind === "material");

  const canonicalStart = startNodes[0];
  const canonicalEnd = endNodes[0];

  const remap = new Map<string, string>();
  if (canonicalStart) {
    startNodes.slice(1).forEach((node) => remap.set(node.id, canonicalStart.id));
  }
  if (canonicalEnd) {
    endNodes.slice(1).forEach((node) => remap.set(node.id, canonicalEnd.id));
  }

  const nodes: CanvasNodeItem[] = [...materialNodes];
  if (canonicalStart) nodes.unshift(canonicalStart);
  if (canonicalEnd) nodes.push(canonicalEnd);
  const nodeIdSet = new Set(nodes.map((node) => node.id));
  const edgeKeySet = new Set<string>();
  const edges = snapshot.edges
    .map((edge) => ({
      ...edge,
      source: remap.get(edge.source) ?? edge.source,
      target: remap.get(edge.target) ?? edge.target,
    }))
    .filter((edge) => edge.source && edge.target && nodeIdSet.has(edge.source) && nodeIdSet.has(edge.target))
    .filter((edge) => {
      const key = `${edge.source}:${edge.sourcePort ?? ""}->${edge.target}:${edge.targetPort ?? ""}`;
      if (edgeKeySet.has(key)) return false;
      edgeKeySet.add(key);
      return true;
    });

  return { nodes, edges };
}

export const MATERIAL_NODE_WIDTH = 204;
export const MATERIAL_NODE_HEIGHT = 78;
export const FLOW_NODE_WIDTH = 128;
export const FLOW_NODE_HEIGHT = 52;
export const EMPLOYEE_NODE_HEIGHT = 124;
export const EMPLOYEE_NODE_HEIGHT_WITH_ACCEPTANCE = 148;
export const EMPLOYEE_NODE_HEIGHT_STAGE_SUCCESS_EXTRA = 22;
export const EMPLOYEE_NODE_HEIGHT_TASK_BASIS_EXTRA = 18;

export const MATERIALS: Record<string, MaterialItem> = {
  start: {
    key: "start",
    iconText: "S",
    title: "开始",
    desc: "流程开始节点。",
    inputPlaceholder: "",
    theme: "blue",
  },
  end: {
    key: "end",
    iconText: "E",
    title: "结束",
    desc: "流程结束节点。",
    inputPlaceholder: "",
    theme: "orange",
  },
  employee: {
    key: "employee",
    iconText: "EMP",
    title: "员工",
    desc: "指派员工执行阶段任务。",
    inputPlaceholder: "输入阶段任务",
    theme: "green",
  },
};

export const MATERIAL_KEYS = Object.keys(MATERIALS);

export function createDefaultCanvasSnapshot(): CanvasSnapshot {
  return {
    nodes: [],
    edges: [],
  };
}

export function workflowGraphToCanvasSnapshot(graph: WorkflowGraph | null | undefined): CanvasSnapshot {
  if (!graph || graph.nodes.length === 0) return createDefaultCanvasSnapshot();
  const nodes: CanvasNodeItem[] = graph.nodes.map((node, index) => {
    if (node.type === "start") {
      return {
        id: node.id,
        kind: "start",
        title: node.data.label || "开始",
        x: node.position.x,
        y: node.position.y,
        passthroughData: omitGraphNodeMappedData(node.data, "start"),
      };
    }
    if (node.type === "end") {
      return {
        id: node.id,
        kind: "end",
        title: node.data.label || "结束",
        x: node.position.x,
        y: node.position.y,
        passthroughData: omitGraphNodeMappedData(node.data, "end"),
      };
    }
    const key = typeof node.data.materialKey === "string" && MATERIALS[node.data.materialKey] ? node.data.materialKey : "employee";
    return {
      id: node.id,
      kind: "material",
      title: node.data.label || `节点${index + 1}`,
      materialKey: key,
      theme: MATERIALS[key].theme,
      stageTask: typeof node.data.employeePrompt === "string" ? node.data.employeePrompt : "",
      employeeId: typeof node.data.employeeId === "string" ? node.data.employeeId : undefined,
      stageSuccessCriteria: normalizeWorkflowStageOutcomeCriteria(node.data.stageSuccessCriteria),
      stageTaskBasisRefs: normalizeStageTaskBasisRefsFromNodeData(node.data as WorkflowGraphNodeData),
      acceptanceEnabled: typeof node.data.conditionElsePrompt === "string" ? node.data.conditionElsePrompt === "acceptance_enabled" : false,
      acceptanceCriteria: typeof node.data.conditionIfPrompt === "string" && node.data.conditionIfPrompt !== "rollback" ? node.data.conditionIfPrompt : "",
      passthroughData: omitGraphNodeMappedData(node.data, "material"),
      x: node.position.x,
      y: node.position.y,
    };
  });
  const edges = graph.edges.map((edge, index) => {
    const rawSource = edge.source as unknown;
    const rawTarget = edge.target as unknown;
    const sourceObj = rawSource && typeof rawSource === "object" ? (rawSource as Record<string, unknown>) : null;
    const targetObj = rawTarget && typeof rawTarget === "object" ? (rawTarget as Record<string, unknown>) : null;
    const source =
      typeof rawSource === "string"
        ? rawSource
        : sourceObj && typeof sourceObj.cell === "string"
          ? sourceObj.cell
          : "";
    const target =
      typeof rawTarget === "string"
        ? rawTarget
        : targetObj && typeof targetObj.cell === "string"
          ? targetObj.cell
          : "";
    const sourcePort =
      (typeof edge.sourceHandle === "string" && edge.sourceHandle) ||
      (sourceObj && typeof sourceObj.port === "string" ? sourceObj.port : undefined) ||
      (edge.data && typeof edge.data.sourcePort === "string" ? edge.data.sourcePort : undefined);
    const targetPort =
      (typeof edge.targetHandle === "string" && edge.targetHandle) ||
      (targetObj && typeof targetObj.port === "string" ? targetObj.port : undefined) ||
      (edge.data && typeof edge.data.targetPort === "string" ? edge.data.targetPort : undefined);
    return {
      id: edge.id || `edge-${index + 1}`,
      source,
      target,
      sourcePort,
      targetPort,
    };
  });
  return normalizeCanvasSnapshot({ nodes, edges });
}

function omitGraphNodeMappedData(
  data: WorkflowGraphNodeData,
  kind: CanvasNodeItem["kind"],
): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = { ...data };
  delete out.label;
  if (kind === "material") {
    delete out.materialKey;
    delete out.employeePrompt;
    delete out.employeeId;
    delete out.conditionIfPrompt;
    delete out.conditionElsePrompt;
    delete out.stageSuccessCriteria;
    delete out.stageTaskBasisRefs;
    delete out.stageTaskBasisRef;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function getMaterialNodeStyle(theme: MaterialTheme) {
  if (theme === "green") return { body: "#E6FFFB", border: "#13C2C2", text: "#006D75" };
  if (theme === "orange") return { body: "#FFF7E6", border: "#FA8C16", text: "#AD4E00" };
  return { body: "#F0F5FF", border: "#5F95FF", text: "#1D39C4" };
}

let workflowX6NodeRegistered = false;

export function ensureWorkflowX6Nodes() {
  if (workflowX6NodeRegistered) return;
  Graph.registerNode(
    "wise-material-card",
    {
      inherit: "rect",
      width: MATERIAL_NODE_WIDTH,
      height: MATERIAL_NODE_HEIGHT,
      markup: [
        { tagName: "rect", selector: "body" },
        { tagName: "rect", selector: "iconBg" },
        { tagName: "text", selector: "iconText" },
        { tagName: "text", selector: "title" },
        { tagName: "text", selector: "desc1" },
        { tagName: "text", selector: "desc2" },
        { tagName: "text", selector: "desc3" },
        { tagName: "text", selector: "desc4" },
      ],
      attrs: {
        body: { rx: 10, ry: 10, strokeWidth: 1 },
        iconBg: { width: 30, height: 30, rx: 8, ry: 8, refX: 10, refY: 14 },
        iconText: { refX: 25, refY: 29, textAnchor: "middle", textVerticalAnchor: "middle", fontSize: 11, fontWeight: 700 },
        title: { refX: 52, refY: 24, textAnchor: "start", textVerticalAnchor: "middle", fontSize: 13, fontWeight: 600 },
        desc1: {
          refX: 52,
          refY: 38,
          textAnchor: "start",
          textVerticalAnchor: "top",
          fontSize: 11,
          fontWeight: 600,
          textWrap: { width: 140, height: 14, ellipsis: "..." },
        },
        desc2: {
          refX: 52,
          refY: 56,
          textAnchor: "start",
          textVerticalAnchor: "top",
          fontSize: 11,
          textWrap: { width: 140, height: 34, ellipsis: "..." },
        },
        desc3: {
          refX: 52,
          refY: 92,
          textAnchor: "start",
          textVerticalAnchor: "top",
          fontSize: 11,
          textWrap: { width: 140, height: 44, ellipsis: "..." },
        },
        desc4: {
          refX: 52,
          refY: 90,
          textAnchor: "start",
          textVerticalAnchor: "middle",
          fontSize: 11,
        },
      },
    },
    true,
  );
  workflowX6NodeRegistered = true;
}

export function createPorts() {
  const base = {
    attrs: {
      circle: {
        r: 6,
        magnet: true,
        stroke: "#5F95FF",
        strokeWidth: 1,
        fill: "#fff",
        style: { visibility: "hidden", cursor: "crosshair" },
      },
    },
  };
  return {
    groups: {
      top: { ...base, position: "top" },
      right: { ...base, position: "right" },
      bottom: { ...base, position: "bottom" },
      left: { ...base, position: "left" },
    },
    items: [
      { id: "top", group: "top" },
      { id: "right", group: "right" },
      { id: "bottom", group: "bottom" },
      { id: "left", group: "left" },
    ],
  };
}

export function setPortVisible(node: X6Node, portId: string, visible: boolean) {
  node.setPortProp(portId, "attrs/circle/style/visibility", visible ? "visible" : "hidden");
}

export function setPortColor(node: X6Node, portId: string, connected: boolean) {
  const color = connected ? "#5F95FF" : "#C2C8D5";
  node.setPortProp(portId, "attrs/circle/stroke", color);
  node.setPortProp(portId, "attrs/circle/fill", connected ? "#5F95FF" : "#fff");
}

export function isPortConnected(graph: Graph, node: X6Node, portId: string) {
  const edges = graph.getConnectedEdges(node);
  return edges.some(
    (edge) =>
      (edge.getSourceCellId() === node.id && edge.getSourcePortId() === portId) ||
      (edge.getTargetCellId() === node.id && edge.getTargetPortId() === portId),
  );
}

export function refreshNodePorts(graph: Graph, node: X6Node, showAll: boolean) {
  node.getPorts().forEach((port) => {
    const portId = String(port.id);
    const connected = isPortConnected(graph, node, portId);
    setPortColor(node, portId, connected);
    setPortVisible(node, portId, showAll || connected);
  });
}

export function buildEmployeeNodeSummary(node: Partial<CanvasNodeItem>, employeeNameById: Record<string, string>) {
  const task = (node.stageTask || "").trim() || "未填写";
  const assignee = node.employeeId ? employeeNameById[node.employeeId] || node.employeeId : "未选择";
  const acceptance = node.acceptanceEnabled
    ? `评判：${(node.acceptanceCriteria || "").trim() || "未填写评判标准"}`
    : "";
  const stageList = normalizeWorkflowStageOutcomeCriteria(node.stageSuccessCriteria);
  const stageN = stageList.length;
  let stageSuccess = "";
  if (stageN > 0) {
    const labels = stageList.map((c, i) => (c.name.trim() ? c.name.trim() : `成果${i + 1}`));
    const joined = labels.join("、");
    stageSuccess = joined.length > 42 ? `成果：${joined.slice(0, 42)}…` : `成果：${joined}`;
  }
  const basisRefCount = normalizeStageTaskBasisRefsFromNodeData({
    label: node.title || "",
    stageTaskBasisRefs: node.stageTaskBasisRefs,
    stageTaskBasisRef: typeof node.stageTaskBasisRef === "string" ? node.stageTaskBasisRef : undefined,
  } as WorkflowGraphNodeData).length;
  const basisLine = basisRefCount > 0 ? `依据：已选 ${basisRefCount} 项团队成果` : "";
  const taskDisplay = basisLine ? `任务：${task}\n${basisLine}` : `任务：${task}`;
  return {
    assignee: `执行：${assignee}`,
    task: taskDisplay,
    acceptance,
    stageSuccess,
  };
}

export function getEmployeeNodeHeight(node: Partial<CanvasNodeItem>): number {
  let h = node.acceptanceEnabled ? EMPLOYEE_NODE_HEIGHT_WITH_ACCEPTANCE : EMPLOYEE_NODE_HEIGHT;
  if (normalizeWorkflowStageOutcomeCriteria(node.stageSuccessCriteria).length > 0) {
    h += EMPLOYEE_NODE_HEIGHT_STAGE_SUCCESS_EXTRA;
  }
  {
    const basisN = normalizeStageTaskBasisRefsFromNodeData({
      label: node.title || "",
      stageTaskBasisRefs: node.stageTaskBasisRefs,
      stageTaskBasisRef: typeof node.stageTaskBasisRef === "string" ? node.stageTaskBasisRef : undefined,
    } as WorkflowGraphNodeData).length;
    if (basisN > 0) {
      h += EMPLOYEE_NODE_HEIGHT_TASK_BASIS_EXTRA + Math.max(0, basisN - 1) * 6;
    }
  }
  return h;
}

export function createGraphNodeFromSnapshotNode(node: CanvasNodeItem, employeeNameById: Record<string, string> = {}): any {
  if (node.kind === "start" || node.kind === "end") {
    return {
      id: node.id,
      x: node.x,
      y: node.y,
      width: FLOW_NODE_WIDTH,
      height: FLOW_NODE_HEIGHT,
      shape: "rect",
      data: { kind: node.kind, title: node.title, passthroughData: node.passthroughData },
      attrs: {
        body: {
          fill: node.kind === "start" ? "#E6F4FF" : "#FFF1F0",
          stroke: node.kind === "start" ? "#1677FF" : "#FF4D4F",
          strokeWidth: 1,
          rx: 10,
          ry: 10,
        },
        label: { text: node.title, fill: "#1F1F1F", fontSize: 14, fontWeight: 600 },
      },
      ports: createPorts(),
    };
  }
  const material = MATERIALS[node.materialKey || "employee"] ?? MATERIALS.employee;
  const theme = node.theme ?? material.theme;
  const style = getMaterialNodeStyle(theme);
  const title = node.title || material.title;
  const isEmployeeNode = node.materialKey === "employee";
  const employeeSummary = isEmployeeNode ? buildEmployeeNodeSummary(node, employeeNameById) : null;
  return {
    id: node.id,
    x: node.x,
    y: node.y,
    width: MATERIAL_NODE_WIDTH,
    height: isEmployeeNode ? getEmployeeNodeHeight(node) : MATERIAL_NODE_HEIGHT,
    shape: "wise-material-card",
    data: {
      kind: "material",
      passthroughData: node.passthroughData,
      title,
      materialKey: material.key,
      theme,
      stageTask: node.stageTask || "",
      employeeId: node.employeeId,
      stageSuccessCriteria: normalizeWorkflowStageOutcomeCriteria(node.stageSuccessCriteria),
      ...(() => {
        const refs = normalizeStageTaskBasisRefsFromNodeData({
          label: node.title || "",
          stageTaskBasisRefs: node.stageTaskBasisRefs,
          stageTaskBasisRef: typeof node.stageTaskBasisRef === "string" ? node.stageTaskBasisRef : undefined,
        } as WorkflowGraphNodeData);
        return {
          ...(refs.length > 0 ? { stageTaskBasisRefs: refs } : {}),
        };
      })(),
      acceptanceEnabled: node.acceptanceEnabled ?? false,
      acceptanceCriteria: node.acceptanceCriteria || "",
    },
    attrs: {
      body: { fill: "#fff", stroke: style.border },
      iconBg: { fill: style.body },
      iconText: { text: material.iconText, fill: style.text },
      title: { text: title, fill: "#141414" },
      desc1: { text: isEmployeeNode ? employeeSummary?.assignee ?? "" : material.desc, fill: "rgba(0,0,0,0.78)" },
      desc2: { text: isEmployeeNode ? employeeSummary?.task ?? "" : "", fill: "rgba(0,0,0,0.65)" },
      desc3: { text: isEmployeeNode ? employeeSummary?.acceptance ?? "" : "", fill: "rgba(0,0,0,0.65)" },
      desc4: { text: "", fill: "rgba(0,0,0,0.65)" },
    },
    ports: createPorts(),
  };
}

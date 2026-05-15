import { Graph, type Node as X6Node } from "@antv/x6";
import type { WorkflowGraphNodeData } from "../../types";
import { normalizeWorkflowStageOutcomeCriteria } from "../../utils/workflowStageOutcomeCriteria";
import {
  STAGE_TASK_BASIS_REF_SEPARATOR,
  normalizeStageTaskBasisRefsFromNodeData,
} from "../../services/workflowGraphRuntime";
import type { CanvasEdgeItem, CanvasNodeItem, CanvasSnapshot, MaterialTheme } from "../workflowGraph/workflowX6CanvasShared";

export function isWorkflowMaterialX6Node(node: X6Node): boolean {
  if (node.shape === "wise-material-card") return true;
  const data = (node.getData() ?? {}) as Partial<CanvasNodeItem>;
  return data.kind === "material";
}

/** 画布快照为权威数据源（与 React state 同步）；避免仅读 X6 时落后于 value 的更新。 */
export function isMaterialSnapshotNode(node: CanvasNodeItem): boolean {
  if (node.kind === "material") return true;
  if (node.kind === "start" || node.kind === "end") return false;
  return Boolean(node.materialKey === "employee" || node.employeeId);
}

export function buildStageTaskBasisOptionsFromCanvasSnapshot(snapshot: CanvasSnapshot): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (const node of snapshot.nodes) {
    if (!isMaterialSnapshotNode(node)) continue;
    const stageLabel = (node.title || node.id).trim() || node.id;
    const list = normalizeWorkflowStageOutcomeCriteria(node.stageSuccessCriteria);
    list.forEach((c, index) => {
      const name = c.name.trim() || `成果 ${index + 1}`;
      out.push({
        value: `${node.id}${STAGE_TASK_BASIS_REF_SEPARATOR}${index}`,
        label: `${stageLabel} · ${name}`,
      });
    });
  }
  return out;
}

export function buildStageTaskBasisOptionsFromGraph(graph: Graph): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (const cell of graph.getNodes()) {
    if (!isWorkflowMaterialX6Node(cell)) continue;
    const data = (cell.getData() ?? {}) as Partial<CanvasNodeItem>;
    const stageLabel = ((data.title as string) || cell.id).trim() || cell.id;
    const list = normalizeWorkflowStageOutcomeCriteria(data.stageSuccessCriteria);
    list.forEach((c, index) => {
      const name = c.name.trim() || `成果 ${index + 1}`;
      out.push({
        value: `${cell.id}${STAGE_TASK_BASIS_REF_SEPARATOR}${index}`,
        label: `${stageLabel} · ${name}`,
      });
    });
  }
  return out;
}

export function mergeStageTaskBasisOptionLists(
  primary: { value: string; label: string }[],
  secondary: { value: string; label: string }[],
): { value: string; label: string }[] {
  const map = new Map<string, string>();
  for (const option of primary) map.set(option.value, option.label);
  for (const option of secondary) {
    if (!map.has(option.value)) map.set(option.value, option.label);
  }
  return [...map.entries()].map(([value, label]) => ({ value, label }));
}

export function buildMergedStageTaskBasisSelectOptions(snapshot: CanvasSnapshot, graph: Graph | null): { value: string; label: string }[] {
  const fromSnapshot = buildStageTaskBasisOptionsFromCanvasSnapshot(snapshot);
  if (!graph) return fromSnapshot;
  return mergeStageTaskBasisOptionLists(fromSnapshot, buildStageTaskBasisOptionsFromGraph(graph));
}

export function dirnameFromAbsolutePath(path: string): string {
  const i = path.lastIndexOf("/");
  if (i <= 0) return path;
  return path.slice(0, i);
}

export function toErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  if (typeof err === "string" && err.trim()) return err;
  return fallback;
}

export function canvasNodeItemFromX6Node(node: X6Node): CanvasNodeItem {
  const raw = (node.getData() ?? {}) as Partial<CanvasNodeItem>;
  const basisRefsNormalized = normalizeStageTaskBasisRefsFromNodeData({
    label: (raw.title as string) || "",
    stageTaskBasisRefs: Array.isArray(raw.stageTaskBasisRefs) ? raw.stageTaskBasisRefs : undefined,
    stageTaskBasisRef: typeof raw.stageTaskBasisRef === "string" ? raw.stageTaskBasisRef : undefined,
  } as WorkflowGraphNodeData);
  return {
    id: node.id,
    kind: (raw.kind as CanvasNodeItem["kind"]) ?? "material",
    x: node.position().x,
    y: node.position().y,
    title: raw.title || "节点",
    materialKey: raw.materialKey,
    theme: raw.theme,
    stageTask: raw.stageTask || "",
    employeeId: raw.employeeId,
    stageSuccessCriteria: normalizeWorkflowStageOutcomeCriteria(raw.stageSuccessCriteria),
    ...(basisRefsNormalized.length > 0 ? { stageTaskBasisRefs: basisRefsNormalized } : {}),
    acceptanceEnabled: raw.acceptanceEnabled ?? false,
    acceptanceCriteria: raw.acceptanceCriteria || "",
    passthroughData: raw.passthroughData,
  };
}

export function normalizeStageTaskBasisRefsForNode(node: CanvasNodeItem): string[] {
  return normalizeStageTaskBasisRefsFromNodeData({
    label: node.title,
    stageTaskBasisRefs: Array.isArray(node.stageTaskBasisRefs) ? node.stageTaskBasisRefs : undefined,
    stageTaskBasisRef: typeof node.stageTaskBasisRef === "string" ? node.stageTaskBasisRef : undefined,
  } as WorkflowGraphNodeData);
}

export function snapshotFromWorkflowGraph(graph: Graph): CanvasSnapshot {
  const rawNodes: CanvasNodeItem[] = graph.getNodes().map((node) => {
    const data = (node.getData() ?? {}) as Partial<CanvasNodeItem>;
    const pos = node.position();
    const kindFromData = data.kind;
    const inferredKind: CanvasNodeItem["kind"] =
      kindFromData === "start" || kindFromData === "end" || kindFromData === "material"
        ? kindFromData
        : node.id === "start"
          ? "start"
          : node.id === "end"
            ? "end"
            : "material";
    const mergedRefs = normalizeStageTaskBasisRefsForNode({
      id: node.id,
      kind: inferredKind,
      title: (data.title as string) || "",
      x: pos.x,
      y: pos.y,
      stageTaskBasisRefs: Array.isArray(data.stageTaskBasisRefs) ? data.stageTaskBasisRefs : undefined,
      stageTaskBasisRef: typeof data.stageTaskBasisRef === "string" ? data.stageTaskBasisRef : undefined,
    });
    const stageSuccessCriteria = normalizeWorkflowStageOutcomeCriteria(data.stageSuccessCriteria);
    return {
      id: node.id,
      kind: inferredKind,
      title: (data.title as string) ?? (inferredKind === "start" ? "开始" : inferredKind === "end" ? "结束" : "节点"),
      materialKey: data.materialKey as string | undefined,
      theme: data.theme as MaterialTheme | undefined,
      stageTask: (data.stageTask as string | undefined) ?? "",
      employeeId: data.employeeId as string | undefined,
      ...(stageSuccessCriteria.length > 0 ? { stageSuccessCriteria } : {}),
      ...(mergedRefs.length > 0 ? { stageTaskBasisRefs: mergedRefs } : {}),
      acceptanceEnabled: Boolean(data.acceptanceEnabled),
      acceptanceCriteria: (data.acceptanceCriteria as string | undefined) ?? "",
      passthroughData: data.passthroughData as Record<string, unknown> | undefined,
      x: pos.x,
      y: pos.y,
    };
  });
  const nodesById = new Map<string, CanvasNodeItem>();
  rawNodes.forEach((node) => nodesById.set(node.id, node));
  const dedupedByIdNodes = Array.from(nodesById.values());
  const uniqueStart = dedupedByIdNodes.find((node) => node.kind === "start");
  const uniqueEnd = dedupedByIdNodes.find((node) => node.kind === "end");
  const nodes = dedupedByIdNodes.filter((node) => node.kind === "material");
  if (uniqueStart) nodes.unshift(uniqueStart);
  if (uniqueEnd) nodes.push(uniqueEnd);
  const startIdRemap = new Map<string, string>();
  const endIdRemap = new Map<string, string>();
  if (uniqueStart) {
    dedupedByIdNodes
      .filter((node) => node.kind === "start" && node.id !== uniqueStart.id)
      .forEach((node) => startIdRemap.set(node.id, uniqueStart.id));
  }
  if (uniqueEnd) {
    dedupedByIdNodes
      .filter((node) => node.kind === "end" && node.id !== uniqueEnd.id)
      .forEach((node) => endIdRemap.set(node.id, uniqueEnd.id));
  }
  const nodeIdSet = new Set(nodes.map((node) => node.id));
  const edgeKeySet = new Set<string>();
  const edges: CanvasEdgeItem[] = graph
    .getEdges()
    .map((edge, index) => {
      const rawSource = edge.getSourceCellId() || "";
      const rawTarget = edge.getTargetCellId() || "";
      const sourcePort = edge.getSourcePortId() || undefined;
      const targetPort = edge.getTargetPortId() || undefined;
      const source = startIdRemap.get(rawSource) ?? endIdRemap.get(rawSource) ?? rawSource;
      const target = startIdRemap.get(rawTarget) ?? endIdRemap.get(rawTarget) ?? rawTarget;
      return { id: edge.id || `edge-${index + 1}`, source, target, sourcePort, targetPort };
    })
    .filter((edge) => edge.source && edge.target && nodeIdSet.has(edge.source) && nodeIdSet.has(edge.target))
    .filter((edge) => {
      const key = `${edge.source}:${edge.sourcePort ?? ""}->${edge.target}:${edge.targetPort ?? ""}`;
      if (edgeKeySet.has(key)) return false;
      edgeKeySet.add(key);
      return true;
    });
  return { nodes, edges };
}

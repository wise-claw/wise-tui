import { DeleteOutlined, PlusOutlined, QuestionCircleOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import { Graph, type Edge as X6Edge, type Node as X6Node } from "@antv/x6";
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import type {
  EmployeeItem,
  WorkflowGraph,
  WorkflowGraphNodeData,
  WorkflowStageOutcomeCriterion,
  WorkflowTemplateItem,
  WorkflowTemplateStage,
} from "../../types";
import { normalizeWorkflowStageOutcomeCriteria } from "../../utils/workflowStageOutcomeCriteria";
import type { WorkflowGraphItem, WorkflowGraphValidationError, WorkflowGraphValidationResult } from "../../services/workflowGraphs";
import {
  STAGE_TASK_BASIS_REF_SEPARATOR,
  normalizeStageTaskBasisRefsFromNodeData,
} from "../../services/workflowGraphRuntime";
import type { CanvasEdgeItem, CanvasNodeItem, CanvasSnapshot, MaterialItem, MaterialTheme } from "../workflowGraph/workflowX6CanvasShared";
import {
  MATERIAL_KEYS,
  MATERIAL_NODE_HEIGHT,
  MATERIAL_NODE_WIDTH,
  MATERIALS,
  FLOW_NODE_HEIGHT,
  FLOW_NODE_WIDTH,
  createDefaultCanvasSnapshot,
  createGraphNodeFromSnapshotNode,
  ensureWorkflowX6Nodes,
  getEmployeeNodeHeight,
  buildEmployeeNodeSummary,
  isPortConnected,
  normalizeCanvasSnapshot,
  refreshNodePorts,
  setPortColor,
  setPortVisible,
  workflowGraphToCanvasSnapshot,
} from "../workflowGraph/workflowX6CanvasShared";
import { runPrdSplitClaude } from "../../services/claudeSplitExecutor";
import { materializePrdSnapshot, readSnapshotFile } from "../../services/materializePrdSnapshot";
import "./index.css";

const MilkdownEditor = lazy(() => import("../MilkdownViewer").then((module) => ({ default: module.MilkdownEditor })));

interface Props {
  open: boolean;
  loading: boolean;
  employees: EmployeeItem[];
  templates: WorkflowTemplateItem[];
  projects?: { id: string; name: string }[];
  /** workflowId -> [projectId, ...] map loaded from backend */
  workflowProjectIds?: Record<string, string[]>;
  onClose: () => void;
  onSaveTemplate: (input: {
    workflowId?: string;
    name: string;
    isDefault: boolean;
    stages: WorkflowTemplateStage[];
    projectIds?: string[];
  }) => Promise<WorkflowTemplateItem>;
  onLoadGraphItem: (workflowId: string) => Promise<WorkflowGraphItem | null>;
  onSaveGraph: (input: { workflowId: string; graph: WorkflowGraph; status?: "draft" | "published" }) => Promise<void>;
  onValidateGraph: (graph: WorkflowGraph) => Promise<WorkflowGraphValidationResult>;
  onDeleteTemplate: (workflowId: string) => Promise<void>;
  repositoryPath?: string | null;
  selectableEmployeeIds?: string[];
}

type GraphStatus = "published" | "draft" | "unknown" | "none";
type OptimizeTone = "concise" | "structured" | "acceptance" | "risk";

function isWorkflowMaterialX6Node(node: X6Node): boolean {
  if (node.shape === "wise-material-card") return true;
  const data = (node.getData() ?? {}) as Partial<CanvasNodeItem>;
  return data.kind === "material";
}

/** 画布快照为权威数据源（与 React state 同步）；避免仅读 X6 时落后于 value 的更新。 */
function isMaterialSnapshotNode(node: CanvasNodeItem): boolean {
  if (node.kind === "material") return true;
  if (node.kind === "start" || node.kind === "end") return false;
  return Boolean(node.materialKey === "employee" || node.employeeId);
}

function buildStageTaskBasisOptionsFromCanvasSnapshot(snapshot: CanvasSnapshot): { value: string; label: string }[] {
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

function buildStageTaskBasisOptionsFromGraph(graph: Graph): { value: string; label: string }[] {
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

function mergeStageTaskBasisOptionLists(
  primary: { value: string; label: string }[],
  secondary: { value: string; label: string }[],
): { value: string; label: string }[] {
  const map = new Map<string, string>();
  for (const o of primary) map.set(o.value, o.label);
  for (const o of secondary) {
    if (!map.has(o.value)) map.set(o.value, o.label);
  }
  return [...map.entries()].map(([v, label]) => ({ value: v, label }));
}

function buildMergedStageTaskBasisSelectOptions(snapshot: CanvasSnapshot, graph: Graph | null): { value: string; label: string }[] {
  const fromSnapshot = buildStageTaskBasisOptionsFromCanvasSnapshot(snapshot);
  if (!graph) return fromSnapshot;
  return mergeStageTaskBasisOptionLists(fromSnapshot, buildStageTaskBasisOptionsFromGraph(graph));
}

const WORKFLOW_NODE_OPTIMIZE_TONE_STORAGE_KEY = "wise.workflow.node.optimizeToneByField";
const OPTIMIZE_TONE_OPTIONS: Array<{ value: OptimizeTone; label: string; prompt: string }> = [
  { value: "concise", label: "精简表达", prompt: "尽量减少冗余表达，保持信息完整。" },
  { value: "structured", label: "结构化输出", prompt: "按清晰结构组织内容，便于执行和复盘。" },
  { value: "acceptance", label: "验收导向", prompt: "强调可验证标准与可交付结果。" },
  { value: "risk", label: "风险导向", prompt: "补充边界条件、风险点与兜底策略。" },
];

function dirnameFromAbsolutePath(path: string): string {
  const i = path.lastIndexOf("/");
  if (i <= 0) return path;
  return path.slice(0, i);
}

function toErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  if (typeof err === "string" && err.trim()) return err;
  return fallback;
}

function isOptimizeTone(value: unknown): value is OptimizeTone {
  return value === "concise" || value === "structured" || value === "acceptance" || value === "risk";
}

function canvasSnapshotToWorkflowGraph(snapshot: CanvasSnapshot, fallbackEmployeeId?: string): WorkflowGraph {
  const normalizedSnapshot = normalizeCanvasSnapshot(snapshot);
  const normalizedNodes = [...normalizedSnapshot.nodes];
  return {
    nodes: normalizedNodes.map((node) => {
      if (node.kind === "start") {
        return { id: node.id, type: "start", position: { x: node.x, y: node.y }, data: { label: node.title || "开始" } };
      }
      if (node.kind === "end") {
        return { id: node.id, type: "end", position: { x: node.x, y: node.y }, data: { label: node.title || "结束" } };
      }
      const stageSuccess = normalizeWorkflowStageOutcomeCriteria(node.stageSuccessCriteria);
      const basisRefs = normalizeStageTaskBasisRefsFromNodeData({
        label: node.title || "",
        stageTaskBasisRefs: node.stageTaskBasisRefs,
        stageTaskBasisRef: typeof node.stageTaskBasisRef === "string" ? node.stageTaskBasisRef : undefined,
      } as WorkflowGraphNodeData);
      return {
        id: node.id,
        type: "approval",
        position: { x: node.x, y: node.y },
        data: {
          label: node.title || "审批节点",
          employeeId: node.employeeId || fallbackEmployeeId,
          employeePrompt: node.stageTask || "",
          conditionIfPrompt: node.acceptanceEnabled ? node.acceptanceCriteria || "" : "",
          conditionElsePrompt: node.acceptanceEnabled ? "acceptance_enabled" : "",
          materialKey: node.materialKey || "employee",
          ...(stageSuccess.length > 0 ? { stageSuccessCriteria: stageSuccess } : {}),
          ...(basisRefs.length > 0 ? { stageTaskBasisRefs: basisRefs } : {}),
        },
      };
    }),
    edges: normalizedSnapshot.edges.map((edge, index) => ({
      id: edge.id || `edge-${index + 1}`,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourcePort,
      targetHandle: edge.targetPort,
      data: {
        sourcePort: edge.sourcePort,
        targetPort: edge.targetPort,
      },
    })),
  };
}

function canvasSnapshotToStages(snapshot: CanvasSnapshot, employees: EmployeeItem[]): WorkflowTemplateStage[] {
  const normalizedSnapshot = normalizeCanvasSnapshot(snapshot);
  const fallbackEmployee = employees.find((employee) => employee.enabled);
  const fallbackEmployeeId = fallbackEmployee?.id;
  const materialNodes = normalizedSnapshot.nodes
    .filter((node) => node.kind === "material" && (node.materialKey === "employee" || Boolean(node.employeeId)))
    .sort((a, b) => a.x - b.x || a.y - b.y);
  return materialNodes.map((node, index) => ({
    id: node.id,
    name: node.title || `阶段${index + 1}`,
    stageOrder: index,
    passRule: "ALL_APPROVE",
    rejectRule: "ANY_REJECT_BACK",
    assignees: node.employeeId || fallbackEmployeeId ? [{ id: "", employeeId: node.employeeId || fallbackEmployeeId!, requiredCount: 1, isRequired: true }] : [],
  }));
}

function getValidationGroupTitle(code: string): string {
  if (code.includes("EDGE")) return "连线错误";
  if (code.includes("NODE")) return "节点错误";
  if (code.includes("START") || code.includes("APPROVAL")) return "流程结构错误";
  return "其他错误";
}

function getValidationSuggestion(code: string): string {
  const suggestions: Record<string, string> = {
    WF_GRAPH_INVALID_FORMAT: "请确认 graph 为对象结构，包含 nodes/edges 字段。",
    WF_GRAPH_NODES_INVALID: "请检查 nodes 是否为数组。",
    WF_GRAPH_NODES_EMPTY: "请至少添加一个开始节点和一个审批节点。",
    WF_GRAPH_NODE_ID_MISSING: "请为该节点填写唯一 id。",
    WF_GRAPH_NODE_ID_DUPLICATED: "请修改重复节点 id，保证每个节点 id 唯一。",
    WF_GRAPH_NODE_TYPE_MISSING: "请为该节点指定类型（start/task/approval/end）。",
    WF_GRAPH_EDGES_INVALID: "请检查 edges 是否为数组。",
    WF_GRAPH_EDGES_EMPTY: "请至少连接一条边，形成有效流程。",
    WF_GRAPH_EDGE_ID_MISSING: "请为该边填写唯一 id。",
    WF_GRAPH_EDGE_ID_DUPLICATED: "请修改重复边 id，保证每条边 id 唯一。",
    WF_GRAPH_EDGE_ENDPOINT_MISSING: "请补全边的 source 与 target。",
    WF_GRAPH_EDGE_SOURCE_NOT_FOUND: "请将该边连接到存在的源节点。",
    WF_GRAPH_EDGE_TARGET_NOT_FOUND: "请将该边连接到存在的目标节点。",
    WF_GRAPH_START_MISSING: "请添加一个 start 节点作为流程入口。",
    WF_GRAPH_START_DUPLICATED: "请只保留一个 start 节点。",
    WF_GRAPH_APPROVAL_INCOMING_MISSING: "请为审批节点添加至少一条入边。",
    WF_GRAPH_APPROVAL_OUTGOING_MISSING: "请为审批节点添加至少一条出边。",
  };
  return suggestions[code] ?? "请根据错误提示修正节点/边配置后重试发布。";
}

function WorkflowCanvasEditor({
  value,
  onChange,
  employees,
  selectableEmployeeIds,
  repositoryPath,
}: {
  value: CanvasSnapshot;
  onChange: (next: CanvasSnapshot) => void;
  employees: EmployeeItem[];
  selectableEmployeeIds: string[];
  repositoryPath?: string | null;
}) {
  const graphContainerRef = useRef<HTMLDivElement | null>(null);
  const canvasWrapperRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const employeeNameByIdRef = useRef<Record<string, string>>({});
  const syncingRef = useRef(false);
  const connectingRef = useRef(false);
  const localMutationRef = useRef(false);
  const [draggingMaterialKey, setDraggingMaterialKey] = useState<string | null>(null);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [editingNode, setEditingNode] = useState<CanvasNodeItem | null>(null);
  const [stageTaskBasisSelectOptions, setStageTaskBasisSelectOptions] = useState<{ value: string; label: string }[]>([]);
  const [optimizingField, setOptimizingField] = useState<"stageTask" | "acceptanceCriteria" | null>(null);
  const [optimizeToneByField, setOptimizeToneByField] = useState<Record<"stageTask" | "acceptanceCriteria", OptimizeTone>>({
    stageTask: "structured",
    acceptanceCriteria: "acceptance",
  });
  const [editForm] = Form.useForm<{
    title: string;
    stageTask: string;
    stageTaskBasisRefs?: string[];
    employeeId?: string;
    stageSuccessCriteria?: WorkflowStageOutcomeCriterion[];
    acceptanceEnabled: boolean;
    acceptanceCriteria: string;
  }>();
  const selectableEmployeeIdSet = useMemo(() => new Set(selectableEmployeeIds), [selectableEmployeeIds]);
  const occupiedEmployeeIds = useMemo(() => {
    const ids = new Set(
      value.nodes
        .filter((node) => node.kind === "material" && node.materialKey === "employee" && Boolean(node.employeeId))
        .map((node) => node.employeeId as string),
    );
    if (editingNode?.employeeId) {
      ids.delete(editingNode.employeeId);
    }
    return ids;
  }, [value.nodes, editingNode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(WORKFLOW_NODE_OPTIMIZE_TONE_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<Record<"stageTask" | "acceptanceCriteria", unknown>>;
      setOptimizeToneByField((prev) => ({
        stageTask: isOptimizeTone(parsed.stageTask) ? parsed.stageTask : prev.stageTask,
        acceptanceCriteria: isOptimizeTone(parsed.acceptanceCriteria) ? parsed.acceptanceCriteria : prev.acceptanceCriteria,
      }));
    } catch {
      // ignore invalid local storage payload
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(WORKFLOW_NODE_OPTIMIZE_TONE_STORAGE_KEY, JSON.stringify(optimizeToneByField));
    } catch {
      // ignore write failures
    }
  }, [optimizeToneByField]);

  const employeeNameById = useMemo(
    () => Object.fromEntries(employees.map((item) => [item.id, item.name])),
    [employees],
  );
  const employeeOptions = useMemo(() => {
    const base = employees
      .filter((item) => item.enabled && selectableEmployeeIdSet.has(item.id) && !occupiedEmployeeIds.has(item.id))
      .map((item) => ({
        value: item.id,
        label: item.name,
      }));
    const selectedId = editingNode?.employeeId?.trim();
    if (!selectedId) return base;
    if (base.some((opt) => opt.value === selectedId)) return base;

    const emp = employees.find((item) => item.id === selectedId);
    const name = emp?.name ?? employeeNameById[selectedId] ?? `员工（${selectedId.slice(0, 8)}…）`;
    const labelSuffix = emp && !emp.enabled ? "（已禁用）" : "";
    return [{ value: selectedId, label: `${name}${labelSuffix}` }, ...base];
  }, [employees, selectableEmployeeIdSet, occupiedEmployeeIds, editingNode?.employeeId, employeeNameById]);
  useEffect(() => {
    employeeNameByIdRef.current = employeeNameById;
  }, [employeeNameById]);

  async function handleAiOptimizeField(field: "stageTask" | "acceptanceCriteria") {
    const current = String(editForm.getFieldValue(field) ?? "").trim();
    if (!current) {
      message.warning(field === "stageTask" ? "执行任务为空，无法优化。" : "评判标准为空，无法优化。");
      return;
    }
    if (!repositoryPath) {
      message.warning("未关联仓库，无法执行 AI 优化。");
      return;
    }
    const optimizeTone = optimizeToneByField[field];
    const tonePrompt = OPTIMIZE_TONE_OPTIONS.find((item) => item.value === optimizeTone)?.prompt ?? "";
    const title = String(editForm.getFieldValue("title") ?? "").trim();
    const prompt = [
      "你是工作流文案优化专家，请优化下面的内容。",
      "",
      "执行边界（必须遵守）：",
      "- 不要读取本地仓库、目录或任何文件；",
      "- 不要使用 @文件、路径探测、工具调用结果等外部上下文；",
      "- 仅基于本次输入的原始文本进行改写与优化。",
      "",
      "优化目标：",
      "1) 保留原始语义与业务目标，不改变意图；",
      "2) 提升表达清晰度、可执行性与可评估性；",
      "3) 输出必须是可直接替换的 Markdown 正文，不要解释。",
      tonePrompt ? `4) 优化风格：${tonePrompt}` : "",
      "",
      `阶段名称：${title || "未命名阶段"}`,
      `字段类型：${field === "stageTask" ? "执行任务" : "评判标准"}`,
      "",
      "原始内容：",
      "```markdown",
      current,
      "```",
      "",
      "请直接输出优化后的正文，不要输出代码块标记。",
    ].join("\n");
    setOptimizingField(field);
    try {
      const snapshot = await materializePrdSnapshot(
        repositoryPath,
        `# Workflow Field Optimize\n\nfield=${field}\nts=${Date.now()}\n`,
        null,
        null,
        null,
        null,
      );
      const run = await runPrdSplitClaude({
        projectPath: repositoryPath,
        runDir: dirnameFromAbsolutePath(snapshot.prdRelativePath),
        prompt,
      });
      const raw = await readSnapshotFile(run.rawResultPath).catch(() => "");
      const cleaned = raw.replace(/^```[a-zA-Z]*\s*/g, "").replace(/```$/g, "").trim();
      if (!cleaned) {
        message.warning("AI 优化未返回有效内容。");
        return;
      }
      editForm.setFieldValue(field, cleaned);
      message.success(field === "stageTask" ? "执行任务已完成 AI 优化。" : "评判标准已完成 AI 优化。");
    } catch (err) {
      message.error(`AI 优化失败：${toErrorMessage(err, "未知错误")}`);
    } finally {
      setOptimizingField(null);
    }
  }

  function applyNodeVisual(node: X6Node, data: Partial<CanvasNodeItem>) {
    if (data.kind !== "material") {
      node.setAttrByPath("label/text", data.title ?? "节点");
      return;
    }
    const material = MATERIALS[data.materialKey || "employee"] ?? MATERIALS.employee;
    const title = data.title || material.title;
    const isEmployeeNode = data.materialKey === "employee";
    const employeeSummary = isEmployeeNode ? buildEmployeeNodeSummary(data, employeeNameById) : null;
    node.resize(MATERIAL_NODE_WIDTH, isEmployeeNode ? getEmployeeNodeHeight(data) : MATERIAL_NODE_HEIGHT);
    node.setAttrByPath("title/text", title);
    node.setAttrByPath("desc1/text", isEmployeeNode ? employeeSummary?.assignee ?? "" : material.desc);
    node.setAttrByPath("desc2/text", isEmployeeNode ? employeeSummary?.task ?? "" : "");
    node.setAttrByPath("desc3/text", isEmployeeNode ? employeeSummary?.acceptance ?? "" : "");
    node.setAttrByPath("desc4/text", isEmployeeNode ? employeeSummary?.stageSuccess ?? "" : "");
  }

  function openEditModal(node: X6Node) {
    const raw = (node.getData() ?? {}) as Partial<CanvasNodeItem>;
    const basisRefsNormalized = normalizeStageTaskBasisRefsFromNodeData({
      label: (raw.title as string) || "",
      stageTaskBasisRefs: Array.isArray(raw.stageTaskBasisRefs) ? raw.stageTaskBasisRefs : undefined,
      stageTaskBasisRef: typeof raw.stageTaskBasisRef === "string" ? raw.stageTaskBasisRef : undefined,
    } as WorkflowGraphNodeData);
    const payload: CanvasNodeItem = {
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
    };
    setEditingNode(payload);
    setStageTaskBasisSelectOptions(buildMergedStageTaskBasisSelectOptions(value, graphRef.current));
    const stageList = normalizeWorkflowStageOutcomeCriteria(payload.stageSuccessCriteria);
    editForm.setFieldsValue({
      title: payload.title,
      stageTask: payload.stageTask || "",
      stageTaskBasisRefs: basisRefsNormalized.length > 0 ? basisRefsNormalized : undefined,
      employeeId: payload.employeeId,
      stageSuccessCriteria: stageList.length > 0 ? stageList : [],
      acceptanceEnabled: payload.acceptanceEnabled ?? false,
      acceptanceCriteria: payload.acceptanceCriteria || "",
    });
  }

  const emitSnapshot = () => {
    if (!graphRef.current) return;
    const graph = graphRef.current;
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
      return {
        id: node.id,
        kind: inferredKind,
        title: (data.title as string) ?? (inferredKind === "start" ? "开始" : inferredKind === "end" ? "结束" : "节点"),
        materialKey: data.materialKey as string | undefined,
        theme: data.theme as MaterialTheme | undefined,
        stageTask: (data.stageTask as string | undefined) ?? "",
        employeeId: data.employeeId as string | undefined,
        ...(() => {
          const list = normalizeWorkflowStageOutcomeCriteria(data.stageSuccessCriteria);
          return list.length > 0 ? { stageSuccessCriteria: list } : {};
        })(),
        ...(() => {
          const merged = normalizeStageTaskBasisRefsFromNodeData({
            label: (data.title as string) || "",
            stageTaskBasisRefs: Array.isArray(data.stageTaskBasisRefs) ? data.stageTaskBasisRefs : undefined,
            stageTaskBasisRef: typeof data.stageTaskBasisRef === "string" ? data.stageTaskBasisRef : undefined,
          } as WorkflowGraphNodeData);
          return {
            ...(merged.length > 0 ? { stageTaskBasisRefs: merged } : {}),
          };
        })(),
        acceptanceEnabled: Boolean(data.acceptanceEnabled),
        acceptanceCriteria: (data.acceptanceCriteria as string | undefined) ?? "",
        x: pos.x,
        y: pos.y,
      };
    });
    const nodesById = new Map<string, CanvasNodeItem>();
    rawNodes.forEach((node) => {
      nodesById.set(node.id, node);
    });
    const dedupedByIdNodes = Array.from(nodesById.values());
    const uniqueStart = dedupedByIdNodes.find((node) => node.kind === "start");
    const uniqueEnd = dedupedByIdNodes.find((node) => node.kind === "end");
    let nodes = dedupedByIdNodes.filter((node) => node.kind === "material");
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
        return {
          id: edge.id || `edge-${index + 1}`,
          source,
          target,
          sourcePort,
          targetPort,
        };
      })
      .filter((edge) => edge.source && edge.target && nodeIdSet.has(edge.source) && nodeIdSet.has(edge.target))
      .filter((edge) => {
        const key = `${edge.source}:${edge.sourcePort ?? ""}->${edge.target}:${edge.targetPort ?? ""}`;
        if (edgeKeySet.has(key)) return false;
        edgeKeySet.add(key);
        return true;
      });
    localMutationRef.current = true;
    onChange({ nodes, edges });
  };

  useEffect(() => {
    if (!graphContainerRef.current) return;
    ensureWorkflowX6Nodes();
    const graph = new Graph({
      container: graphContainerRef.current,
      grid: true,
      panning: true,
      mousewheel: { enabled: true, minScale: 0.5, maxScale: 2.5 },
      connecting: {
        allowBlank: false,
        allowLoop: false,
        allowNode: false,
        allowEdge: false,
        snap: { radius: 24 },
        connector: "smooth",
        connectionPoint: "anchor",
        highlight: true,
        validateMagnet({ magnet }) {
          return Boolean(magnet) && magnet?.getAttribute("magnet") !== "false";
        },
        validateConnection({ targetMagnet }) {
          return Boolean(targetMagnet);
        },
      },
      highlighting: {
        magnetAdsorbed: {
          name: "stroke",
          args: {
            attrs: {
              fill: "#5F95FF",
              stroke: "#5F95FF",
            },
          },
        },
      },
    });
    graphRef.current = graph;

    const loadSnapshot = (snapshot: CanvasSnapshot) => {
      syncingRef.current = true;
      graph.clearCells();
      snapshot.nodes.forEach((node) => {
        graph.addNode(createGraphNodeFromSnapshotNode(node, employeeNameByIdRef.current));
      });
      graph.getNodes().forEach((node) => {
        node.getPorts().forEach((port) => {
          const portId = String(port.id);
          setPortColor(node, portId, portId ? isPortConnected(graph, node, portId) : false);
          setPortVisible(node, portId, false);
        });
      });
      snapshot.edges.forEach((edge) => {
        graph.addEdge({
          id: edge.id,
          source: { cell: edge.source, port: edge.sourcePort },
          target: { cell: edge.target, port: edge.targetPort },
          attrs: { line: { stroke: "#5F95FF", strokeWidth: 2, targetMarker: "classic" } },
        });
      });
      syncingRef.current = false;
    };

    loadSnapshot(value);
    const handleChange = () => {
      if (!syncingRef.current) emitSnapshot();
    };
    const updateZoom = () => {
      const ratio = graph.zoom();
      setZoomPercent(Math.round(ratio * 100));
    };
    graph.on("node:mouseup", handleChange);
    graph.on("edge:removed", handleChange);
    graph.on("edge:connected", handleChange);
    graph.on("scale", updateZoom);

    graph.on("node:mouseenter", ({ node }: { node: X6Node }) => {
      const data = (node.getData() ?? {}) as Partial<CanvasNodeItem>;
      if (data.kind === "material") {
        node.addTools([
          {
            name: "button",
            args: {
              x: "100%",
              y: 0,
              offset: { x: -36, y: 10 },
              markup: [
                {
                  tagName: "path",
                  selector: "button",
                  attrs: {
                    d: "M -3 3 L -1 5 L 5 -1 L 3 -3 Z M -4 4 L -3 6 L -5 6 Z",
                    fill: "none",
                    stroke: "#1677ff",
                    strokeWidth: 1.6,
                    strokeLinecap: "round",
                    strokeLinejoin: "round",
                    cursor: "pointer",
                  },
                },
                {
                  tagName: "path",
                  selector: "icon",
                  attrs: {
                    d: "M -3 3 L -1 5 L 5 -1 L 3 -3 Z M -4 4 L -3 6 L -5 6 Z",
                    fill: "#1677ff",
                    stroke: "none",
                    pointerEvents: "none",
                  },
                },
              ],
              onClick({ cell }: { cell: X6Node }) {
                openEditModal(cell);
              },
            },
          },
          { name: "button-remove", args: { x: "100%", y: 0, offset: { x: -12, y: 10 } } },
        ]);
      }
      refreshNodePorts(graph, node, true);
    });
    graph.on("node:mouseleave", ({ node }: { node: X6Node }) => {
      node.removeTools();
      if (connectingRef.current) return;
      refreshNodePorts(graph, node, false);
    });
    graph.on("node:port:mousedown", () => {
      connectingRef.current = true;
      graph.getNodes().forEach((node) => refreshNodePorts(graph, node, true));
    });
    graph.on("node:dblclick", ({ node }: { node: X6Node }) => {
      openEditModal(node);
    });
    graph.on("edge:mouseenter", ({ edge }: { edge: X6Edge }) => {
      edge.addTools([
        { name: "vertices" },
        { name: "source-arrowhead" },
        { name: "target-arrowhead" },
        { name: "button-remove", args: { distance: -38 } },
      ]);
    });
    graph.on("edge:mouseleave", ({ edge }: { edge: X6Edge }) => {
      edge.removeTools();
    });
    graph.on("edge:added", ({ edge }) => {
      connectingRef.current = true;
      const sourceId = edge.getSourceCellId();
      const sourcePort = edge.getSourcePortId();
      const targetId = edge.getTargetCellId();
      const targetPort = edge.getTargetPortId();
      if (sourceId && sourcePort) {
        const sourceNode = graph.getCellById(sourceId);
        if (sourceNode && sourceNode.isNode()) refreshNodePorts(graph, sourceNode, false);
      }
      if (targetId && targetPort) {
        const targetNode = graph.getCellById(targetId);
        if (targetNode && targetNode.isNode()) refreshNodePorts(graph, targetNode, false);
      }
    });
    graph.on("edge:removed", ({ edge }) => {
      const sourceId = edge.getSourceCellId();
      const targetId = edge.getTargetCellId();
      if (sourceId) {
        const sourceNode = graph.getCellById(sourceId);
        if (sourceNode && sourceNode.isNode()) refreshNodePorts(graph, sourceNode, false);
      }
      if (targetId) {
        const targetNode = graph.getCellById(targetId);
        if (targetNode && targetNode.isNode()) refreshNodePorts(graph, targetNode, false);
      }
    });
    graph.on("edge:connected", () => {
      connectingRef.current = false;
      graph.getNodes().forEach((node) => refreshNodePorts(graph, node, false));
    });
    graph.on("node:mouseup", () => {
      if (!connectingRef.current) return;
      connectingRef.current = false;
      graph.getNodes().forEach((node) => refreshNodePorts(graph, node, false));
    });
    graph.on("blank:mouseup", () => {
      connectingRef.current = false;
      graph.getNodes().forEach((node) => refreshNodePorts(graph, node, false));
    });

    return () => {
      graph.dispose();
      graphRef.current = null;
    };
  }, []);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    if (localMutationRef.current) {
      localMutationRef.current = false;
      return;
    }
    ensureWorkflowX6Nodes();
    syncingRef.current = true;
    graph.clearCells();
    value.nodes.forEach((node) => {
      graph.addNode(createGraphNodeFromSnapshotNode(node, employeeNameByIdRef.current));
    });
    value.edges.forEach((edge) => {
      graph.addEdge({
        id: edge.id,
        source: { cell: edge.source, port: edge.sourcePort },
        target: { cell: edge.target, port: edge.targetPort },
        attrs: { line: { stroke: "#5F95FF", strokeWidth: 2, targetMarker: "classic" } },
      });
    });
    graph.getNodes().forEach((node) => refreshNodePorts(graph, node, false));
    if (value.nodes.length > 0) {
      graph.centerContent();
    }
    syncingRef.current = false;
  }, [value]);

  function appendMaterialNode(material: MaterialItem, x?: number, y?: number) {
    if (!graphRef.current) return;
    const graph = graphRef.current;
    if (material.key === "start" || material.key === "end") {
      const targetKind = material.key as "start" | "end";
      const exists = graph
        .getNodes()
        .some((node) => ((node.getData() as Partial<CanvasNodeItem> | undefined)?.kind ?? "") === targetKind);
      if (exists) {
        message.warning(`${material.title}节点已存在`);
        return;
      }
      const existingFlowCount = graph
        .getNodes()
        .filter((node) => {
          const kind = (node.getData() as Partial<CanvasNodeItem> | undefined)?.kind;
          return kind === "start" || kind === "end";
        }).length;
      const positionX = x ?? 80 + existingFlowCount * 240;
      const positionY = y ?? 120;
      graph.addNode(
        createGraphNodeFromSnapshotNode(
          {
            id: `${targetKind}-${crypto.randomUUID().slice(0, 8)}`,
            kind: targetKind,
            title: material.title,
            x: positionX,
            y: positionY,
          },
          employeeNameByIdRef.current,
        ),
      );
      emitSnapshot();
      return;
    }
    const id = `node-${material.key}-${crypto.randomUUID().slice(0, 8)}`;
    const existing = graph.getNodes().filter((node) => (node.getData() as Partial<CanvasNodeItem>)?.kind === "material").length;
    const positionX = x ?? 220 + (existing % 2) * 240;
    const positionY = y ?? 60 + Math.floor(existing / 2) * 120;
    graph.addNode(
      createGraphNodeFromSnapshotNode({
        id,
        kind: "material",
        title: material.key === "employee" ? "开发阶段" : material.title,
        materialKey: material.key,
        theme: material.theme,
        x: positionX,
        y: positionY,
      }, employeeNameByIdRef.current),
    );
    emitSnapshot();
  }

  function handleCanvasDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const materialKey = event.dataTransfer.getData("application/x-wise-material") || draggingMaterialKey;
    setDraggingMaterialKey(null);
    if (!materialKey || !MATERIALS[materialKey]) return;
    const container = graphContainerRef.current;
    const graph = graphRef.current;
    if (!container || !graph) return;
    const rect = container.getBoundingClientRect();
    const dropLocal = graph.clientToLocal(event.clientX, event.clientY);
    const centerLocal = graph.clientToLocal(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const zoom = graph.zoom() || 1;
    const localViewportWidth = rect.width / zoom;
    const localViewportHeight = rect.height / zoom;
    const padding = 12;
    const nodeWidth = materialKey === "start" || materialKey === "end" ? FLOW_NODE_WIDTH : MATERIAL_NODE_WIDTH;
    const nodeHeight = materialKey === "start" || materialKey === "end" ? FLOW_NODE_HEIGHT : MATERIAL_NODE_HEIGHT;
    const minX = centerLocal.x - localViewportWidth / 2 + padding;
    const maxX = centerLocal.x + localViewportWidth / 2 - nodeWidth - padding;
    const minY = centerLocal.y - localViewportHeight / 2 + padding;
    const maxY = centerLocal.y + localViewportHeight / 2 - nodeHeight - padding;
    const desiredX = dropLocal.x - nodeWidth / 2;
    const desiredY = dropLocal.y - nodeHeight / 2;
    const clampedX = Math.min(Math.max(desiredX, minX), Math.max(minX, maxX));
    const clampedY = Math.min(Math.max(desiredY, minY), Math.max(minY, maxY));
    appendMaterialNode(MATERIALS[materialKey], clampedX, clampedY);
  }

  function zoomIn() {
    const graph = graphRef.current;
    if (!graph) return;
    graph.zoom(0.1, { minScale: 0.5, maxScale: 2.5 });
    setZoomPercent(Math.round(graph.zoom() * 100));
  }

  function zoomOut() {
    const graph = graphRef.current;
    if (!graph) return;
    graph.zoom(-0.1, { minScale: 0.5, maxScale: 2.5 });
    setZoomPercent(Math.round(graph.zoom() * 100));
  }

  function zoomToFit() {
    const graph = graphRef.current;
    if (!graph) return;
    graph.zoomToFit({ padding: 24, maxScale: 2 });
    setZoomPercent(Math.round(graph.zoom() * 100));
  }

  return (
    <>
      <div className="app-workflow-x6" ref={canvasWrapperRef}>
        <div className="app-workflow-x6__materials">
        <Typography.Text strong className="app-workflow-x6__materials-title">
          物料
        </Typography.Text>
        <div className="app-workflow-x6__materials-list">
          {MATERIAL_KEYS.map((key) => {
            const item = MATERIALS[key];
            return (
              <button
                key={item.key}
                type="button"
                draggable
                className="app-workflow-x6__material-item"
                onDragStart={(event) => {
                  setDraggingMaterialKey(item.key);
                  event.dataTransfer.setData("application/x-wise-material", item.key);
                  event.dataTransfer.effectAllowed = "copy";
                }}
                onDragEnd={() => setDraggingMaterialKey(null)}
                onClick={() => appendMaterialNode(item)}
              >
                <span className={`app-workflow-x6__material-icon app-workflow-x6__material-icon--${item.theme}`}>{item.iconText}</span>
                <span className="app-workflow-x6__material-body">
                  <span className="app-workflow-x6__material-title">{item.title}</span>
                  <span className="app-workflow-x6__material-desc">{item.desc}</span>
                </span>
              </button>
            );
          })}
        </div>
        </div>
        <div
          className={`app-workflow-x6__canvas${draggingMaterialKey ? " app-workflow-x6__canvas--dragging" : ""}`}
          ref={graphContainerRef}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }}
          onDrop={handleCanvasDrop}
        >
          <div className="app-workflow-x6__zoom-controls">
            <Button size="small" onClick={zoomOut}>
              -
            </Button>
            <Typography.Text className="app-workflow-x6__zoom-text">{zoomPercent}%</Typography.Text>
            <Button size="small" onClick={zoomIn}>
              +
            </Button>
            <Button size="small" onClick={zoomToFit}>
              适配
            </Button>
          </div>
        </div>
      </div>
      <Modal
        title="编辑阶段节点"
        open={Boolean(editingNode)}
        className="app-workflow-node-edit-modal"
        onCancel={() => {
          setEditingNode(null);
          setStageTaskBasisSelectOptions([]);
          setOptimizingField(null);
        }}
        onOk={() => {
          void (async () => {
            if (!editingNode || !graphRef.current) return;
            const values = await editForm.validateFields();
            const graph = graphRef.current;
            const target = graph.getCellById(editingNode.id);
            if (!target || !target.isNode()) {
              setEditingNode(null);
              setStageTaskBasisSelectOptions([]);
              return;
            }
            const node = target as X6Node;
            const currentData = (node.getData() ?? {}) as Partial<CanvasNodeItem>;
            const stageSuccessCriteria = normalizeWorkflowStageOutcomeCriteria(values.stageSuccessCriteria);
            const basisRefsRaw = values.stageTaskBasisRefs;
            const basisRefs = Array.isArray(basisRefsRaw)
              ? [
                  ...new Set(
                    basisRefsRaw
                      .filter((r): r is string => typeof r === "string")
                      .map((r) => r.trim())
                      .filter(Boolean),
                  ),
                ]
              : [];
            if (basisRefs.length > 0) {
              const validRefs = new Set(
                buildMergedStageTaskBasisSelectOptions(value, graphRef.current).map((o) => o.value),
              );
              for (const r of basisRefs) {
                if (!validRefs.has(r)) {
                  message.error("阶段任务依据中有成果已不存在，请重新选择或清空。");
                  return;
                }
              }
            }
            const nextData: Partial<CanvasNodeItem> = {
              ...currentData,
              title: values.title.trim(),
              stageTask: values.stageTask.trim(),
              employeeId: values.employeeId,
              acceptanceEnabled: values.acceptanceEnabled,
              acceptanceCriteria: values.acceptanceEnabled ? values.acceptanceCriteria.trim() : "",
            };
            if (basisRefs.length > 0) {
              nextData.stageTaskBasisRefs = basisRefs;
              delete nextData.stageTaskBasisRef;
            } else {
              delete nextData.stageTaskBasisRefs;
              delete nextData.stageTaskBasisRef;
            }
            delete (nextData as Record<string, unknown>).stageTaskBasisKind;
            if (stageSuccessCriteria.length > 0) {
              nextData.stageSuccessCriteria = stageSuccessCriteria;
            } else {
              delete nextData.stageSuccessCriteria;
            }
            node.setData(nextData);
            applyNodeVisual(node, nextData);
            setEditingNode(null);
            setStageTaskBasisSelectOptions([]);
            emitSnapshot();
          })();
        }}
        width={520}
        destroyOnHidden
      >
        <Form
          className="app-workflow-node-edit-form"
          form={editForm}
          layout="vertical"
          initialValues={{
            title: "",
            stageTask: "",
            stageTaskBasisRefs: undefined,
            stageSuccessCriteria: [],
            acceptanceEnabled: false,
            acceptanceCriteria: "",
          }}
        >
          <Form.Item label="阶段名称" name="title" rules={[{ required: true, message: "请输入阶段名称" }]}>
            <Input size="small" placeholder="例如：代码评审" />
          </Form.Item>
          <div className="app-workflow-node-edit-form__field-header">
            <span className="app-workflow-node-edit-form__field-title app-workflow-node-edit-form__field-title--with-hint">
              阶段任务依据（可选）
              <Tooltip
                placement="topLeft"
                overlayInnerStyle={{ maxWidth: 400 }}
                title="从当前流程图中各阶段已配置的「阶段成果」中选择一项或多项；保存后随团队派发写入 Claude Code 会话，置于「阶段任务」正文之前（多项之间以分隔线隔开）。每条派发为「【阶段任务依据】成果「名称」」并附上该成果标准原文。"
              >
                <QuestionCircleOutlined
                  className="app-workflow-node-edit-form__field-hint-icon"
                  aria-label="阶段任务依据说明"
                />
              </Tooltip>
            </span>
          </div>
          <Form.Item name="stageTaskBasisRefs">
            <Select
              mode="multiple"
              size="small"
              allowClear
              showSearch
              optionFilterProp="label"
              maxTagCount="responsive"
              placeholder={
                stageTaskBasisSelectOptions.length === 0
                  ? "请先在部分阶段配置「阶段成果」"
                  : "选择团队内已有成果（可多选）…"
              }
              options={stageTaskBasisSelectOptions}
              disabled={stageTaskBasisSelectOptions.length === 0}
            />
          </Form.Item>
          <div className="app-workflow-node-edit-form__field-header">
            <span className="app-workflow-node-edit-form__field-title">阶段任务</span>
            <span className="app-workflow-node-edit-form__label-actions">
              <Select
                size="small"
                value={optimizeToneByField.stageTask}
                options={OPTIMIZE_TONE_OPTIONS.map((item) => ({ value: item.value, label: item.label }))}
                onChange={(value: OptimizeTone) =>
                  setOptimizeToneByField((prev) => ({ ...prev, stageTask: value }))}
                className="app-workflow-node-edit-form__optimize-tone"
              />
              <Button
                size="small"
                loading={optimizingField === "stageTask"}
                disabled={!repositoryPath}
                onClick={() => {
                  void handleAiOptimizeField("stageTask");
                }}
              >
                AI优化
              </Button>
            </span>
          </div>
          <Form.Item
            name="stageTask"
            rules={[
              {
                validator: async (_, value: unknown) => {
                  if (typeof value === "string" && value.trim()) return;
                  throw new Error("请输入阶段任务");
                },
              },
            ]}
          >
            <div className="app-workflow-node-edit-form__milkdown-block">
              <div className="app-workflow-node-edit-form__milkdown-editor">
                <Suspense fallback={null}>
                  <MilkdownEditor
                    floatingToolbar={false}
                    text={String(editForm.getFieldValue("stageTask") ?? "")}
                    onChange={(markdown) => editForm.setFieldValue("stageTask", markdown)}
                  />
                </Suspense>
              </div>
            </div>
          </Form.Item>
          <Form.Item label="执行员工" name="employeeId" rules={[{ required: true, message: "请选择执行员工" }]}>
            <Select size="small" allowClear showSearch options={employeeOptions} placeholder="请选择员工" />
          </Form.Item>
          <div className="app-workflow-node-edit-form__field-header">
            <span className="app-workflow-node-edit-form__field-title app-workflow-node-edit-form__field-title--with-hint">
              阶段成果（可选）
              <Tooltip
                placement="topLeft"
                overlayInnerStyle={{ maxWidth: 400 }}
                title="每条包含「名称」与「要求」：名称简要标识该成果项；要求用 Markdown 编写。若有配置，会与阶段任务一并作为强约束发往该阶段的 Claude Code 会话；模型处理完任务后须在回复末尾输出约定的 JSON 阶段成果报告（详见派发全文中的格式说明）。"
              >
                <QuestionCircleOutlined
                  className="app-workflow-node-edit-form__field-hint-icon"
                  aria-label="阶段成果说明"
                />
              </Tooltip>
            </span>
          </div>
          <Form.List name="stageSuccessCriteria">
            {(fields, { add, remove }) => (
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                {fields.map((field) => (
                  <div key={field.key} className="app-workflow-node-edit-form__milkdown-block">
                    <div className="app-workflow-node-edit-form__field-header">
                      <span className="app-workflow-node-edit-form__field-title">成果 {field.name + 1}</span>
                      <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)}>
                        删除
                      </Button>
                    </div>
                    <Form.Item
                      className="app-workflow-node-edit-form__outcome-name"
                      name={[field.name, "name"]}
                      rules={[{ max: 120, message: "名称不超过 120 字" }]}
                    >
                      <Input size="small" placeholder="名称，例如：接口契约确认" allowClear />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, "requirement"]}
                      rules={[{ required: true, message: "请用 Markdown 编写该成果的要求" }]}
                    >
                      <div className="app-workflow-node-edit-form__milkdown-editor">
                        <Suspense fallback={null}>
                          <MilkdownEditor
                            key={field.key}
                            floatingToolbar={false}
                            text={String(
                              editForm.getFieldValue(["stageSuccessCriteria", field.name, "requirement"]) ?? "",
                            )}
                            onChange={(markdown) =>
                              editForm.setFieldValue(["stageSuccessCriteria", field.name, "requirement"], markdown)
                            }
                          />
                        </Suspense>
                      </div>
                    </Form.Item>
                  </div>
                ))}
                <Button
                  type="dashed"
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() => add({ name: "", requirement: "" })}
                  block
                >
                  添加阶段成果标准
                </Button>
              </Space>
            )}
          </Form.List>
          <div className="app-workflow-node-edit-form__acceptance-toggle">
            <div className="app-workflow-node-edit-form__field-header">
              <span className="app-workflow-node-edit-form__field-title">上阶段成果验收评判（可选）</span>
              <span className="app-workflow-node-edit-form__label-actions">
                <Form.Item name="acceptanceEnabled" valuePropName="checked" noStyle>
                  <Switch size="small" checkedChildren="开启" unCheckedChildren="关闭" />
                </Form.Item>
              </span>
            </div>
          </div>
          <Form.Item shouldUpdate={(prev, next) => prev.acceptanceEnabled !== next.acceptanceEnabled} noStyle>
            {({ getFieldValue }) =>
              getFieldValue("acceptanceEnabled") ? (
                <>
                  <div className="app-workflow-node-edit-form__field-header">
                    <span className="app-workflow-node-edit-form__field-title">评判标准</span>
                    <span className="app-workflow-node-edit-form__label-actions">
                      <Select
                        size="small"
                        value={optimizeToneByField.acceptanceCriteria}
                        options={OPTIMIZE_TONE_OPTIONS.map((item) => ({ value: item.value, label: item.label }))}
                        onChange={(value: OptimizeTone) =>
                          setOptimizeToneByField((prev) => ({ ...prev, acceptanceCriteria: value }))}
                        className="app-workflow-node-edit-form__optimize-tone"
                      />
                      <Button
                        size="small"
                        loading={optimizingField === "acceptanceCriteria"}
                        disabled={!repositoryPath}
                        onClick={() => {
                          void handleAiOptimizeField("acceptanceCriteria");
                        }}
                      >
                        AI优化
                      </Button>
                    </span>
                  </div>
                  <Form.Item
                    name="acceptanceCriteria"
                    rules={[{ required: true, message: "请输入评判标准" }]}
                  >
                    <div className="app-workflow-node-edit-form__milkdown-block">
                      <div className="app-workflow-node-edit-form__milkdown-editor">
                        <Suspense fallback={null}>
                          <MilkdownEditor
                            floatingToolbar={false}
                            text={String(editForm.getFieldValue("acceptanceCriteria") ?? "")}
                            onChange={(markdown) => editForm.setFieldValue("acceptanceCriteria", markdown)}
                          />
                        </Suspense>
                      </div>
                    </div>
                  </Form.Item>
                </>
              ) : null
            }
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

export function WorkflowConfigModal({
  open,
  loading,
  employees,
  templates,
  projects,
  workflowProjectIds = {},
  onClose,
  onSaveTemplate,
  onLoadGraphItem,
  onSaveGraph,
  onValidateGraph,
  onDeleteTemplate,
  repositoryPath,
  selectableEmployeeIds = [],
}: Props) {
  const [form] = Form.useForm();
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [editingProjectIds, setEditingProjectIds] = useState<string[]>([]);
  const [canvasSnapshot, setCanvasSnapshot] = useState<CanvasSnapshot>(createDefaultCanvasSnapshot());
  const editingLoadSeqRef = useRef(0);
  const [validationErrors, setValidationErrors] = useState<WorkflowGraphValidationResult["errors"]>([]);
  const [graphStatusByWorkflowId, setGraphStatusByWorkflowId] = useState<Record<string, string>>({});
  const [teamKeyword, setTeamKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<GraphStatus | "all">("all");

  const editingTemplate = useMemo(
    () => templates.find((item) => item.id === editingTemplateId) ?? null,
    [templates, editingTemplateId],
  );
  const groupedValidationErrors = useMemo(() => {
    const grouped = new Map<string, WorkflowGraphValidationError[]>();
    for (const error of validationErrors) {
      const group = getValidationGroupTitle(error.code);
      const current = grouped.get(group) ?? [];
      current.push(error);
      grouped.set(group, current);
    }
    return Array.from(grouped.entries());
  }, [validationErrors]);

  const statusFilterOptions = useMemo(
    () => [
      { value: "all", label: "全部" },
      { value: "published", label: "已发布" },
      { value: "draft", label: "草稿" },
      { value: "unknown", label: "未知" },
      { value: "none", label: "未生成" },
    ],
    [],
  );
  const filteredTemplates = useMemo(() => {
    const keyword = teamKeyword.trim().toLowerCase();
    return templates.filter((item) => {
      const nameMatch = !keyword || item.name.toLowerCase().includes(keyword);
      const status = (graphStatusByWorkflowId[item.id] ?? "none") as GraphStatus;
      const statusMatch = statusFilter === "all" || status === statusFilter;
      return nameMatch && statusMatch;
    });
  }, [graphStatusByWorkflowId, statusFilter, teamKeyword, templates]);

  useEffect(() => {
    if (!open || templates.length === 0) return;
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        templates.map(async (template) => {
          try {
            const item = await onLoadGraphItem(template.id);
            return [template.id, item?.status ?? "none"] as const;
          } catch {
            return [template.id, "unknown"] as const;
          }
        }),
      );
      if (!cancelled) {
        setGraphStatusByWorkflowId(Object.fromEntries(entries));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, templates, onLoadGraphItem]);

  useEffect(() => {
    if (!editingTemplateId) return;
    const stillExists = templates.some((item) => item.id === editingTemplateId);
    if (!stillExists) {
      resetEditor();
    }
  }, [templates, editingTemplateId]);

  function resetEditor() {
    setEditingTemplateId(null);
    setEditingProjectIds([]);
    setCanvasSnapshot(createDefaultCanvasSnapshot());
    setValidationErrors([]);
    form.setFieldsValue({ name: "", isDefault: false });
  }

  async function handleSave() {
    try {
      const values = form.getFieldsValue(["name", "isDefault"]) as { name?: string; isDefault?: boolean };
      const normalizedName = (values.name ?? "").trim();
      if (!normalizedName) {
        message.warning("请输入团队名称");
        return;
      }
      setValidationErrors([]);
      const fallbackEmployeeId = employees.find((employee) => employee.enabled)?.id;
      const graph = canvasSnapshotToWorkflowGraph(canvasSnapshot, fallbackEmployeeId);
      const stages = canvasSnapshotToStages(canvasSnapshot, employees);
      if (stages.length === 0) {
        const warning = "请至少添加一个员工阶段后再保存草稿。";
        message.error(warning);
        return;
      }
      const validation = await onValidateGraph(graph);
      if (!validation.ok) {
        setValidationErrors(validation.errors);
        return;
      }
      const savedTemplate = await onSaveTemplate({
        workflowId: editingTemplate?.id,
        name: normalizedName,
        isDefault: Boolean(values.isDefault),
        stages,
        projectIds: editingProjectIds,
      });
      try {
        await onSaveGraph({ workflowId: savedTemplate.id, graph, status: "draft" });
        setGraphStatusByWorkflowId((prev) => ({ ...prev, [savedTemplate.id]: "draft" }));
        const successText = `模板「${savedTemplate.name}」草稿已保存。`;
        message.success(successText);
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "未知错误";
        message.error(`模板已保存，但流程图保存失败：${messageText}`);
      }
      setEditingTemplateId(savedTemplate.id);
      form.setFieldsValue({ name: savedTemplate.name, isDefault: Boolean(values.isDefault) });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "未知错误";
      const warning = `保存草稿失败：${messageText}`;
      message.error(warning);
    }
  }

  async function handlePublish() {
    try {
      const values = form.getFieldsValue(["name", "isDefault"]) as { name?: string; isDefault?: boolean };
      const normalizedName = (values.name ?? "").trim();
      if (!normalizedName) {
        message.warning("请输入团队名称");
        return;
      }
      setValidationErrors([]);
      const fallbackEmployeeId = employees.find((employee) => employee.enabled)?.id;
      const graph = canvasSnapshotToWorkflowGraph(canvasSnapshot, fallbackEmployeeId);
      const stages = canvasSnapshotToStages(canvasSnapshot, employees);
      if (stages.length === 0) {
        const warning = "请至少添加一个员工阶段后再发布模板。";
        message.error(warning);
        return;
      }
      const validation = await onValidateGraph(graph);
      if (!validation.ok) {
        setValidationErrors(validation.errors);
        return;
      }
      const savedTemplate = await onSaveTemplate({
        workflowId: editingTemplate?.id,
        name: normalizedName,
        isDefault: Boolean(values.isDefault),
        stages,
        projectIds: editingProjectIds,
      });
      await onSaveGraph({ workflowId: savedTemplate.id, graph, status: "published" });
      setGraphStatusByWorkflowId((prev) => ({ ...prev, [savedTemplate.id]: "published" }));
      const successText = `模板「${savedTemplate.name}」已发布。`;
      message.success(successText);
      setEditingTemplateId(savedTemplate.id);
      form.setFieldsValue({ name: savedTemplate.name, isDefault: Boolean(values.isDefault) });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "未知错误";
      const warning = `发布失败：${messageText}`;
      message.error(warning);
    }
  }

  async function startEditingTemplate(row: WorkflowTemplateItem) {
    const currentSeq = editingLoadSeqRef.current + 1;
    editingLoadSeqRef.current = currentSeq;
    setEditingTemplateId(row.id);
    setValidationErrors([]);
    setCanvasSnapshot(createDefaultCanvasSnapshot());
    try {
      const graphItem = await onLoadGraphItem(row.id);
      if (editingLoadSeqRef.current !== currentSeq) return;
      setCanvasSnapshot(workflowGraphToCanvasSnapshot(graphItem?.graph));
    } catch {
      if (editingLoadSeqRef.current !== currentSeq) return;
      setCanvasSnapshot(createDefaultCanvasSnapshot());
    }
    if (editingLoadSeqRef.current !== currentSeq) return;
    form.setFieldsValue({
      name: row.name,
      isDefault: row.isDefault,
    });
    setEditingProjectIds(workflowProjectIds[row.id] ?? []);
  }

  async function handleDeleteTemplate(workflowId: string) {
    await onDeleteTemplate(workflowId);
    setGraphStatusByWorkflowId((prev) => {
      const next = { ...prev };
      delete next[workflowId];
      return next;
    });
    if (editingTemplateId === workflowId) {
      resetEditor();
    }
  }

  return (
    <Modal
      title="团队配置"
      open={open}
      onCancel={onClose}
      footer={null}
      width={1080}
      className="app-workflow-config-modal"
      destroyOnHidden
    >
      <div className="app-workflow-config-layout">
        <div className="app-workflow-config-sidebar">
          <Space direction="vertical" size={10} className="app-workflow-config-sidebar-space">
            <div className="app-workflow-config-sidebar-header">
              <Typography.Text strong>团队列表</Typography.Text>
              <Button
                size="small"
                type={!editingTemplateId ? "primary" : "default"}
                onClick={resetEditor}
                className="app-workflow-config-create-btn"
              >
                新建团队
              </Button>
            </div>
            <div className="app-workflow-config-filter-row">
              <Input.Search
                size="small"
                allowClear
                placeholder="搜索团队名"
                value={teamKeyword}
                onChange={(event) => setTeamKeyword(event.target.value)}
              />
              <Select
                size="small"
                value={statusFilter}
                options={statusFilterOptions}
                onChange={(value) => setStatusFilter(value)}
                className="app-workflow-config-filter-status"
              />
            </div>
            {templates.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无团队模板" />
            ) : filteredTemplates.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无匹配结果" />
            ) : (
              filteredTemplates.map((row) => {
                const status = graphStatusByWorkflowId[row.id] ?? "none";
                const active = editingTemplateId === row.id;
                return (
                  <Card
                    key={row.id}
                    size="small"
                    hoverable
                    onClick={() => startEditingTemplate(row)}
                    className={`app-workflow-config-team-card${active ? " app-workflow-config-team-card--active" : ""}`}
                  >
                    <Space direction="vertical" size={6} className="app-workflow-config-team-card-inner">
                      <div className="app-workflow-config-team-card-title-row">
                        <Typography.Text strong ellipsis className="app-workflow-config-team-card-title">
                          {row.name}
                        </Typography.Text>
                      </div>
                      <Typography.Text type="secondary" className="app-workflow-config-team-card-meta">
                        阶段数：{row.stages.length}
                      </Typography.Text>
                      <div className="app-workflow-config-team-card-actions">
                        <Space size={4} className="app-workflow-config-team-card-tags">
                          {row.isDefault ? <Tag color="gold">默认</Tag> : null}
                          {status === "published" ? <Tag color="success">已发布</Tag> : null}
                          {status === "draft" ? <Tag color="processing">草稿</Tag> : null}
                          {status === "unknown" ? <Tag color="warning">未知</Tag> : null}
                          {status === "none" ? <Tag>未生成</Tag> : null}
                        </Space>
                        <Popconfirm
                          title="确认删除该团队？"
                          onConfirm={() => handleDeleteTemplate(row.id)}
                          okText="删除"
                          cancelText="取消"
                        >
                          <Button
                            size="small"
                            danger
                            type="link"
                            className="app-workflow-config-team-card-delete"
                            onClick={(event) => {
                              event.stopPropagation();
                            }}
                          >
                            删除
                          </Button>
                        </Popconfirm>
                      </div>
                    </Space>
                  </Card>
                );
              })
            )}
          </Space>
        </div>

        <Space direction="vertical" size={12} className="app-workflow-config-editor">
          <Form
            form={form}
            layout="inline"
            initialValues={{ name: "", isDefault: false }}
            className="app-workflow-config-editor-form"
          >
            <div className="app-workflow-config-editor-form-left">
              <Form.Item name="name">
                <Input placeholder="团队名称" className="app-workflow-config-name-input" />
              </Form.Item>
              <Form.Item name="isDefault" valuePropName="checked">
                <Switch checkedChildren="默认" unCheckedChildren="非默认" />
              </Form.Item>
              {projects && projects.length > 0 && (
                <Form.Item label="所属项目">
                  <Select
                    mode="multiple"
                    allowClear
                    placeholder="所属项目"
                    maxTagCount="responsive"
                    value={editingProjectIds}
                    onChange={(value: string[]) => setEditingProjectIds(value)}
                    options={projects.map((p) => ({
                      value: p.id,
                      label: p.name,
                    }))}
                  />
                </Form.Item>
              )}
            </div>
            <div className="app-workflow-config-editor-form-actions">
              <Form.Item>
                <Button size="small" type="primary" loading={loading} onClick={() => void handleSave()}>
                  {editingTemplate ? "保存草稿" : "创建草稿"}
                </Button>
              </Form.Item>
              <Form.Item>
                <Button size="small" loading={loading} onClick={() => void handlePublish()}>
                  发布模板
                </Button>
              </Form.Item>
              {editingTemplate && (
                <Form.Item>
                  <Button size="small" onClick={resetEditor}>
                    取消编辑
                  </Button>
                </Form.Item>
              )}
            </div>
          </Form>

          {validationErrors.length > 0 && (
            <Alert
              className="app-workflow-config-validation-alert"
              type="error"
              showIcon
              message="流程图校验未通过"
              description={
                <div>
                  {groupedValidationErrors.map(([groupTitle, groupItems]) => (
                    <div key={groupTitle} className="app-workflow-config-error-group">
                      <Typography.Text strong>{groupTitle}</Typography.Text>
                      {groupItems.map((item) => (
                        <div key={`${item.code}-${item.nodeId ?? ""}-${item.edgeId ?? ""}`}>
                          <Typography.Text>
                            [{item.code}] {item.message}
                          </Typography.Text>
                          <Typography.Text type="secondary" className="app-workflow-config-error-suggestion">
                            建议：{getValidationSuggestion(item.code)}
                          </Typography.Text>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              }
            />
          )}

          <div className="app-workflow-config-stage-panel">
            <Typography.Text type="secondary" className="app-workflow-config-stage-tip">
              流程编排（左侧物料，右侧画布）；节点拖拽可调整顺序，连线定义执行流。
            </Typography.Text>
            <WorkflowCanvasEditor
              key={editingTemplateId ?? "new-team-workflow"}
              value={canvasSnapshot}
              onChange={setCanvasSnapshot}
              employees={employees}
              selectableEmployeeIds={selectableEmployeeIds}
              repositoryPath={repositoryPath}
            />
          </div>

        </Space>
      </div>
    </Modal>
  );
}

import { Button, Form, Typography, message } from "antd";
import { Graph, type Edge as X6Edge, type Node as X6Node } from "@antv/x6";
import { useEffect, useMemo, useRef, useState } from "react";
import type { EmployeeItem } from "../../types";
import { normalizeWorkflowStageOutcomeCriteria } from "../../utils/workflowStageOutcomeCriteria";
import type { CanvasNodeItem, CanvasSnapshot, MaterialItem } from "../workflowGraph/workflowX6CanvasShared";
import {
  MATERIAL_KEYS,
  MATERIAL_NODE_HEIGHT,
  MATERIAL_NODE_WIDTH,
  MATERIALS,
  FLOW_NODE_HEIGHT,
  FLOW_NODE_WIDTH,
  createGraphNodeFromSnapshotNode,
  ensureWorkflowX6Nodes,
  getEmployeeNodeHeight,
  buildEmployeeNodeSummary,
  isPortConnected,
  refreshNodePorts,
  setPortColor,
  setPortVisible,
} from "../workflowGraph/workflowX6CanvasShared";
import { buildOptimizeTonePrompt, isOptimizeTone, WORKFLOW_NODE_OPTIMIZE_TONE_STORAGE_KEY, type OptimizeTone } from "./optimizeTone";
import { materializePrdSnapshot, readSnapshotFile } from "../../services/materializePrdSnapshot";
import { runPrdSplitClaude } from "../../services/claudeSplitExecutor";
import { WorkflowNodeEditModal, type WorkflowNodeEditFormValues } from "./WorkflowNodeEditModal";
import {
  buildMergedStageTaskBasisSelectOptions,
  canvasNodeItemFromX6Node,
  dirnameFromAbsolutePath,
  normalizeStageTaskBasisRefsForNode,
  snapshotFromWorkflowGraph,
  toErrorMessage,
} from "./workflowCanvasHelpers";

interface Props {
  value: CanvasSnapshot;
  onChange: (next: CanvasSnapshot) => void;
  employees: EmployeeItem[];
  selectableEmployeeIds: string[];
  repositoryPath?: string | null;
}

export function WorkflowCanvasEditor({ value, onChange, employees, selectableEmployeeIds, repositoryPath }: Props) {
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
  const [editForm] = Form.useForm<WorkflowNodeEditFormValues>();
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

  const employeeNameById = useMemo(() => Object.fromEntries(employees.map((item) => [item.id, item.name])), [employees]);
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
    const name = emp?.name ?? employeeNameById[selectedId] ?? `角色（${selectedId.slice(0, 8)}…）`;
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
    const prompt = buildOptimizeTonePrompt({
      field,
      current,
      title: String(editForm.getFieldValue("title") ?? "").trim(),
      tone: optimizeToneByField[field],
    });
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
    const payload = canvasNodeItemFromX6Node(node);
    const basisRefsNormalized = normalizeStageTaskBasisRefsForNode(payload);
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
    localMutationRef.current = true;
    onChange(snapshotFromWorkflowGraph(graphRef.current));
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
      snapshot.nodes.forEach((node) => graph.addNode(createGraphNodeFromSnapshotNode(node, employeeNameByIdRef.current)));
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

    const resizeGraph = () => {
      const el = graphContainerRef.current;
      if (!el) return;
      const width = el.clientWidth;
      const height = el.clientHeight;
      if (width > 0 && height > 0) {
        graph.resize(width, height);
      }
    };
    resizeGraph();
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resizeGraph) : null;
    resizeObserver?.observe(graphContainerRef.current);

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
                { tagName: "path", selector: "button", attrs: { d: "M -3 3 L -1 5 L 5 -1 L 3 -3 Z M -4 4 L -3 6 L -5 6 Z", fill: "none", stroke: "#1677ff", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", cursor: "pointer" } },
                { tagName: "path", selector: "icon", attrs: { d: "M -3 3 L -1 5 L 5 -1 L 3 -3 Z M -4 4 L -3 6 L -5 6 Z", fill: "#1677ff", stroke: "none", pointerEvents: "none" } },
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
      edge.addTools([{ name: "vertices" }, { name: "source-arrowhead" }, { name: "target-arrowhead" }, { name: "button-remove", args: { distance: -38 } }]);
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
      resizeObserver?.disconnect();
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
      const existingFlowCount = graph.getNodes().filter((node) => {
        const kind = (node.getData() as Partial<CanvasNodeItem> | undefined)?.kind;
        return kind === "start" || kind === "end";
      }).length;
      const positionX = x ?? 80 + existingFlowCount * 240;
      const positionY = y ?? 120;
      graph.addNode(
        createGraphNodeFromSnapshotNode(
          { id: `${targetKind}-${crypto.randomUUID().slice(0, 8)}`, kind: targetKind, title: material.title, x: positionX, y: positionY },
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
      createGraphNodeFromSnapshotNode(
        { id, kind: "material", title: material.key === "employee" ? "智能体阶段" : material.title, materialKey: material.key, theme: material.theme, x: positionX, y: positionY },
        employeeNameByIdRef.current,
      ),
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

  async function handleSubmitNodeEdit() {
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
      ? [...new Set(basisRefsRaw.filter((ref): ref is string => typeof ref === "string").map((ref) => ref.trim()).filter(Boolean))]
      : [];
    if (basisRefs.length > 0) {
      const validRefs = new Set(buildMergedStageTaskBasisSelectOptions(value, graphRef.current).map((option) => option.value));
      for (const ref of basisRefs) {
        if (!validRefs.has(ref)) {
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
  }

  function handleCloseNodeEdit() {
    setEditingNode(null);
    setStageTaskBasisSelectOptions([]);
    setOptimizingField(null);
  }

  return (
    <>
      <div className="app-workflow-x6" ref={canvasWrapperRef}>
        <div className="app-workflow-x6__materials">
          <Typography.Text strong className="app-workflow-x6__materials-title">物料</Typography.Text>
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
            <Button size="small" onClick={zoomOut}>-</Button>
            <Typography.Text className="app-workflow-x6__zoom-text">{zoomPercent}%</Typography.Text>
            <Button size="small" onClick={zoomIn}>+</Button>
            <Button size="small" onClick={zoomToFit}>适配</Button>
          </div>
        </div>
      </div>
      <WorkflowNodeEditModal
        editingNode={editingNode}
        form={editForm}
        stageTaskBasisSelectOptions={stageTaskBasisSelectOptions}
        employeeOptions={employeeOptions}
        optimizeToneByField={optimizeToneByField}
        optimizingField={optimizingField}
        canOptimize={Boolean(repositoryPath)}
        onCancel={handleCloseNodeEdit}
        onSubmit={() => void handleSubmitNodeEdit()}
        onOptimize={(field) => void handleAiOptimizeField(field)}
        onOptimizeToneChange={(field, tone) => setOptimizeToneByField((prev) => ({ ...prev, [field]: tone }))}
      />
    </>
  );
}

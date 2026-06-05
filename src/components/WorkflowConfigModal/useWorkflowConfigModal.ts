import { Form, message } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import type { WorkflowGraphValidationError } from "../../services/workflowGraphs";
import type { WorkflowTemplateItem } from "../../types";
import type { CanvasSnapshot } from "../workflowGraph/workflowX6CanvasShared";
import { createDefaultCanvasSnapshot } from "../workflowGraph/workflowX6CanvasShared";
import {
  canvasSnapshotToStages as canvasSnapshotToStagesImpl,
  canvasSnapshotToWorkflowGraph as canvasSnapshotToWorkflowGraphImpl,
  workflowGraphToCanvasSnapshot as workflowGraphToCanvasSnapshotImpl,
} from "./workflowGraphMapping";
import { getWorkflowValidationGroupTitle as getWorkflowValidationGroupTitleImpl } from "./workflowValidationCopy";
import type { GraphStatus, WorkflowConfigModalProps } from "./types";

export function useWorkflowConfigModal({
  open,
  employees,
  templates,
  workflowProjectIds = {},
  onSaveTemplate,
  onLoadGraphItem,
  onSaveGraph,
  onValidateGraph,
  onDeleteTemplate,
  initialWorkflowId = null,
}: WorkflowConfigModalProps) {
  const [form] = Form.useForm();
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [editingProjectIds, setEditingProjectIds] = useState<string[]>([]);
  const [canvasSnapshot, setCanvasSnapshot] = useState<CanvasSnapshot>(createDefaultCanvasSnapshot());
  const editingLoadSeqRef = useRef(0);
  const [validationErrors, setValidationErrors] = useState<WorkflowGraphValidationError[]>([]);
  const [graphStatusByWorkflowId, setGraphStatusByWorkflowId] = useState<Record<string, string>>({});
  const [teamKeyword, setTeamKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<GraphStatus | "all">("all");
  const [teamListCollapsed, setTeamListCollapsed] = useState(false);

  const editingTemplate = useMemo(
    () => templates.find((item) => item.id === editingTemplateId) ?? null,
    [templates, editingTemplateId],
  );

  const groupedValidationErrors = useMemo(() => {
    const grouped = new Map<string, WorkflowGraphValidationError[]>();
    for (const error of validationErrors) {
      const group = getWorkflowValidationGroupTitleImpl(error.code);
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
    if (open) return;
    setTeamListCollapsed(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const workflowId = initialWorkflowId?.trim() ?? "";
    if (!workflowId) return;
    if (editingTemplateId === workflowId) return;
    const template = templates.find((item) => item.id === workflowId);
    if (template) {
      void startEditingTemplate(template);
    }
  }, [open, initialWorkflowId, templates, editingTemplateId]);

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
      const graph = canvasSnapshotToWorkflowGraphImpl(canvasSnapshot, fallbackEmployeeId);
      const stages = canvasSnapshotToStagesImpl(canvasSnapshot, employees);
      if (stages.length === 0) {
        message.error("请至少添加一个员工阶段后再保存草稿。");
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
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "未知错误";
        message.error(`模板已保存，但流程图保存失败：${messageText}`);
      }
      setEditingTemplateId(savedTemplate.id);
      form.setFieldsValue({ name: savedTemplate.name, isDefault: Boolean(values.isDefault) });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "未知错误";
      message.error(`保存草稿失败：${messageText}`);
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
      const graph = canvasSnapshotToWorkflowGraphImpl(canvasSnapshot, fallbackEmployeeId);
      const stages = canvasSnapshotToStagesImpl(canvasSnapshot, employees);
      if (stages.length === 0) {
        message.error("请至少添加一个员工阶段后再发布模板。");
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
      setEditingTemplateId(savedTemplate.id);
      form.setFieldsValue({ name: savedTemplate.name, isDefault: Boolean(values.isDefault) });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "未知错误";
      message.error(`发布失败：${messageText}`);
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
      setCanvasSnapshot(workflowGraphToCanvasSnapshotImpl(graphItem?.graph));
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

  return {
    form,
    editingTemplateId,
    editingTemplate,
    editingProjectIds,
    setEditingProjectIds,
    canvasSnapshot,
    setCanvasSnapshot,
    validationErrors,
    groupedValidationErrors,
    graphStatusByWorkflowId,
    teamKeyword,
    setTeamKeyword,
    statusFilter,
    setStatusFilter,
    statusFilterOptions,
    filteredTemplates,
    teamListCollapsed,
    setTeamListCollapsed,
    resetEditor,
    handleSave,
    handlePublish,
    startEditingTemplate,
    handleDeleteTemplate,
  };
}

export type WorkflowConfigModalController = ReturnType<typeof useWorkflowConfigModal>;

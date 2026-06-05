import { App as AntdApp } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { EmployeeItem, WorkflowTemplateItem } from "../../types";
import {
  addProjectPrdEmployee,
  addProjectPrdWorkflow,
  listProjectPrdEmployeeIds,
  listProjectPrdWorkflowIds,
  removeProjectPrdEmployee,
  removeProjectPrdWorkflow,
} from "../../services/projectPrdScope";
import { isOmcMonitorEmployeeRecord } from "../../utils/omcMonitorEmployeeSession";

export type ProjectPrdLinkKind = "employee" | "workflow";

export interface ProjectPrdScopeLinkOption {
  value: string;
  label: string;
}

interface UseProjectPrdScopeLinksInput {
  activeProjectId: string | null;
  employees: EmployeeItem[];
  workflowTemplates: WorkflowTemplateItem[];
}

export function useProjectPrdScopeLinks({
  activeProjectId,
  employees,
  workflowTemplates,
}: UseProjectPrdScopeLinksInput) {
  const { message } = AntdApp.useApp();
  const [projectPrdEmployeeIds, setProjectPrdEmployeeIds] = useState<string[]>([]);
  const [projectPrdWorkflowIds, setProjectPrdWorkflowIds] = useState<string[]>([]);
  const [projectPrdScopeLoading, setProjectPrdScopeLoading] = useState(false);
  const [projectPrdLinkModalOpen, setProjectPrdLinkModalOpen] = useState(false);
  const [projectPrdLinkKind, setProjectPrdLinkKind] = useState<ProjectPrdLinkKind>("employee");
  const [projectPrdLinkSelection, setProjectPrdLinkSelection] = useState<string | null>(null);
  const [projectPrdLinkSaving, setProjectPrdLinkSaving] = useState(false);

  const reloadProjectPrdScope = useCallback(async () => {
    const projectId = activeProjectId?.trim() ?? "";
    if (!projectId) {
      setProjectPrdEmployeeIds([]);
      setProjectPrdWorkflowIds([]);
      setProjectPrdLinkModalOpen(false);
      return;
    }
    setProjectPrdScopeLoading(true);
    try {
      const [employeeIds, workflowIds] = await Promise.all([
        listProjectPrdEmployeeIds(projectId),
        listProjectPrdWorkflowIds(projectId),
      ]);
      setProjectPrdEmployeeIds(employeeIds);
      setProjectPrdWorkflowIds(workflowIds);
    } catch (err) {
      console.error(err);
      message.error("加载项目成员失败");
    } finally {
      setProjectPrdScopeLoading(false);
    }
  }, [activeProjectId, message]);

  useEffect(() => {
    void reloadProjectPrdScope();
  }, [reloadProjectPrdScope]);

  const removeProjectEmployeeFromPrd = useCallback(
    async (employeeId: string) => {
      const projectId = activeProjectId?.trim() ?? "";
      if (!projectId) return;
      try {
        await removeProjectPrdEmployee(projectId, employeeId);
        await reloadProjectPrdScope();
      } catch (err) {
        message.error(err instanceof Error ? err.message : String(err));
      }
    },
    [activeProjectId, message, reloadProjectPrdScope],
  );

  const removeProjectWorkflowFromPrd = useCallback(
    async (workflowId: string) => {
      const projectId = activeProjectId?.trim() ?? "";
      if (!projectId) return;
      try {
        await removeProjectPrdWorkflow(projectId, workflowId);
        await reloadProjectPrdScope();
      } catch (err) {
        message.error(err instanceof Error ? err.message : String(err));
      }
    },
    [activeProjectId, message, reloadProjectPrdScope],
  );

  const handleConfirmProjectPrdLinkExisting = useCallback(async () => {
    const projectId = activeProjectId?.trim() ?? "";
    const selection = projectPrdLinkSelection?.trim() ?? "";
    if (!projectId || !selection) {
      message.warning(projectPrdLinkKind === "employee" ? "请选择员工" : "请选择团队");
      return;
    }
    setProjectPrdLinkSaving(true);
    try {
      if (projectPrdLinkKind === "employee") {
        await addProjectPrdEmployee(projectId, selection);
      } else {
        await addProjectPrdWorkflow(projectId, selection);
      }
      setProjectPrdLinkModalOpen(false);
      setProjectPrdLinkSelection(null);
      await reloadProjectPrdScope();
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setProjectPrdLinkSaving(false);
    }
  }, [
    activeProjectId,
    message,
    projectPrdLinkKind,
    projectPrdLinkSelection,
    reloadProjectPrdScope,
  ]);

  const closeProjectPrdLinkModal = useCallback(() => {
    if (projectPrdLinkSaving) return;
    setProjectPrdLinkModalOpen(false);
    setProjectPrdLinkSelection(null);
  }, [projectPrdLinkSaving]);

  const openProjectPrdLinkEmployeeModal = useCallback(() => {
    setProjectPrdLinkKind("employee");
    setProjectPrdLinkSelection(null);
    setProjectPrdLinkModalOpen(true);
  }, []);

  const openProjectPrdLinkWorkflowModal = useCallback(() => {
    setProjectPrdLinkKind("workflow");
    setProjectPrdLinkSelection(null);
    setProjectPrdLinkModalOpen(true);
  }, []);

  const projectPrdAddEmployeeOptions = useMemo<ProjectPrdScopeLinkOption[]>(
    () =>
      employees
        .filter((employee) => employee.enabled && !isOmcMonitorEmployeeRecord(employee))
        .filter((employee) => !projectPrdEmployeeIds.includes(employee.id))
        .map((employee) => ({
          value: employee.id,
          label: `${employee.name}（${employee.agentType}）`,
        })),
    [employees, projectPrdEmployeeIds],
  );

  const projectPrdAddWorkflowOptions = useMemo<ProjectPrdScopeLinkOption[]>(
    () =>
      workflowTemplates
        .filter((workflow) => !projectPrdWorkflowIds.includes(workflow.id))
        .map((workflow) => ({ value: workflow.id, label: workflow.name })),
    [workflowTemplates, projectPrdWorkflowIds],
  );

  const linkOptions =
    projectPrdLinkKind === "employee" ? projectPrdAddEmployeeOptions : projectPrdAddWorkflowOptions;

  return {
    closeProjectPrdLinkModal,
    handleConfirmProjectPrdLinkExisting,
    linkOptions,
    openProjectPrdLinkEmployeeModal,
    openProjectPrdLinkWorkflowModal,
    projectPrdEmployeeIds,
    projectPrdLinkKind,
    projectPrdLinkModalOpen,
    projectPrdLinkSaving,
    projectPrdLinkSelection,
    projectPrdScopeLoading,
    projectPrdWorkflowIds,
    removeProjectEmployeeFromPrd,
    removeProjectWorkflowFromPrd,
    setProjectPrdLinkSelection,
  };
}

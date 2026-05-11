import {
  CloseOutlined,
  DeleteOutlined,
  DownOutlined,
  PlusOutlined,
  PushpinOutlined,
  PlayCircleOutlined,
  QuestionCircleOutlined,
  SaveOutlined,
  SettingOutlined,
  TeamOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  App as AntdApp,
  Button,
  Card,
  Col,
  Divider,
  Dropdown,
  Input,
  Layout,
  Modal,
  Popover,
  Row,
  Select,
  Segmented,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { MenuProps } from "antd";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  EmployeeItem,
  PrdDocument,
  ProjectItem,
  Repository,
  SplitResult,
  TaskAnchorPosition,
  TaskApiSpec,
  TaskExecutionStatus,
  TaskItem,
  TaskRole,
  TaskSize,
  TaskSplitContext,
  WorkflowTemplateItem,
} from "../../types";
import {
  defaultTaskRoleForRepositoryType,
  repositoryFolderBasename,
  taskRoleChineseLabel,
  taskRoleTagModifierClass,
} from "../../utils/repositoryType";
import { usePrdInput } from "../../hooks/usePrdInput";
import type { MilkdownEditorHandle, MilkdownTaskAnchor } from "../MilkdownViewer";
import { fetchPrdFromUrl } from "../../services/prdUrlFetcher";
import { normalizePrdDocument, prdDocumentFromMarkdownFragment } from "../../services/prdNormalizer";
import {
  migrateStoredSplitResult,
  refreshSplitResultDerivedFields,
  removeTaskFromSplitResult,
  syncTaskAnchorTextsFromRequirements,
} from "../../services/taskSplitter";
import { collectSplitContextGapLines, computeTaskUnmetPoints } from "../../services/taskUnmetPoints";
import { loadPrdDraft, savePrdDraft, type PrdRequirementHistoryItem } from "../../services/prdDraftStore";
import {
  loadPrdTaskSplitResult,
  savePrdTaskSplitResult,
  setPrdTaskSplitRequirementScope,
} from "../../services/prdTaskSplitStore";
import { allSplitResultTaskItems } from "../../services/splitResultModel";
import {
  appendWiseRelativeFile,
  materializePrdSnapshot,
  readProjectRelativeFile,
  readSnapshotFile,
} from "../../services/materializePrdSnapshot";
import { buildSplitRequestPayload, logSplitInputPrepareBundle } from "../../services/buildSplitRequestPayload";
import { listPrdRequirementIndexEntries } from "../../services/prdRequirementIndex";
import {
  extractSplitMappingFromClaudeOutput,
  mergeSplitMappingPayloadsIntoSplitResult,
  parseSplitMappingJson,
} from "../../services/splitMappingMerge";
import { parsePrdInput } from "../../services/prdSource";
import { savePrdPastedImage } from "../../services/savePrdPastedImage";
import { validateSplitResult } from "../../services/taskSplitValidator";
import {
  PROMPT_SLOT_PRD_TASK_SPLIT_PHASE1,
  PROMPT_SLOT_PRD_TASK_SPLIT_PHASE2,
  parsePromptStorageRaw,
} from "../../services/splitPromptBundle";
import {
  normalizeClaudeSplitOutputToSplitResult,
  validateClaudeSplitPayloadStrict,
} from "../../services/claudeSplitOutputNormalize";
import { prdDocumentToSplitMarkdown } from "../../services/prdDocumentMarkdown";
import { resolveEffectiveSplitPromptTemplate } from "../../services/resolveSplitPromptLayers";
import {
  buildSplitPhase1PromptMessage,
  buildSplitPhase2PromptMessage,
  renderSplitPromptTemplate,
} from "../../services/splitPromptTemplate";
import {
  buildRepoAwarePromptSection,
  buildSyntheticSplitResultForRepoPrompt,
} from "../../services/repoTaskSplitPrompt";
import {
  clearRepositorySplitPromptLayers,
  loadRepositorySplitPromptLayers,
  saveRepositorySplitPromptLayers,
} from "../../services/splitPromptLayersStore";
import { explainClaudeSplitExitCode, runPrdSplitClaude } from "../../services/claudeSplitExecutor";
import {
  API_METHOD_OPTIONS,
  TASK_AI_DEFAULT_PROMPT_BY_MODE,
  anchorLabelFromTaskId,
  buildApiSpecTemplate,
  buildExecutableTaskCopiesFromSplitSources,
  buildRequestSchemaByMethod,
  buildSelectionAnchorTextHash,
  buildSnapshotAbsoluteDisplayPath,
  clipRuntimeLogText,
  createRequirementHistoryId,
  defaultTaskConfirmFilterByTasks,
  dirnameFromAbsolutePath,
  formatClaudeRuntimeSessionInfo,
  includesLoosely,
  mergeSplitResultsByAppend,
  normalizeJsonText,
  parseClaudeRuntimeSessionInfo,
  parseTaskNumericOrdinal,
  pickMostRelevantRequirementId,
  remapAnchorRangeFromMarkdownToVisible,
  remapSplitResultAnchorOffsetsFromMarkdown,
  stripEmbeddedTaskAnchorsFromRequirementMarkdown,
  stripRequirementsIndexSection,
  stripSectionByHeading,
  toErrorMessage,
  type TaskAiMode,
  type TaskConfirmFilter,
} from "./helpers";
import { sameStringArray, sameTaskAnchorPositions } from "../../utils/anchorStability";
import { WORKFLOW_UI_EVENT_SPLIT_TODO_COUNT_UPDATED } from "../../constants/workflowUiEvents";
import {
  addProjectPrdEmployee,
  addProjectPrdWorkflow,
  listProjectPrdEmployeeIds,
  listProjectPrdWorkflowIds,
  removeProjectPrdEmployee,
  removeProjectPrdWorkflow,
} from "../../services/projectPrdScope";
import { isOmcMonitorEmployeeRecord } from "../../utils/omcMonitorEmployeeSession";
import { listRepositoryMainOwnerDisplayGaps, repositoryOwnerBasenamesInScopeRelaxed } from "../../utils/projectPrdScopeDisplay";
import { SplitRuntimeMessages } from "./SplitRuntimeMessages";
import { UnmetConditionsQuestionIcon } from "./UnmetConditionsQuestionIcon";
import { TaskAnchorPopoverBody } from "./TaskAnchorPopoverBody";
import { RequirementNameModal } from "./RequirementNameModal";
import { RuntimePromptEditModal } from "./RuntimePromptEditModal";
import { SplitPromptWizardModal } from "./SplitPromptWizardModal";
import { RequirementBoardHeader } from "./RequirementBoardHeader";
import { RequirementBoardActions } from "./RequirementBoardActions";
import type {
  RequirementEntry,
  RequirementNameModalMode,
  SplitApplyMode,
  SplitPromptDraftBySlot,
  SplitQualitySummary,
  SplitRetryPhase,
  SplitRuntimeLogItem,
  SplitRuntimeLogRole,
  SplitWizardStep,
  TaskRoleFilter,
} from "./types";
import "./index.css";

const MilkdownEditor = lazy(() => import("../MilkdownViewer").then((module) => ({ default: module.MilkdownEditor })));

interface Props {
  onClose: () => void;
  projects: ProjectItem[];
  repositories: Repository[];
  activeProjectId: string | null;
  activeRepositoryId: number | null;
  employees: EmployeeItem[];
  workflowTemplates: WorkflowTemplateItem[];
  /** 与侧栏仓库一致：打开全局「员工」配置（新建后自动关联当前项目）。 */
  onOpenEmployeeConfigForProject?: () => void;
  /** 与侧栏仓库一致：打开全局「团队」配置（保存模板后自动关联当前项目）。 */
  onOpenWorkflowConfigForProject?: () => void;
}

const TASK_LIST_BUTTON_SELECTOR = '[data-ui-anchor="session-task-list-btn"]';
const TASK_SPLIT_CLOSE_ANIMATION_MS = 420;

const FALLBACK_CLAUDE_SPLIT_SYSTEM_INSTRUCTION = [
  "硬性要求：",
  "- 输出必须从第一字节开始就是 JSON 对象，禁止 markdown 代码围栏、解释文字、前后缀。",
  "- 字段名与枚举必须严格遵循 OUTPUT_SCHEMA.json。",
  "- 若信息不足，必须在缺口字段中显式说明，不得猜测补全。",
].join("\n");

const FALLBACK_CLAUDE_SPLIT_OUTPUT_SCHEMA_JSON = JSON.stringify({
  version: 1,
  type: "object",
  required: ["version", "tasks"],
  properties: {
    version: { type: "integer" },
    tasks: { type: "array" },
  },
}, null, 2);

function scrollToTaskCard(taskId: string) {
  window.requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>(`[data-task-id="${taskId}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

export function PrdTaskSplitPanel({
  onClose,
  projects,
  repositories,
  activeProjectId,
  activeRepositoryId,
  employees,
  workflowTemplates,
  onOpenEmployeeConfigForProject,
  onOpenWorkflowConfigForProject,
}: Props) {
  const { message } = AntdApp.useApp();
  const [parsing, setParsing] = useState(false);
  const [activeResult, setActiveResult] = useState<SplitResult | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedAnchorTaskId, setSelectedAnchorTaskId] = useState<string | null>(null);
  const [contextMode, setContextMode] = useState<"project" | "repository">("repository");
  const [linkedProjectId, setLinkedProjectId] = useState<string | null>(activeProjectId);
  const [linkedRepositoryId, setLinkedRepositoryId] = useState<number | null>(activeRepositoryId);
  const [pendingTaskSizeById, setPendingTaskSizeById] = useState<Record<string, TaskSize>>({});
  const [pendingTaskContentById, setPendingTaskContentById] = useState<Record<string, string>>({});
  const [pendingTaskApiSpecById, setPendingTaskApiSpecById] = useState<Record<string, TaskApiSpec>>({});
  const [taskAiPopoverTaskId, setTaskAiPopoverTaskId] = useState<string | null>(null);
  const [taskAiPopoverMode, setTaskAiPopoverMode] = useState<TaskAiMode | null>(null);
  const [taskAnchorPopoverTaskId, setTaskAnchorPopoverTaskId] = useState<string | null>(null);
  const [taskAiModeById, setTaskAiModeById] = useState<Record<string, TaskAiMode>>({});
  const [taskAiInputById, setTaskAiInputById] = useState<Record<string, Partial<Record<TaskAiMode, string>>>>({});
  const [taskAiOptimizedContentById, setTaskAiOptimizedContentById] = useState<Record<string, string>>({});
  const [taskAiOptimizedReadyById, setTaskAiOptimizedReadyById] = useState<Record<string, boolean>>({});
  const [taskExecutableCheckResultById, setTaskExecutableCheckResultById] = useState<Record<string, string>>({});
  const [taskUnmetCollapsedById, setTaskUnmetCollapsedById] = useState<Record<string, boolean>>({});
  const [taskCheckCollapsedById, setTaskCheckCollapsedById] = useState<Record<string, boolean>>({});
  const [taskAiActionLoadingById, setTaskAiActionLoadingById] = useState<Record<string, TaskAiMode | null>>({});
  const [taskAiSavingTaskId, setTaskAiSavingTaskId] = useState<string | null>(null);
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null);
  const [confirmSavingTaskId, setConfirmSavingTaskId] = useState<string | null>(null);
  const [generatingExecutableTaskId, setGeneratingExecutableTaskId] = useState<string | null>(null);
  const [runtimePromptModalOpen, setRuntimePromptModalOpen] = useState(false);
  const [runtimePromptLoading, setRuntimePromptLoading] = useState(false);
  const [runtimePromptSaving, setRuntimePromptSaving] = useState(false);
  const [runtimePromptOptimizingSlot, setRuntimePromptOptimizingSlot] = useState<string | null>(null);
  const [runtimePromptSlot, setRuntimePromptSlot] = useState<
    typeof PROMPT_SLOT_PRD_TASK_SPLIT_PHASE1 | typeof PROMPT_SLOT_PRD_TASK_SPLIT_PHASE2
  >(PROMPT_SLOT_PRD_TASK_SPLIT_PHASE1);
  const [runtimePromptDraftBySlot, setRuntimePromptDraftBySlot] = useState<Record<string, string>>({
    [PROMPT_SLOT_PRD_TASK_SPLIT_PHASE1]: "",
    [PROMPT_SLOT_PRD_TASK_SPLIT_PHASE2]: "",
  });
  const [splitPromptAdjustModalOpen, setSplitPromptAdjustModalOpen] = useState(false);
  const [splitPromptAdjustLoading, setSplitPromptAdjustLoading] = useState(false);
  const [splitPromptAdjustSaving, setSplitPromptAdjustSaving] = useState(false);
  const [splitPromptAdjustStarting, setSplitPromptAdjustStarting] = useState(false);
  const [splitPromptOptimizingSlot, setSplitPromptOptimizingSlot] = useState<string | null>(null);
  const [splitPromptAdjustDraftBySlot, setSplitPromptAdjustDraftBySlot] = useState<SplitPromptDraftBySlot>({
    [PROMPT_SLOT_PRD_TASK_SPLIT_PHASE1]: "",
    [PROMPT_SLOT_PRD_TASK_SPLIT_PHASE2]: "",
  });
  const [splitWizardStep, setSplitWizardStep] = useState<SplitWizardStep>("prompts");
  const { inputValue, setInputValue, error: inputError, parse } = usePrdInput("");
  const [originalInputValue, setOriginalInputValue] = useState<string | null>(null);
  const [requirementDisplayName, setRequirementDisplayName] = useState<string | null>(null);
  const [requirementNameModalOpen, setRequirementNameModalOpen] = useState(false);
  const [requirementNameModalMode, setRequirementNameModalMode] = useState<RequirementNameModalMode>("save");
  const [requirementNameInput, setRequirementNameInput] = useState("");
  const [requirementNameSaving, setRequirementNameSaving] = useState(false);
  const [requirementHistory, setRequirementHistory] = useState<PrdRequirementHistoryItem[]>([]);
  const [activeRequirementId, setActiveRequirementId] = useState<string | null>(null);
  const [projectPrdEmployeeIds, setProjectPrdEmployeeIds] = useState<string[]>([]);
  const [projectPrdWorkflowIds, setProjectPrdWorkflowIds] = useState<string[]>([]);
  const [projectPrdScopeLoading, setProjectPrdScopeLoading] = useState(false);
  const [projectPrdLinkModalOpen, setProjectPrdLinkModalOpen] = useState(false);
  const [projectPrdLinkKind, setProjectPrdLinkKind] = useState<"employee" | "workflow">("employee");
  const [projectPrdLinkSelection, setProjectPrdLinkSelection] = useState<string | null>(null);
  const [projectPrdLinkSaving, setProjectPrdLinkSaving] = useState(false);
  const [splitError, setSplitError] = useState<string | null>(null);
  const [splitRuntimeVisible, setSplitRuntimeVisible] = useState(false);
  const [splitRuntimeLogs, setSplitRuntimeLogs] = useState<SplitRuntimeLogItem[]>([]);
  const [retryingPhase, setRetryingPhase] = useState<SplitRetryPhase | null>(null);
  const [splitQualitySummary, setSplitQualitySummary] = useState<SplitQualitySummary | null>(null);
  const [resolvedTaskAnchorIds, setResolvedTaskAnchorIds] = useState<string[]>([]);
  const [anchorResolveReported, setAnchorResolveReported] = useState(false);
  const [taskRoleFilter, setTaskRoleFilter] = useState<TaskRoleFilter>("all");
  const [taskConfirmFilter, setTaskConfirmFilter] = useState<TaskConfirmFilter>("unconfirmed");
  const [closingToTaskListMotion, setClosingToTaskListMotion] = useState<{
    dx: number;
    dy: number;
    scale: number;
    active: boolean;
  } | null>(null);
  const milkdownEditorRef = useRef<MilkdownEditorHandle | null>(null);
  /** 与 `focusTask` 同步，用于在切换任务时清除需求侧区间高亮（避免依赖闭包中的旧 `selectedTaskId`）。 */
  const selectedTaskIdRef = useRef<string | null>(null);
  const taskSplitHostRef = useRef<HTMLDivElement | null>(null);
  const fixedBannerRef = useRef<HTMLDivElement | null>(null);
  const splitRuntimeListRef = useRef<HTMLDivElement | null>(null);
  const splitRuntimeRef = useRef<HTMLDivElement | null>(null);
  const panelRootRef = useRef<HTMLElement | null>(null);
  const closeAnimationTimerRef = useRef<number | null>(null);
  const splitStageRetryHandlersRef = useRef<Partial<Record<SplitRetryPhase, (() => Promise<void>)>>>({});
  const requirementEditorShellRef = useRef<HTMLDivElement | null>(null);
  const urlAnchorAutoBackfilledRef = useRef(false);
  const anchorRangePersistTimerRef = useRef<number | null>(null);
  const latestAnchorRangePersistResultRef = useRef<SplitResult | null>(null);
  const requirementHistoryById = useMemo(
    () => new Map(requirementHistory.map((item) => [item.id, item])),
    [requirementHistory],
  );

  const reloadProjectPrdScope = useCallback(async () => {
    const pid = activeProjectId?.trim() ?? "";
    if (!pid) {
      setProjectPrdEmployeeIds([]);
      setProjectPrdWorkflowIds([]);
      setProjectPrdLinkModalOpen(false);
      return;
    }
    setProjectPrdScopeLoading(true);
    try {
      const [empIds, wfIds] = await Promise.all([listProjectPrdEmployeeIds(pid), listProjectPrdWorkflowIds(pid)]);
      setProjectPrdEmployeeIds(empIds);
      setProjectPrdWorkflowIds(wfIds);
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
      const pid = activeProjectId?.trim() ?? "";
      if (!pid) return;
      try {
        await removeProjectPrdEmployee(pid, employeeId);
        message.success("已移除");
        await reloadProjectPrdScope();
      } catch (err) {
        message.error(err instanceof Error ? err.message : String(err));
      }
    },
    [activeProjectId, message, reloadProjectPrdScope],
  );

  const removeProjectWorkflowFromPrd = useCallback(
    async (workflowId: string) => {
      const pid = activeProjectId?.trim() ?? "";
      if (!pid) return;
      try {
        await removeProjectPrdWorkflow(pid, workflowId);
        message.success("已移除");
        await reloadProjectPrdScope();
      } catch (err) {
        message.error(err instanceof Error ? err.message : String(err));
      }
    },
    [activeProjectId, message, reloadProjectPrdScope],
  );

  const handleConfirmProjectPrdLinkExisting = useCallback(async () => {
    const pid = activeProjectId?.trim() ?? "";
    const sel = projectPrdLinkSelection?.trim() ?? "";
    if (!pid || !sel) {
      message.warning(projectPrdLinkKind === "employee" ? "请选择员工" : "请选择团队");
      return;
    }
    setProjectPrdLinkSaving(true);
    try {
      if (projectPrdLinkKind === "employee") {
        await addProjectPrdEmployee(pid, sel);
      } else {
        await addProjectPrdWorkflow(pid, sel);
      }
      message.success("已关联");
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

  const projectPrdAddEmployeeOptions = useMemo(
    () =>
      employees
        .filter((e) => e.enabled && !isOmcMonitorEmployeeRecord(e))
        .filter((e) => !projectPrdEmployeeIds.includes(e.id))
        .map((e) => ({
          value: e.id,
          label: `${e.name}（${e.agentType}）`,
        })),
    [employees, projectPrdEmployeeIds],
  );

  const projectPrdAddWorkflowOptions = useMemo(
    () =>
      workflowTemplates.filter((w) => !projectPrdWorkflowIds.includes(w.id)).map((w) => ({ value: w.id, label: w.name })),
    [workflowTemplates, projectPrdWorkflowIds],
  );

  const projectTeamPopoverContent = useMemo(() => {
    if (!activeProjectId?.trim()) {
      return <Typography.Text type="secondary">未选择项目</Typography.Text>;
    }
    return (
      <div style={{ maxWidth: 280 }}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8, fontSize: 12 }}>
          仅含本面板为项目关联的团队模板（不按单仓库存储）。
        </Typography.Paragraph>
        {projectPrdWorkflowIds.length === 0 ? (
          <Typography.Text type="secondary">尚未配置团队</Typography.Text>
        ) : (
          <div style={{ maxHeight: 280, overflowY: "auto" }}>
            <Space direction="vertical" size={6} style={{ width: "100%" }}>
              {projectPrdWorkflowIds.map((id) => {
                const wf = workflowTemplates.find((w) => w.id === id);
                return (
                  <div key={id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Typography.Text ellipsis style={{ flex: 1, margin: 0 }}>
                      {wf?.name ?? id}
                    </Typography.Text>
                    <Button type="link" size="small" danger onClick={() => void removeProjectWorkflowFromPrd(id)}>
                      移除
                    </Button>
                  </div>
                );
              })}
            </Space>
          </div>
        )}
        <Divider style={{ margin: "10px 0 6px" }} />
        <Button type="link" size="small" style={{ padding: 0, height: "auto" }} onClick={openProjectPrdLinkWorkflowModal}>
          关联已有团队…
        </Button>
      </div>
    );
  }, [
    activeProjectId,
    openProjectPrdLinkWorkflowModal,
    projectPrdWorkflowIds,
    removeProjectWorkflowFromPrd,
    workflowTemplates,
  ]);

  useEffect(() => {
    return () => {
      if (closeAnimationTimerRef.current != null) {
        window.clearTimeout(closeAnimationTimerRef.current);
        closeAnimationTimerRef.current = null;
      }
    };
  }, []);

  const closePanelToTaskListButton = useCallback(() => {
    if (closeAnimationTimerRef.current != null || closingToTaskListMotion?.active) {
      return;
    }
    const panel = panelRootRef.current;
    const target = document.querySelector<HTMLElement>(TASK_LIST_BUTTON_SELECTOR);
    if (!panel || !target) {
      onClose();
      return;
    }
    const panelRect = panel.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    if (panelRect.width <= 0 || panelRect.height <= 0) {
      onClose();
      return;
    }
    const panelCenterX = panelRect.left + panelRect.width / 2;
    const panelCenterY = panelRect.top + panelRect.height / 2;
    const targetCenterX = targetRect.left + targetRect.width / 2;
    const targetCenterY = targetRect.top + targetRect.height / 2;
    const scaleByWidth = targetRect.width / panelRect.width;
    const scaleByHeight = targetRect.height / panelRect.height;
    const scale = Math.max(0.08, Math.min(0.2, Math.min(scaleByWidth, scaleByHeight)));
    const dx = targetCenterX - panelCenterX;
    const dy = targetCenterY - panelCenterY;
    setClosingToTaskListMotion({ dx, dy, scale, active: false });
    window.requestAnimationFrame(() => {
      setClosingToTaskListMotion((prev) => (prev ? { ...prev, active: true } : prev));
    });
    closeAnimationTimerRef.current = window.setTimeout(() => {
      closeAnimationTimerRef.current = null;
      setClosingToTaskListMotion(null);
      onClose();
    }, TASK_SPLIT_CLOSE_ANIMATION_MS);
  }, [closingToTaskListMotion?.active, onClose]);
  const activeRequirement = useMemo(
    () => (activeRequirementId ? requirementHistoryById.get(activeRequirementId) ?? null : null),
    [activeRequirementId, requirementHistoryById],
  );
  const sortedRequirementHistory = useMemo(
    () => [...requirementHistory].sort((a, b) => {
      const pinA = a.isPinned ? 1 : 0;
      const pinB = b.isPinned ? 1 : 0;
      if (pinA !== pinB) return pinB - pinA;
      return b.updatedAt - a.updatedAt;
    }),
    [requirementHistory],
  );
  const hasInput = useMemo(() => inputValue.trim().length > 0, [inputValue]);
  const isUrlInputMode = useMemo(() => {
    if (!inputValue.trim()) return false;
    try {
      return parsePrdInput(inputValue).sourceType === "url";
    } catch {
      return false;
    }
  }, [inputValue]);
  const repositoriesById = useMemo(
    () => new Map(repositories.map((repository) => [repository.id, repository])),
    [repositories],
  );
  const linkedProject = useMemo(
    () => projects.find((project) => project.id === linkedProjectId) ?? null,
    [projects, linkedProjectId],
  );
  const linkedRepository = useMemo(
    () => (linkedRepositoryId ? repositoriesById.get(linkedRepositoryId) ?? null : null),
    [linkedRepositoryId, repositoriesById],
  );
  /** 顶栏单行：当前项目 + 该项目下全部仓库（顺序与侧栏项目内仓库一致）。 */
  const projectForHeader = useMemo(
    () => linkedProject ?? (activeProjectId ? projects.find((p) => p.id === activeProjectId) ?? null : null),
    [linkedProject, activeProjectId, projects],
  );
  const headerProjectName = useMemo(() => projectForHeader?.name?.trim() || null, [projectForHeader]);
  /** 顶栏仓库标签：项目内顺序；无项目时仅当前关联仓库一条。 */
  const headerRepositoryTagItems = useMemo(() => {
    if (projectForHeader) {
      return projectForHeader.repositoryIds
        .map((id) => {
          const r = repositoriesById.get(id);
          if (!r) return null;
          const label = repositoryFolderBasename(r).trim();
          if (!label) return null;
          const hasMainOwner = Boolean(r.mainOwnerAgentName?.trim());
          return { key: String(id), label, repositoryId: id, hasMainOwner };
        })
        .filter((x): x is { key: string; label: string; repositoryId: number; hasMainOwner: boolean } => x != null);
    }
    if (linkedRepositoryId != null && linkedRepository) {
      const label = repositoryFolderBasename(linkedRepository).trim();
      if (label) {
        return [
          {
            key: String(linkedRepositoryId),
            label,
            repositoryId: linkedRepositoryId,
            hasMainOwner: Boolean(linkedRepository.mainOwnerAgentName?.trim()),
          },
        ];
      }
    }
    return [];
  }, [projectForHeader, linkedRepositoryId, linkedRepository, repositoriesById]);

  const projectHeaderRepositories = useMemo(() => {
    if (!projectForHeader) return [];
    return projectForHeader.repositoryIds
      .map((id) => repositoriesById.get(id))
      .filter((r): r is Repository => Boolean(r));
  }, [projectForHeader, repositoriesById]);

  const employeesForPrdHeaderScope = useMemo(
    () => employees.filter((e) => e.enabled && !isOmcMonitorEmployeeRecord(e)),
    [employees],
  );

  const projectMainOwnerUnmatchedGaps = useMemo(
    () => listRepositoryMainOwnerDisplayGaps(projectHeaderRepositories, employeesForPrdHeaderScope),
    [projectHeaderRepositories, employeesForPrdHeaderScope],
  );

  const projectEmployeeHeaderBadgeCount = useMemo(
    () => projectPrdEmployeeIds.length + projectMainOwnerUnmatchedGaps.length,
    [projectPrdEmployeeIds, projectMainOwnerUnmatchedGaps],
  );

  const renderRepositoryScopePopover = useCallback(
    (repositoryId: number) => {
      const repo = repositoriesById.get(repositoryId);
      const mainAgent = repo?.mainOwnerAgentName?.trim();
      const linkedToRepo = employeesForPrdHeaderScope.filter((e) => e.repositoryIds.includes(repositoryId));
      return (
        <div style={{ maxWidth: 300 }}>
          <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
            本仓库关联员工
          </Typography.Text>
          {linkedToRepo.length === 0 ? (
            <Typography.Text type="secondary">暂无（员工配置里未勾选本仓库）</Typography.Text>
          ) : (
            <Space direction="vertical" size={6} style={{ width: "100%" }}>
              {linkedToRepo.map((e) => {
                const isMainOwner = Boolean(mainAgent && e.agentType?.trim() === mainAgent);
                return (
                  <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <Typography.Text ellipsis style={{ margin: 0, flex: "1 1 auto", minWidth: 0 }}>
                      {e.name}（{e.agentType}）
                    </Typography.Text>
                    {isMainOwner ? (
                      <Tag color="blue" style={{ margin: 0 }}>
                        主 Owner
                      </Tag>
                    ) : null}
                  </div>
                );
              })}
            </Space>
          )}
          {mainAgent && !linkedToRepo.some((e) => e.agentType?.trim() === mainAgent) ? (
            <Typography.Text type="secondary" style={{ display: "block", marginTop: 10, fontSize: 12 }}>
              已配置主 Owner「{mainAgent}」，暂无关联本仓库且 agentType 与其一致的员工；请在员工配置中为该智能体勾选本仓库。
            </Typography.Text>
          ) : null}
          <Typography.Text type="secondary" style={{ display: "block", marginTop: 10, fontSize: 12 }}>
            团队模板为项目级关联，请查看顶栏「团队」。
          </Typography.Text>
        </div>
      );
    },
    [repositoriesById, employeesForPrdHeaderScope],
  );

  const projectEmployeeScopeTooltip = useMemo(
    () => (
      <div className="app-prd-project-employee-tooltip-inner">
        <Typography.Paragraph style={{ marginBottom: 8, fontSize: 12 }}>
          此处仅列出本面板为项目<strong>显式关联</strong>的员工；不在此展示仓库侧创建或主 Owner 对应的员工。若某仓已配置主 Owner
          但尚无任何启用员工「勾选该仓库且 agentType 与其一致」，会在本弹层下方列出仓库与智能体名称。
        </Typography.Paragraph>
        <Typography.Paragraph
          className="app-prd-project-employee-tooltip-inner-muted"
          style={{ marginBottom: 0, fontSize: 12 }}
        >
          下方列出的「仓库名 · 智能体」表示该仓已在仓库侧配置主 Owner，但尚无启用员工同时勾选该仓且智能体名称与之完全一致；可在侧栏进入单仓后打开员工配置进行关联。
        </Typography.Paragraph>
      </div>
    ),
    [],
  );

  const projectEmployeePopoverTitle = useMemo(
    () => (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span>项目员工</span>
        <Tooltip
          title={projectEmployeeScopeTooltip}
          placement="bottomLeft"
          styles={{ root: { maxWidth: 400 } }}
        >
          <QuestionCircleOutlined
            aria-label="项目员工说明"
            style={{ fontSize: 14, color: "var(--ant-color-icon)", cursor: "help" }}
            onClick={(e) => {
              e.stopPropagation();
            }}
          />
        </Tooltip>
      </span>
    ),
    [projectEmployeeScopeTooltip],
  );

  const projectEmployeePopoverContent = useMemo(() => {
    if (!activeProjectId?.trim()) {
      return <Typography.Text type="secondary">未选择项目</Typography.Text>;
    }
    const emptyRows = projectPrdEmployeeIds.length === 0 && projectMainOwnerUnmatchedGaps.length === 0;
    return (
      <div className="app-prd-project-employee-popover-inner" style={{ maxWidth: 300 }}>
        {emptyRows ? (
          <Typography.Text type="secondary">
            暂无：可「关联已有员工」将成员加入项目，或在仓库菜单中配置主 Owner。
          </Typography.Text>
        ) : (
          <>
            {projectPrdEmployeeIds.length > 0 ? (
              <div style={{ maxHeight: 180, overflowY: "auto" }}>
                <Space direction="vertical" size={4} style={{ width: "100%" }}>
                  {projectPrdEmployeeIds.map((id) => {
                    const emp =
                      employeesForPrdHeaderScope.find((e) => e.id === id) ?? employees.find((e) => e.id === id);
                    const projectRepoIds = projectForHeader?.repositoryIds ?? [];
                    const ownerBasenames =
                      emp && projectRepoIds.length > 0
                        ? repositoryOwnerBasenamesInScopeRelaxed(emp, projectRepoIds, repositories, employees)
                        : [];
                    const showOwnerBadge = ownerBasenames.length > 0;
                    return (
                      <div key={id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <Typography.Text
                          ellipsis
                          style={{
                            flex: 1,
                            margin: 0,
                            minWidth: 0,
                            color: "var(--ant-color-text)",
                          }}
                        >
                          {emp?.name ?? id}
                        </Typography.Text>
                        {showOwnerBadge ? (
                          <Tag color="blue" style={{ margin: 0 }}>
                            Owner
                          </Tag>
                        ) : null}
                        <Button type="link" size="small" danger onClick={() => void removeProjectEmployeeFromPrd(id)}>
                          移除
                        </Button>
                      </div>
                    );
                  })}
                </Space>
              </div>
            ) : null}
            {projectMainOwnerUnmatchedGaps.length > 0 ? (
              <div style={{ marginTop: projectPrdEmployeeIds.length > 0 ? 6 : 0 }}>
                <Space direction="vertical" size={4} style={{ width: "100%" }}>
                  {projectMainOwnerUnmatchedGaps.map((g) => (
                    <div
                      key={`owner-gap-${g.repositoryId}`}
                      style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
                    >
                      <Typography.Text
                        ellipsis
                        style={{
                          flex: 1,
                          margin: 0,
                          minWidth: 0,
                          fontSize: 12,
                          color: "var(--ant-color-text)",
                        }}
                      >
                        {g.repoLabel} · {g.agentName}
                      </Typography.Text>
                      <Tag color="purple" style={{ margin: 0 }}>
                        Owner
                      </Tag>
                    </div>
                  ))}
                </Space>
              </div>
            ) : null}
          </>
        )}
        <Divider style={{ margin: "6px 0 4px" }} />
        <Button type="link" size="small" style={{ padding: 0, height: "auto" }} onClick={openProjectPrdLinkEmployeeModal}>
          关联已有员工…
        </Button>
      </div>
    );
  }, [
    activeProjectId,
    employees,
    employeesForPrdHeaderScope,
    openProjectPrdLinkEmployeeModal,
    projectForHeader,
    projectMainOwnerUnmatchedGaps,
    projectPrdEmployeeIds,
    removeProjectEmployeeFromPrd,
    repositories,
  ]);

  const localSpecRepositoryPath = useMemo(() => {
    const byName = repositories.find(
      (repo) => repositoryFolderBasename(repo).trim().toLowerCase() === "wise",
    );
    if (byName?.path?.trim()) return byName.path;
    const byTail = repositories.find((repo) => /\/wise$/.test(repo.path.trim()));
    if (byTail?.path?.trim()) return byTail.path;
    return null;
  }, [repositories]);
  const requirementEntries = useMemo<RequirementEntry[]>(() => {
    if (!activeResult) return [];
    return listPrdRequirementIndexEntries(activeResult.source).map((e) => ({
      id: e.id,
      type: e.kind,
      label: e.label,
      content: e.content,
    }));
  }, [activeResult]);
  const requirementById = useMemo(
    () => new Map(requirementEntries.map((item) => [item.id, item])),
    [requirementEntries],
  );
  /** 用当前编辑器正文解析出的需求片段做定位，避免与拆分时的 `activeResult.source` 不一致导致无法高亮。 */
  const liveRequirementContentById = useMemo(() => {
    const map = new Map<string, string>();
    if (!inputValue.trim()) return map;
    try {
      const meta = parsePrdInput(inputValue);
      if (meta.sourceType === "url") return map;
      const liveDoc = normalizePrdDocument(meta);
      for (const e of listPrdRequirementIndexEntries(liveDoc)) {
        map.set(e.id, e.content);
      }
    } catch {
      return map;
    }
    return map;
  }, [inputValue]);
  const requirementContentById = useMemo(() => {
    const merged = new Map<string, string>();
    for (const [id, entry] of requirementById.entries()) {
      merged.set(id, entry.content ?? "");
    }
    for (const [id, liveContent] of liveRequirementContentById.entries()) {
      if (typeof liveContent === "string" && liveContent.trim().length > 0) {
        merged.set(id, liveContent);
      }
    }
    return merged;
  }, [liveRequirementContentById, requirementById]);
  const pickRequirementIdForTask = useCallback((task: TaskItem | null | undefined, preferredProbe?: string): string | null => {
    if (!task) return null;
    return pickMostRelevantRequirementId(task, requirementContentById, preferredProbe);
  }, [requirementContentById]);
  const taskIdsByRequirementId = useMemo(() => {
    const map = new Map<string, string[]>();
    const taskIds = new Set((activeResult ? allSplitResultTaskItems(activeResult) : []).map((task) => task.id));
    const push = (requirementId: string, taskId: string) => {
      const normalizedRequirementId = requirementId.trim();
      const normalizedTaskId = taskId.trim();
      if (!normalizedRequirementId || !normalizedTaskId) return;
      if (!taskIds.has(normalizedTaskId)) return;
      const list = map.get(normalizedRequirementId) ?? [];
      if (!list.includes(normalizedTaskId)) {
        list.push(normalizedTaskId);
      }
      map.set(normalizedRequirementId, list);
    };

    // 主来源：任务上的 sourceRequirementIds。
    for (const task of activeResult?.splitTasks ?? []) {
      for (const requirementId of task.sourceRequirementIds ?? []) {
        push(requirementId, task.id);
      }
    }

    return map;
  }, [activeResult]);
  const filteredTasks = useMemo(() => {
    if (!activeResult) return [];
    return activeResult.splitTasks.filter((task) => {
      const isConfirmed = displayExecutionStatus(task) === "executable";
      if (taskConfirmFilter === "confirmed" && !isConfirmed) return false;
      if (taskConfirmFilter === "unconfirmed" && isConfirmed) return false;
      if (taskRoleFilter !== "all" && task.role !== taskRoleFilter) return false;
      return true;
    });
  }, [activeResult, taskConfirmFilter, taskRoleFilter]);
  const taskConfirmCounts = useMemo(() => {
    const tasks = activeResult?.splitTasks ?? [];
    const confirmedCount = tasks.filter((task) => displayExecutionStatus(task) === "executable").length;
    return {
      confirmedCount,
      unconfirmedCount: tasks.length - confirmedCount,
    };
  }, [activeResult?.splitTasks]);
  const hasUnconfirmedTasks = taskConfirmCounts.unconfirmedCount > 0;
  const hasConfirmedTasks = taskConfirmCounts.confirmedCount > 0;
  const canGenerateExecutableTasks = Boolean(
    activeResult
    && activeResult.splitTasks.length > 0
    && !hasUnconfirmedTasks
    && hasConfirmedTasks
    && !confirmSavingTaskId,
  );
  const taskRoleCounts = useMemo(() => {
    const allCount = activeResult?.splitTasks.length ?? 0;
    const frontendCount = activeResult?.splitTasks.filter((task) => task.role === "frontend").length ?? 0;
    const backendCount = activeResult?.splitTasks.filter((task) => task.role === "backend").length ?? 0;
    const documentCount = activeResult?.splitTasks.filter((task) => task.role === "document").length ?? 0;
    const distinctRoleKinds = [frontendCount > 0, backendCount > 0, documentCount > 0].filter(Boolean).length;
    return { allCount, frontendCount, backendCount, documentCount, distinctRoleKinds };
  }, [activeResult?.splitTasks]);
  const showRoleFilterTabs = taskRoleCounts.distinctRoleKinds >= 2;
  const taskRoleFilterOptions = useMemo(() => {
    const opts: { label: string; value: TaskRoleFilter }[] = [
      { label: `全部（${taskRoleCounts.allCount}）`, value: "all" },
    ];
    if (taskRoleCounts.frontendCount > 0) {
      opts.push({ label: `前端（${taskRoleCounts.frontendCount}）`, value: "frontend" });
    }
    if (taskRoleCounts.backendCount > 0) {
      opts.push({ label: `后端（${taskRoleCounts.backendCount}）`, value: "backend" });
    }
    if (taskRoleCounts.documentCount > 0) {
      opts.push({ label: `文档（${taskRoleCounts.documentCount}）`, value: "document" });
    }
    return opts;
  }, [taskRoleCounts]);
  const splitRubricReport = useMemo(
    () => (activeResult ? validateSplitResult(activeResult) : null),
    [activeResult],
  );
  const splitRubricHardErrors = splitRubricReport ? (splitRubricReport.hardErrors ?? splitRubricReport.errors ?? []) : [];
  const splitStatusSummary = useMemo(() => {
    if (!activeResult || !splitRubricReport) return null;
    const decisionText = splitRubricReport.mergeDecision === "block" ? "阻断（需先修复）" : "放行（可直接继续）";
    return {
      policyText: activeResult.context?.splitPolicyId ?? "未命中/未记录",
      decisionText,
      hardErrorCount: splitRubricHardErrors.length,
    };
  }, [activeResult, splitRubricReport, splitRubricHardErrors.length]);
  const mappingFallbackStats = useMemo(() => {
    const links = activeResult?.claudeSplitMapping?.taskRequirementLinks ?? [];
    if (links.length === 0) return null;
    const fallbackCount = links.filter((link) => (link.rationale ?? "").includes("本地自动映射")).length;
    return {
      total: links.length,
      fallbackCount,
      hasFallback: fallbackCount > 0,
      allFallback: fallbackCount === links.length,
    };
  }, [activeResult?.claudeSplitMapping?.taskRequirementLinks]);
  const hasSplitTopFixedBanner = Boolean(
    splitRubricReport && splitRubricHardErrors.length > 0,
  ) || Boolean(splitStatusSummary);
  const splitQualityStats = useMemo(() => {
    if (!splitQualitySummary) return null;
    const { totalTasks, mappedTaskCount, traceableTaskCount, untraceableTaskIds } = splitQualitySummary;
    const mappingRate = totalTasks > 0 ? Math.round((mappedTaskCount / totalTasks) * 100) : 0;
    const traceRate = totalTasks > 0 ? Math.round((traceableTaskCount / totalTasks) * 100) : 0;
    return {
      totalTasks,
      mappedTaskCount,
      traceableTaskCount,
      untraceableTaskIds,
      mappingRate,
      traceRate,
    };
  }, [splitQualitySummary]);
  /** 锚点主键统一使用 taskId；优先使用任务内 taskAnchors（from/to/context*），并保留文本回退。 */
  const milkdownTaskAnchors = useMemo((): MilkdownTaskAnchor[] | undefined => {
    if (!activeResult) return undefined;
    const anchors: MilkdownTaskAnchor[] = [];
    const taskAnchorTexts = activeResult.taskAnchorTexts ?? {};
    for (const task of activeResult.splitTasks) {
      const fallbackRequirementId = pickRequirementIdForTask(task);
      const fallbackText = (
        (fallbackRequirementId
          ? requirementContentById.get(fallbackRequirementId)
          : "")
        ?? ""
      ).trim();
      const descriptor = task.taskAnchors ?? activeResult.taskAnchorDescriptors?.[task.id];
      const taskLevelAnchorHint = (descriptor?.contextAfter ?? "").trim();
      const descriptorHint = (activeResult.taskAnchorDescriptors?.[task.id]?.contextAfter ?? "").trim();
      // taskAnchors 是首要来源，但为避免模型片段不在当前文档造成“完全无锚点”，保留稳定回退顺序。
      const searchText = (taskAnchorTexts[task.id] || taskLevelAnchorHint || descriptorHint || fallbackText).trim();
      if (!searchText) continue;
      anchors.push({
        key: task.id,
        searchText,
        range: activeResult.taskAnchorPositions?.[task.id] ?? (
          descriptor
          && Number.isFinite(descriptor.from)
          && Number.isFinite(descriptor.to)
          && descriptor.to > descriptor.from
            ? { from: Math.floor(descriptor.from), to: Math.floor(descriptor.to) }
            : undefined
        ),
        descriptor,
        markers: [{ taskId: task.id, label: anchorLabelFromTaskId(task.id) }],
      });
    }
    return anchors.length ? anchors : undefined;
  }, [
    activeResult,
    pickRequirementIdForTask,
    requirementContentById,
  ]);
  const showUrlAnchorHint = useMemo(() => {
    if (!isUrlInputMode) return false;
    const linkCount = activeResult?.claudeSplitMapping?.taskRequirementLinks?.length ?? 0;
    const anchorCount = milkdownTaskAnchors?.length ?? 0;
    return linkCount > 0 && anchorCount === 0;
  }, [activeResult?.claudeSplitMapping?.taskRequirementLinks, isUrlInputMode, milkdownTaskAnchors]);

  const anchorResolutionResetKey = useMemo(() => (
    activeResult
      ? JSON.stringify(activeResult.splitTasks.map((task) => task.id.trim()).filter((id) => id.length > 0))
      : ""
  ), [activeResult?.splitTasks]);

  useEffect(() => {
    setResolvedTaskAnchorIds([]);
    setAnchorResolveReported(false);
  }, [anchorResolutionResetKey]);

  useEffect(() => {
    if (!activeResult) return;
    const anchorTexts = activeResult.taskAnchorTexts ?? {};
    const nextAnchorTexts: Record<string, string> = { ...anchorTexts };
    const resolvedSet = new Set(resolvedTaskAnchorIds);
    let changed = false;
    for (const task of activeResult.splitTasks) {
      const taskId = task.id.trim();
      if (!taskId) continue;
      const existing = (anchorTexts[taskId] ?? "").trim();
      const fallbackRequirementId = pickRequirementIdForTask(task);
      if (!fallbackRequirementId) continue;
      const fallbackText = (
        requirementContentById.get(fallbackRequirementId)
        ?? ""
      ).trim();
      if (!fallbackText) continue;
      const unresolvedByRender = anchorResolveReported && !resolvedSet.has(taskId);
      const shouldForceRefresh = existing !== fallbackText;
      if (!unresolvedByRender && !shouldForceRefresh) continue;
      if (existing === fallbackText) continue;
      nextAnchorTexts[taskId] = fallbackText;
      changed = true;
    }
    if (!changed) return;
    const merged: SplitResult = {
      ...activeResult,
      taskAnchorTexts: nextAnchorTexts,
    };
    setActiveResult(merged);
    void savePrdTaskSplitResult(merged).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      message.warning(`任务锚点自愈持久化失败：${msg}`);
    });
  }, [
    activeResult,
    anchorResolveReported,
    message,
    pickRequirementIdForTask,
    requirementContentById,
    resolvedTaskAnchorIds,
  ]);

  const mappingDebugFingerprint = useMemo(
    () =>
      activeResult
        ? JSON.stringify({
            splitTasks: activeResult.splitTasks.map((t) => ({
              id: t.id,
              sourceRequirementIds: t.sourceRequirementIds ?? [],
            })),
            claudeSplitMapping: activeResult.claudeSplitMapping ?? null,
          })
        : "",
    [activeResult],
  );
  const lastMappingDebugFingerprintRef = useRef("");

  useEffect(() => {
    if (!mappingDebugFingerprint || !activeResult) {
      lastMappingDebugFingerprintRef.current = "";
      return;
    }
    if (lastMappingDebugFingerprintRef.current === mappingDebugFingerprint) return;
    lastMappingDebugFingerprintRef.current = mappingDebugFingerprint;
    const reqToTasks: Record<string, string[]> = {};
    for (const [reqId, ids] of taskIdsByRequirementId.entries()) {
      reqToTasks[reqId] = ids;
    }
    const taskToReqs = activeResult.splitTasks.map((t) => ({
      taskId: t.id,
      title: t.title,
      sourceRequirementIds: [...(t.sourceRequirementIds ?? [])],
    }));
    const anchorCount = Object.keys(activeResult.taskAnchorDescriptors ?? {}).length;
    console.groupCollapsed(
      `[Wise PRD 映射] 任务 ${activeResult.splitTasks.length} 条；需求→任务条目 ${Object.keys(reqToTasks).length}；编辑器锚点 ${anchorCount}`,
    );
    console.info("需求 id → 任务 id[]", reqToTasks);
    console.info("任务 → sourceRequirementIds", taskToReqs);
    console.info("taskAnchorDescriptors", activeResult.taskAnchorDescriptors ?? {});
    if (activeResult.claudeSplitMapping) {
      console.info("claudeSplitMapping", activeResult.claudeSplitMapping);
    } else {
      console.info("claudeSplitMapping", "（无）");
    }
    console.groupEnd();
  }, [activeResult, mappingDebugFingerprint, taskIdsByRequirementId]);

  const scrollToRequirementInPrd = useCallback((requirementId: string): boolean => {
    const snippet = (
      liveRequirementContentById.get(requirementId)
      ?? requirementById.get(requirementId)?.content
      ?? ""
    ).trim();
    if (!snippet) return false;
    window.requestAnimationFrame(() => {
      milkdownEditorRef.current?.scrollToRequirementSnippet(snippet);
    });
    return true;
  }, [liveRequirementContentById, requirementById]);

  const scrollToTaskAnchorInPrd = useCallback((task: TaskItem) => {
    const anchor = task.taskAnchors ?? activeResult?.taskAnchorDescriptors?.[task.id];
    if (!anchor) return false;
    const mode = milkdownEditorRef.current?.highlightTaskAnchorRange({
      from: anchor.from,
      to: anchor.to,
      textHash: anchor.textHash,
      contextBefore: anchor.contextBefore,
      contextAfter: anchor.contextAfter,
    });
    return Boolean(mode && mode !== "none");
  }, [activeResult?.taskAnchorDescriptors]);

  const focusTask = useCallback((taskId: string) => {
    if (selectedTaskIdRef.current !== taskId) {
      milkdownEditorRef.current?.clearRequirementFocusHighlight();
    }
    setSelectedTaskId(taskId);
    setSelectedAnchorTaskId(taskId);
    scrollToTaskCard(taskId);
  }, []);

  /** 需求锚点 / 菜单跳转：按任务确认态与角色筛选切换 tab，再在列表渲染后定位卡片 */
  const focusTaskWithFilterSync = useCallback(
    (taskId: string) => {
      const task = activeResult?.splitTasks.find((t) => t.id === taskId);
      if (!task) {
        focusTask(taskId);
        return;
      }
      const shouldToConfirmed = displayExecutionStatus(task) === "executable";
      const targetConfirmFilter: TaskConfirmFilter = shouldToConfirmed ? "confirmed" : "unconfirmed";
      const needTabSwitch = taskConfirmFilter !== targetConfirmFilter;
      const needRoleReset = taskRoleFilter !== "all" && task.role !== taskRoleFilter;
      if (needTabSwitch) {
        setTaskConfirmFilter(targetConfirmFilter);
      }
      if (needRoleReset) {
        setTaskRoleFilter("all");
      }
      if (needTabSwitch || needRoleReset) {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            focusTask(taskId);
          });
        });
      } else {
        focusTask(taskId);
      }
    },
    [activeResult?.splitTasks, focusTask, taskConfirmFilter, taskRoleFilter],
  );

  useEffect(() => {
    if (!selectedAnchorTaskId) return;
    const exists = activeResult?.splitTasks.some((task) => task.id === selectedAnchorTaskId) ?? false;
    if (!exists) {
      setSelectedAnchorTaskId(null);
    }
  }, [activeResult?.splitTasks, selectedAnchorTaskId]);

  const unmetTaskIds = useMemo(() => {
    const list = activeResult?.splitTasks ?? [];
    return list
      .filter((task) => cardUnmetPointsForTask(task).length > 0)
      .map((task) => task.id);
  }, [activeResult?.splitTasks]);

  const unmetPreconditionsMenuItems = useMemo((): MenuProps["items"] => {
    if (!unmetTaskIds.length || !activeResult) return undefined;
    return unmetTaskIds.map((taskId) => {
      const task = activeResult.splitTasks.find((t) => t.id === taskId);
      const anchor = `#${anchorLabelFromTaskId(taskId)}`;
      return {
        key: `unmet-task-${taskId}`,
        label: (
          <span className="app-prd-task-panel__unmet-menu-label" title={`跳转到 ${taskId}`}>
            {anchor}
          </span>
        ),
        disabled: !task,
        onClick: () => {
          if (!task) return;
          focusTaskWithFilterSync(taskId);
        },
      };
    });
  }, [activeResult, focusTaskWithFilterSync, unmetTaskIds]);

  useEffect(() => {
    selectedTaskIdRef.current = selectedTaskId;
  }, [selectedTaskId]);

  useEffect(() => {
    if (!showRoleFilterTabs && taskRoleFilter !== "all") {
      setTaskRoleFilter("all");
    }
  }, [showRoleFilterTabs, taskRoleFilter]);

  useEffect(() => {
    if (taskRoleFilter === "all") return;
    const count =
      taskRoleFilter === "frontend"
        ? taskRoleCounts.frontendCount
        : taskRoleFilter === "backend"
          ? taskRoleCounts.backendCount
          : taskRoleCounts.documentCount;
    if (count === 0) setTaskRoleFilter("all");
  }, [taskRoleFilter, taskRoleCounts]);

  useEffect(() => {
    if ((activeResult?.splitTasks.length ?? 0) === 0) {
      setSelectedTaskId(null);
      return;
    }
    if (filteredTasks.length > 0 && selectedTaskId && !filteredTasks.some((task) => task.id === selectedTaskId)) {
      milkdownEditorRef.current?.clearRequirementFocusHighlight();
      setSelectedTaskId(filteredTasks[0]?.id ?? null);
    }
  }, [activeResult?.splitTasks.length, filteredTasks, selectedTaskId]);

  useEffect(() => {
    if (selectedTaskId) return;
    milkdownEditorRef.current?.clearRequirementFocusHighlight();
  }, [selectedTaskId]);

  useEffect(() => {
    const projectDraftScope = activeProjectId?.trim() || linkedProjectId?.trim() || null;
    void (async () => {
      const draft = await loadPrdDraft(projectDraftScope);
      if (!draft) return;
      const historical = (draft.requirements ?? []).filter((item) => item.requirementDisplayName.trim().length > 0);
      if (historical.length > 0) {
        const sorted = [...historical].sort((a, b) => b.updatedAt - a.updatedAt);
        const pinned = sorted.find((item) => item.isPinned);
        // 进入面板时：有置顶优先展示置顶；否则展示最新需求
        const selectedId = pinned?.id ?? sorted[0]?.id ?? null;
        const selected = selectedId ? sorted.find((item) => item.id === selectedId) ?? null : null;
        setRequirementHistory(sorted);
        setActiveRequirementId(selectedId);
        if (selected) {
          setInputValue(selected.inputValue);
          setOriginalInputValue(selected.originalInputValue ?? null);
          setContextMode(selected.contextMode);
          setLinkedProjectId(selected.linkedProjectId);
          setLinkedRepositoryId(selected.linkedRepositoryId);
          setRequirementDisplayName(selected.requirementDisplayName.trim());
        }
        return;
      }
      const named = draft.requirementDisplayName?.trim();
      if (named) {
        const now = Date.now();
        const id = createRequirementHistoryId();
        const initial: PrdRequirementHistoryItem = {
          id,
          requirementDisplayName: named,
          isPinned: false,
          inputValue: draft.inputValue,
          originalInputValue: draft.originalInputValue ?? null,
          contextMode: draft.contextMode,
          linkedProjectId: draft.linkedProjectId,
          linkedRepositoryId: draft.linkedRepositoryId,
          createdAt: now,
          updatedAt: now,
        };
        setRequirementHistory([initial]);
        setActiveRequirementId(id);
      }
      setInputValue(draft.inputValue);
      setOriginalInputValue(draft.originalInputValue ?? null);
      setContextMode(draft.contextMode);
      setLinkedProjectId(draft.linkedProjectId);
      setLinkedRepositoryId(draft.linkedRepositoryId);
      setRequirementDisplayName(named ? named : null);
    })();
  }, [activeProjectId, linkedProjectId, setInputValue]);

  useEffect(() => {
    if (!activeRequirementId) return;
    setRequirementHistory((prev) => prev.map((item) => {
      if (item.id !== activeRequirementId) return item;
      const name = requirementDisplayName?.trim() || item.requirementDisplayName;
      return {
        ...item,
        requirementDisplayName: name,
        inputValue,
        originalInputValue,
        contextMode,
        linkedProjectId,
        linkedRepositoryId,
      };
    }));
  }, [
    activeRequirementId,
    contextMode,
    inputValue,
    linkedProjectId,
    linkedRepositoryId,
    originalInputValue,
    requirementDisplayName,
  ]);

  useEffect(() => {
    void loadTaskResultForActiveRequirement(activeRequirementId);
  }, [activeRequirementId]);

  useEffect(() => {
    if (activeProjectId) setLinkedProjectId(activeProjectId);
    if (activeRepositoryId) setLinkedRepositoryId(activeRepositoryId);
  }, [activeProjectId, activeRepositoryId]);


  useEffect(() => {
    if (!hasSplitTopFixedBanner) return;
    let rafId: number | null = null;
    const updateFixedBannerPosition = () => {
      const host = taskSplitHostRef.current;
      const banner = fixedBannerRef.current;
      if (!host || !banner) return;
      const rect = host.getBoundingClientRect();
      if (rect.width <= 0) return;
      const width = Math.min(620, Math.max(280, rect.width - 24));
      banner.style.left = "";
      banner.style.width = `${width}px`;
      const right = Math.max(8, window.innerWidth - (rect.left + rect.width / 2 + width / 2));
      banner.style.right = `${right}px`;
    };
    const scheduleUpdateFixedBannerPosition = () => {
      if (rafId != null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        updateFixedBannerPosition();
      });
    };
    updateFixedBannerPosition();
    window.addEventListener("resize", scheduleUpdateFixedBannerPosition);
    window.addEventListener("scroll", scheduleUpdateFixedBannerPosition, { capture: true, passive: true });
    return () => {
      window.removeEventListener("resize", scheduleUpdateFixedBannerPosition);
      window.removeEventListener("scroll", scheduleUpdateFixedBannerPosition, true);
      if (rafId != null) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [hasSplitTopFixedBanner, activeResult, taskRoleFilter]);

  const splitRuntimeInModal =
    splitPromptAdjustModalOpen && splitWizardStep === "runtime";
  useEffect(() => {
    if (!splitRuntimeVisible && !splitRuntimeInModal) return;
    const el = splitRuntimeListRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [splitRuntimeVisible, splitRuntimeInModal, splitRuntimeLogs.length]);

  useEffect(() => {
    if (!splitRuntimeVisible) return;
    let rafId: number | null = null;
    const updateSplitRuntimeOverlayRect = () => {
      const overlay = splitRuntimeRef.current;
      const shell = requirementEditorShellRef.current;
      if (!overlay || !shell) return;
      const rect = shell.getBoundingClientRect();
      overlay.style.bottom = `66px`;
      overlay.style.left = `${Math.max(0, rect.left)}px`;
      overlay.style.width = `${Math.max(0, rect.width)}px`;
      overlay.style.height = `360px`;
      overlay.style.zIndex = "1000";
    };
    const scheduleUpdateSplitRuntimeOverlayRect = () => {
      if (rafId != null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        updateSplitRuntimeOverlayRect();
      });
    };
    updateSplitRuntimeOverlayRect();
    window.addEventListener("resize", scheduleUpdateSplitRuntimeOverlayRect);
    window.addEventListener("scroll", scheduleUpdateSplitRuntimeOverlayRect, { capture: true, passive: true });
    return () => {
      window.removeEventListener("resize", scheduleUpdateSplitRuntimeOverlayRect);
      window.removeEventListener("scroll", scheduleUpdateSplitRuntimeOverlayRect, true);
      if (rafId != null) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [splitRuntimeVisible]);

  useEffect(() => {
    urlAnchorAutoBackfilledRef.current = false;
  }, [activeResult]);

  useEffect(() => () => {
    if (anchorRangePersistTimerRef.current != null) {
      window.clearTimeout(anchorRangePersistTimerRef.current);
      anchorRangePersistTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!activeResult) return;
    if (!isUrlInputMode) return;
    if (urlAnchorAutoBackfilledRef.current) return;
    const hasMappingLinks = (activeResult.claudeSplitMapping?.taskRequirementLinks?.length ?? 0) > 0;
    if (!hasMappingLinks) return;
    if ((milkdownTaskAnchors?.length ?? 0) > 0) return;
    const normalizedMarkdown = prdDocumentToSplitMarkdown(activeResult.source);
    if (normalizedMarkdown.trim() && normalizedMarkdown !== inputValue) {
      if (!originalInputValue && inputValue.trim()) {
        setOriginalInputValue(inputValue);
      }
      setInputValue(normalizedMarkdown);
      urlAnchorAutoBackfilledRef.current = true;
    }
  }, [activeResult, inputValue, isUrlInputMode, milkdownTaskAnchors, originalInputValue, setInputValue]);

  async function runClaudeSplitExecution(
    doc: PrdDocument,
    splitContext: TaskSplitContext,
    sceneLabel: string,
    rawMarkdownForClaude: string,
    applyMode: SplitApplyMode = "replace",
    promptDraftOverrides?: SplitPromptDraftBySlot,
    splitExecutionOptions?: { closeSplitWizardOnTwoStageSuccess?: boolean },
  ): Promise<void> {
    setSplitQualitySummary(null);
    const repositoryPath = linkedRepository?.path ?? splitContext.repositoryPath ?? null;
    if (!repositoryPath) {
      appendSplitRuntimeLog("error", "未关联仓库，已跳过 Claude 执行。");
      return;
    }
    appendSplitRuntimeLog("system", `仓库：${repositoryPath}`);

    const readSplitSpecPreferLocal = async (relativePath: string): Promise<string> => {
      const localPath = localSpecRepositoryPath?.trim();
      if (localPath && localPath !== repositoryPath) {
        return readProjectRelativeFile(localPath, relativePath)
          .catch(() => readProjectRelativeFile(repositoryPath, relativePath));
      }
      return readProjectRelativeFile(repositoryPath, relativePath);
    };
    const [systemInstruction, outputSchemaJson] = await Promise.all([
      readSplitSpecPreferLocal(".task/claude-split-system-instruction.v1.md")
        .catch(() => FALLBACK_CLAUDE_SPLIT_SYSTEM_INSTRUCTION),
      readSplitSpecPreferLocal(".task/claude-split-output.schema.json")
        .catch(() => readSplitSpecPreferLocal(".task/task-split-output-schema.json"))
        .catch(() => FALLBACK_CLAUDE_SPLIT_OUTPUT_SCHEMA_JSON),
    ]);
    appendSplitRuntimeLog("system", "已就绪 system 指令与输出 schema。");

    const payload = buildSplitRequestPayload({
      prd: doc,
      context: splitContext,
      outputSchemaJson,
    });
    if (!payload.ok) {
      appendSplitRuntimeLog("error", `输入准备失败：${payload.reason}`);
      throw new Error(`输入准备失败：${payload.reason}`);
    }
    appendSplitRuntimeLog("system", "输入包文件：repo-context.json, OUTPUT_SCHEMA.json");

    const prdMarkdown = rawMarkdownForClaude.trim() || (payload.bundle["prd.md"] ?? "");
    const requirementsIndexJson = payload.bundle["requirements-index.json"] ?? null;
    const snap = await materializePrdSnapshot(
      repositoryPath,
      prdMarkdown,
      null,
      null,
      requirementsIndexJson,
      {
        policyId: splitContext.splitPolicyId ?? null,
        policyFeatures: splitContext.splitPolicyFeatures ?? null,
        routerRationale: splitContext.splitPolicyRationale ?? null,
      },
    );

    const runDir = dirnameFromAbsolutePath(snap.prdRelativePath);
    appendSplitRuntimeLog("system", `runId=${snap.runId}，目录=${runDir}`);
    const wiseRunRelativeBase = `prd-runs/${snap.runId}`;
    await appendWiseRelativeFile(`${wiseRunRelativeBase}/repo-context.json`, payload.bundle["repo-context.json"] ?? "");
    await appendWiseRelativeFile(`${wiseRunRelativeBase}/OUTPUT_SCHEMA.json`, outputSchemaJson);

    const repoContextContent = payload.bundle["repo-context.json"] ?? "";
    const requirementsIndexContent = payload.bundle["requirements-index.json"] ?? "{}";
    const prdContentForPrompt = rawMarkdownForClaude.trim() || prdMarkdown.trim();
    const promptProjectId = linkedProjectId ?? null;
    const promptRepositoryId = contextMode === "project" ? null : (linkedRepositoryId ?? null);
    const buildAssociatedPrompt = (rendered: ReturnType<typeof renderSplitPromptTemplate>): string => {
      const renderedUserWithoutReq = rendered.ok ? stripRequirementsIndexSection(rendered.renderedUser) : "";
      const renderedSystemPrompt = rendered.ok ? rendered.renderedSystem.trim() : "";
      const renderedTemplatePrompt = rendered.ok
        ? stripSectionByHeading(stripSectionByHeading(renderedUserWithoutReq, "PRD（Markdown）"), "输出 schema 引用")
        : "";
      return renderedSystemPrompt || renderedTemplatePrompt.trim() || computeDefaultRepoAwarePromptMarkdown().trim();
    };
    const baseRenderVars = {
      PRD_MARKDOWN: prdContentForPrompt,
      REQUIREMENTS_INDEX_JSON: requirementsIndexContent.trim() || "{}",
      REPO_CONTEXT_JSON: repoContextContent.trim() || "{}",
      OUTPUT_SCHEMA_REF: outputSchemaJson.trim(),
    };
    const [phase1Template, phase2Template] = await Promise.all([
      resolveEffectiveSplitPromptTemplate(promptProjectId, promptRepositoryId, PROMPT_SLOT_PRD_TASK_SPLIT_PHASE1),
      resolveEffectiveSplitPromptTemplate(promptProjectId, promptRepositoryId, PROMPT_SLOT_PRD_TASK_SPLIT_PHASE2),
    ]);
    const phase1Override = promptDraftOverrides?.[PROMPT_SLOT_PRD_TASK_SPLIT_PHASE1]?.trim();
    const phase2Override = promptDraftOverrides?.[PROMPT_SLOT_PRD_TASK_SPLIT_PHASE2]?.trim();
    const phase1TemplateForRun = phase1Override ? { ...phase1Template, systemBody: phase1Override } : phase1Template;
    const phase2TemplateForRun = phase2Override ? { ...phase2Template, systemBody: phase2Override } : phase2Template;
    const phase1AssociatedPrompt = buildAssociatedPrompt(renderSplitPromptTemplate(phase1TemplateForRun, baseRenderVars));
    const phase2AssociatedPrompt = buildAssociatedPrompt(renderSplitPromptTemplate(phase2TemplateForRun, baseRenderVars));
    const assembledPhase1Message = buildSplitPhase1PromptMessage({
      systemInstruction,
      associatedPromptMarkdown: phase1AssociatedPrompt,
      prdMarkdown: prdContentForPrompt,
      repoContextJson: repoContextContent.trim(),
    });
    appendSplitRuntimeLog("user", assembledPhase1Message);

    const stdoutPath = `${runDir}/claude.stdout.log`;
    const stderrPath = `${runDir}/claude.stderr.log`;
    let stdoutCursor = 0;
    let stderrCursor = 0;
    const announcedSessionIds = new Set<string>();
    let readingRuntimeLog = false;
    const readRuntimeLogDelta = async (final: boolean): Promise<void> => {
      if (readingRuntimeLog && !final) return;
      readingRuntimeLog = true;
      try {
        const [stdoutText, stderrText] = await Promise.all([
          readSnapshotFile(stdoutPath).catch(() => ""),
          readSnapshotFile(stderrPath).catch(() => ""),
        ]);
        if (stdoutText.length > stdoutCursor) {
          const delta = stdoutText.slice(stdoutCursor);
          stdoutCursor = stdoutText.length;
          for (const rawLine of delta.split(/\r?\n/)) {
            const session = parseClaudeRuntimeSessionInfo(rawLine);
            if (!session) continue;
            if (announcedSessionIds.has(session.sessionId)) continue;
            announcedSessionIds.add(session.sessionId);
            appendSplitRuntimeLog("system", formatClaudeRuntimeSessionInfo(session));
          }
          const clipped = clipRuntimeLogText(delta);
          if (clipped) appendSplitRuntimeLog("assistant", `Claude stdout\n${clipped}`);
        }
        if (stderrText.length > stderrCursor) {
          const delta = stderrText.slice(stderrCursor);
          stderrCursor = stderrText.length;
          const clipped = clipRuntimeLogText(delta);
          if (clipped) appendSplitRuntimeLog("system", `Claude stderr\n${clipped}`);
        }
      } finally {
        readingRuntimeLog = false;
      }
    };
    const getRuntimePollIntervalMs = (): number => (document.visibilityState === "visible" ? 700 : 2000);
    let pollTimer: number | null = null;
    const scheduleRuntimePoll = () => {
      pollTimer = window.setTimeout(() => {
        void readRuntimeLogDelta(false);
        scheduleRuntimePoll();
      }, getRuntimePollIntervalMs());
    };
    scheduleRuntimePoll();
    const normalizeAnchorProbe = (value: string): string => value.replace(/\s+/g, " ").trim().toLowerCase();
    const includesLoosely = (needle: string, hay: string): boolean => {
      const n = normalizeAnchorProbe(needle);
      const h = normalizeAnchorProbe(hay);
      if (!n || !h) return false;
      if (h.includes(n) || n.includes(h)) return true;
      if (n.length >= 8 && h.includes(n.slice(0, Math.min(24, n.length)))) return true;
      return false;
    };
    const inspectAnchorTraceability = (normalized: SplitResult): {
      traceableTaskCount: number;
      untraceableTaskIds: string[];
    } => {
      const reqTextById = new Map(listPrdRequirementIndexEntries(doc).map((entry) => [entry.id, entry.content]));
      let traceableTaskCount = 0;
      const untraceableTaskIds: string[] = [];
      for (const task of normalized.splitTasks) {
        const descriptor = task.taskAnchors ?? normalized.taskAnchorDescriptors?.[task.id];
        const ctxAfter = (descriptor?.contextAfter ?? "").trim();
        const ctxBefore = (descriptor?.contextBefore ?? "").trim();
        const probe = ctxAfter || ctxBefore;
        const reqTexts = (task.sourceRequirementIds ?? [])
          .map((id) => reqTextById.get(id) ?? "")
          .map((x) => x.trim())
          .filter((x) => x.length > 0);
        const ok = probe.length >= 4 && reqTexts.some((reqText) => includesLoosely(probe, reqText));
        if (ok) traceableTaskCount += 1;
        else untraceableTaskIds.push(task.id);
      }
      return { traceableTaskCount, untraceableTaskIds };
    };
    const summarizeSplitQuality = (normalized: SplitResult): {
      totalTasks: number;
      mappedTaskCount: number;
      traceableTaskCount: number;
      untraceableTaskIds: string[];
    } => {
      const totalTasks = normalized.splitTasks.length;
      const mappedTaskCount = normalized.splitTasks.filter((task) => (task.sourceRequirementIds?.length ?? 0) > 0).length;
      const traceability = inspectAnchorTraceability(normalized);
      return {
        totalTasks,
        mappedTaskCount,
        traceableTaskCount: traceability.traceableTaskCount,
        untraceableTaskIds: traceability.untraceableTaskIds,
      };
    };
    const inspectTaskAnchorFormatIssues = (payload: unknown): {
      issueCount: number;
      arrayAnchorTaskIds: string[];
      emptyHashTaskIds: string[];
    } => {
      if (typeof payload !== "object" || payload === null) {
        return { issueCount: 0, arrayAnchorTaskIds: [], emptyHashTaskIds: [] };
      }
      const root = payload as { tasks?: unknown };
      if (!Array.isArray(root.tasks)) {
        return { issueCount: 0, arrayAnchorTaskIds: [], emptyHashTaskIds: [] };
      }
      const arrayAnchorTaskIds: string[] = [];
      const emptyHashTaskIds: string[] = [];
      for (let i = 0; i < root.tasks.length; i += 1) {
        const task = root.tasks[i];
        if (typeof task !== "object" || task === null) continue;
        const t = task as { id?: unknown; taskAnchors?: unknown; task_anchors?: unknown };
        const taskId = typeof t.id === "string" && t.id.trim() ? t.id.trim() : `task@${i + 1}`;
        const anchors = t.taskAnchors ?? t.task_anchors;
        if (Array.isArray(anchors)) {
          arrayAnchorTaskIds.push(taskId);
          const first = anchors.find((item) => typeof item === "object" && item !== null) as
            | { textHash?: unknown; text_hash?: unknown }
            | undefined;
          const hash = typeof first?.textHash === "string"
            ? first.textHash.trim()
            : typeof first?.text_hash === "string"
              ? first.text_hash.trim()
              : "";
          if (!hash) emptyHashTaskIds.push(taskId);
          continue;
        }
        if (typeof anchors !== "object" || anchors === null) {
          emptyHashTaskIds.push(taskId);
          continue;
        }
        const obj = anchors as { textHash?: unknown; text_hash?: unknown };
        const hash = typeof obj.textHash === "string"
          ? obj.textHash.trim()
          : typeof obj.text_hash === "string"
            ? obj.text_hash.trim()
            : "";
        if (!hash) emptyHashTaskIds.push(taskId);
      }
      return {
        issueCount: arrayAnchorTaskIds.length + emptyHashTaskIds.length,
        arrayAnchorTaskIds,
        emptyHashTaskIds,
      };
    };
    const parseAndMergeClaudePayload = async (
      parsed: unknown,
      payloadLog: string,
    ): Promise<{
      normalized: SplitResult;
      anchorFormatIssueCount: number;
      arrayAnchorTaskIds: string[];
      emptyHashTaskIds: string[];
      strictIssues: string[];
      quality: SplitQualitySummary;
    }> => {
      appendSplitRuntimeLog("assistant", clipRuntimeLogText(payloadLog));
      const anchorInspection = inspectTaskAnchorFormatIssues(parsed);
      const strictValidation = validateClaudeSplitPayloadStrict({ payload: parsed, source: doc });
      let normalized = normalizeClaudeSplitOutputToSplitResult({
        payload: parsed,
        source: doc,
        context: splitContext,
      });
      const stdoutFull = await readSnapshotFile(stdoutPath).catch(() => "");
      const sidecarText = await readSnapshotFile(`${runDir}/split-mapping.json`).catch(() => "");
      const mappingPayloads = [];
      const fromSidecar = parseSplitMappingJson(sidecarText.trim());
      if (fromSidecar) mappingPayloads.push(fromSidecar);
      const fromStdoutBlocks = extractSplitMappingFromClaudeOutput(stdoutFull);
      if (
        fromStdoutBlocks
        && JSON.stringify(fromStdoutBlocks) !== JSON.stringify(fromSidecar ?? null)
      ) {
        mappingPayloads.push(fromStdoutBlocks);
      }
      if (mappingPayloads.length > 0) {
        normalized = mergeSplitMappingPayloadsIntoSplitResult(normalized, mappingPayloads, {
          capturedAtMs: Date.now(),
          runId: snap.runId,
        });
        appendSplitRuntimeLog(
          "system",
          `已合并附加映射 ${mappingPayloads.length} 份（split-mapping.json 或 stdout 内 \`\`\`json 块）。`,
        );
      }
      normalized = remapSplitResultAnchorOffsetsFromMarkdown(prdContentForPrompt, normalized);
      const quality = summarizeSplitQuality(normalized);
      const mappingRate = quality.totalTasks > 0
        ? `${quality.mappedTaskCount}/${quality.totalTasks}`
        : "0/0";
      const traceRate = quality.totalTasks > 0
        ? `${quality.traceableTaskCount}/${quality.totalTasks}`
        : "0/0";
      appendSplitRuntimeLog(
        "system",
        `质量统计：映射覆盖 ${mappingRate}；锚点可追溯 ${traceRate}${quality.untraceableTaskIds.length > 0 ? `；不可追溯任务：${quality.untraceableTaskIds.join(", ")}` : ""}`,
      );
      return {
        normalized,
        anchorFormatIssueCount: anchorInspection.issueCount,
        arrayAnchorTaskIds: anchorInspection.arrayAnchorTaskIds,
        emptyHashTaskIds: anchorInspection.emptyHashTaskIds,
        strictIssues: strictValidation.issues.map((item) => `${item.path}: ${item.message}`),
        quality,
      };
    };
    const INITIAL_SPLIT_TIMEOUT_MS = 120_000;
    let latestPhase1Raw = "";
    let latestPhase1Parsed: {
      version?: unknown;
      tasks?: unknown;
      criticalPath?: unknown;
      parallelGroups?: unknown;
      unmetPreconditions?: unknown;
    } | null = null;
    let latestPhase1Tasks: unknown[] = [];

    const finalizeTwoStageResult = async (phase2Raw: string): Promise<void> => {
      if (!latestPhase1Parsed || latestPhase1Tasks.length === 0) {
        throw new Error("缺少阶段1任务上下文，无法合并阶段2结果。");
      }
      const phase2Parsed = JSON.parse(phase2Raw) as {
        taskMappings?: Array<{
          taskId?: unknown;
          sourceRequirementIds?: unknown;
          taskAnchors?: unknown;
          task_anchors?: unknown;
        }>;
      };
      const mappingByTaskId = new Map<string, {
        sourceRequirementIds: string[];
        taskAnchors: unknown;
      }>();
      for (const item of phase2Parsed.taskMappings ?? []) {
        if (!item || typeof item !== "object") continue;
        const taskId = typeof item.taskId === "string" ? item.taskId.trim() : "";
        if (!taskId) continue;
        const sourceRequirementIds = Array.isArray(item.sourceRequirementIds)
          ? item.sourceRequirementIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
          : [];
        mappingByTaskId.set(taskId, {
          sourceRequirementIds,
          taskAnchors: item.taskAnchors ?? item.task_anchors,
        });
      }
      const mergedPayload = {
        version: typeof latestPhase1Parsed.version === "number" ? latestPhase1Parsed.version : 1,
        tasks: latestPhase1Tasks.map((rawTask) => {
          const taskObj = (rawTask && typeof rawTask === "object") ? (rawTask as Record<string, unknown>) : {};
          const taskId = typeof taskObj.id === "string" ? taskObj.id.trim() : "";
          const mapped = mappingByTaskId.get(taskId);
          const remappedAnchors = remapAnchorRangeFromMarkdownToVisible(
            prdContentForPrompt,
            (mapped?.taskAnchors && typeof mapped.taskAnchors === "object")
              ? (mapped.taskAnchors as {
                from: number;
                to: number;
                textHash: string;
                contextBefore: string;
                contextAfter: string;
              })
              : undefined,
          );
          return {
            ...taskObj,
            sourceRequirementIds: mapped?.sourceRequirementIds ?? [],
            taskAnchors: remappedAnchors ?? mapped?.taskAnchors ?? null,
          };
        }),
        criticalPath: latestPhase1Parsed.criticalPath,
        parallelGroups: latestPhase1Parsed.parallelGroups,
        unmetPreconditions: latestPhase1Parsed.unmetPreconditions,
      };
      const mergedRaw = JSON.stringify(mergedPayload, null, 2);
      await appendWiseRelativeFile(`${wiseRunRelativeBase}/claude.result.two-stage.json`, mergedRaw);
      let normalized = (await parseAndMergeClaudePayload(
        mergedPayload,
        [
          "=== phase1.raw ===",
          latestPhase1Raw,
          "",
          "=== phase2.raw ===",
          phase2Raw,
          "",
          "=== merged.raw ===",
          mergedRaw,
        ].join("\n"),
      )).normalized;
      const quality = summarizeSplitQuality(normalized);
      setSplitQualitySummary(quality);
      appendSplitRuntimeLog(
        "system",
        `双阶段完成：阶段1任务=${latestPhase1Tasks.length}，阶段2映射=${mappingByTaskId.size}，可追溯锚点=${quality.traceableTaskCount}/${quality.totalTasks}`,
      );
      let nextResult = applyMode === "append" && activeResult
        ? mergeSplitResultsByAppend(activeResult, normalized)
        : syncTaskAnchorTextsFromRequirements(normalized);
      console.groupCollapsed(
        `[Wise 拆分结果] ${sceneLabel} · runId=${snap.runId} · tasks=${normalized.splitTasks.length}`,
      );
      console.info("normalized split result", normalized);
      console.info("final split result", nextResult);
      console.info("tasks", nextResult.splitTasks);
      console.info("taskAnchorDescriptors", nextResult.taskAnchorDescriptors ?? null);
      console.info("claudeSplitMapping", nextResult.claudeSplitMapping ?? null);
      console.groupEnd();
      try {
        await savePrdTaskSplitResult(nextResult);
      } catch (persistErr) {
        const msg = persistErr instanceof Error ? persistErr.message : String(persistErr);
        appendSplitRuntimeLog("error", `拆分结果保存失败：${msg}`);
        throw new Error(`拆分结果保存失败：${msg}`);
      }
      setActiveResult(nextResult);
      const firstTaskId = nextResult.splitTasks[0]?.id ?? null;
      setSelectedTaskId(firstTaskId);
      appendSplitRuntimeLog(
        "system",
        applyMode === "append"
          ? `Claude 输出已增量合并并保存（当前共 ${nextResult.splitTasks.length} 个任务），右侧可执行任务与左侧锚点已刷新。`
          : `Claude 输出已解析并保存（共 ${nextResult.splitTasks.length} 个任务），右侧可执行任务与左侧锚点已刷新。`,
      );
    };

    const runPhase1Only = async (): Promise<void> => {
      appendSplitRuntimeLog("user", assembledPhase1Message);
      appendSplitRuntimeLog("system", "开始执行阶段1：需求拆分。");
      const phase1Run = await runPrdSplitClaude({
        projectPath: repositoryPath,
        runDir,
        prompt: assembledPhase1Message,
        timeoutMs: INITIAL_SPLIT_TIMEOUT_MS,
      });
      await readRuntimeLogDelta(true);
      const phase1CodeText = explainClaudeSplitExitCode(phase1Run.exitCode);
      if (phase1Run.exitCode !== 0) {
        appendSplitRuntimeLog("error", `阶段1执行失败：${phase1CodeText}`, { retryPhase: "phase1" });
        throw new Error(`阶段1执行失败：${phase1CodeText}`);
      }
      const phase1Raw = await readSnapshotFile(phase1Run.rawResultPath);
      appendSplitRuntimeLog("assistant", clipRuntimeLogText(phase1Raw));
      const phase1Parsed = JSON.parse(phase1Raw) as {
        version?: unknown;
        tasks?: unknown;
        criticalPath?: unknown;
        parallelGroups?: unknown;
        unmetPreconditions?: unknown;
      };
      const phase1Tasks = Array.isArray(phase1Parsed.tasks) ? phase1Parsed.tasks : [];
      if (phase1Tasks.length === 0) {
        appendSplitRuntimeLog("error", "阶段1未产出有效 tasks，无法继续阶段2映射。", { retryPhase: "phase1" });
        throw new Error("阶段1未产出有效 tasks，无法继续阶段2映射。");
      }
      latestPhase1Raw = phase1Raw;
      latestPhase1Parsed = phase1Parsed;
      latestPhase1Tasks = phase1Tasks;
      appendSplitRuntimeLog("system", `阶段1成功：产出任务 ${phase1Tasks.length} 条。`);
    };

    const runPhase2Only = async (): Promise<void> => {
      if (!latestPhase1Parsed || latestPhase1Tasks.length === 0) {
        appendSplitRuntimeLog("error", "缺少阶段1产物，无法重试阶段2。", { retryPhase: "phase1" });
        throw new Error("缺少阶段1产物，无法重试阶段2。");
      }
      const assembledPhase2Message = buildSplitPhase2PromptMessage({
        systemInstruction,
        associatedPromptMarkdown: phase2AssociatedPrompt,
        phase1Tasks: latestPhase1Tasks,
        prdMarkdown: prdContentForPrompt,
        requirementsIndexJson: requirementsIndexContent.trim(),
      });
      appendSplitRuntimeLog("user", assembledPhase2Message);
      appendSplitRuntimeLog("system", "开始执行阶段2：任务溯源与锚点标注。");
      const phase2Run = await runPrdSplitClaude({
        projectPath: repositoryPath,
        runDir,
        prompt: assembledPhase2Message,
        timeoutMs: INITIAL_SPLIT_TIMEOUT_MS,
      });
      const phase2CodeText = explainClaudeSplitExitCode(phase2Run.exitCode);
      await readRuntimeLogDelta(true);
      if (phase2Run.exitCode !== 0) {
        appendSplitRuntimeLog("error", `阶段2执行失败：${phase2CodeText}`, { retryPhase: "phase2" });
        throw new Error(`阶段2执行失败：${phase2CodeText}`);
      }
      const phase2Raw = await readSnapshotFile(phase2Run.rawResultPath);
      appendSplitRuntimeLog("assistant", clipRuntimeLogText(phase2Raw));
      await finalizeTwoStageResult(phase2Raw);
    };

    splitStageRetryHandlersRef.current = {
      phase1: runPhase1Only,
      phase2: runPhase2Only,
    };

    try {
      await runPhase1Only();
      await runPhase2Only();
      message.success(
        `${sceneLabel}：Claude 双阶段执行完成，raw=${buildSnapshotAbsoluteDisplayPath(`${runDir}/split-result.raw.json`)}`,
      );
      if (splitExecutionOptions?.closeSplitWizardOnTwoStageSuccess) {
        setSplitPromptAdjustModalOpen(false);
        setSplitWizardStep("prompts");
        setSplitRuntimeVisible(false);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      message.warning(`${sceneLabel}：${msg}`);
    } finally {
      if (pollTimer != null) {
        window.clearTimeout(pollTimer);
      }
    }
  }

  async function handleParse(
    promptDraftOverrides?: SplitPromptDraftBySlot,
    options?: { splitRuntimeInModal?: boolean },
  ) {
    const meta = parse();
    if (!meta) return;
    const splitRuntimeInModal = options?.splitRuntimeInModal === true;
    if (splitRuntimeInModal) {
      setSplitWizardStep("runtime");
    }
    try {
      setParsing(true);
      const currentInputSnapshot = inputValue;
      const splitSourceInput = stripEmbeddedTaskAnchorsFromRequirementMarkdown(inputValue);
      const effectiveMeta = splitSourceInput !== inputValue ? parsePrdInput(splitSourceInput) : meta;
      let doc: PrdDocument;
      if (effectiveMeta.sourceType === "url" && effectiveMeta.rawUrl) {
        if (!originalInputValue && currentInputSnapshot.trim()) {
          setOriginalInputValue(currentInputSnapshot);
        }
        const fetched = await fetchPrdFromUrl(effectiveMeta.rawUrl);
        const normalized = normalizePrdDocument(effectiveMeta, fetched.content);
        doc = { ...normalized, title: fetched.title?.trim() || normalized.title };
      } else {
        doc = normalizePrdDocument(effectiveMeta);
      }
      setSplitError(null);
      resetSplitRuntimePanel("主编辑器拆分", { inModal: splitRuntimeInModal });

      const splitContext = buildPolicyAwareContext();
      logSplitInputPrepareBundle(doc, splitContext, "主编辑器 · 拆分");
      try {
        await runClaudeSplitExecution(
          doc,
          splitContext,
          "主编辑器拆分",
          splitSourceInput,
          "replace",
          promptDraftOverrides,
          splitRuntimeInModal ? { closeSplitWizardOnTwoStageSuccess: true } : undefined,
        );
      } catch (e) {
        const msg = toErrorMessage(e, "Claude 执行失败");
        message.warning(`主编辑器拆分：${msg}`);
      }
    } catch (err) {
      const nextError = toErrorMessage(err, "解析失败，请检查输入。");
      setSplitError(nextError);
      message.error(nextError);
    } finally {
      setParsing(false);
    }
  }

  async function handleSplitSelection() {
    const anchorDraft = milkdownEditorRef.current?.getSelectedAnchorDraft();
    if (!anchorDraft) {
      message.warning("请先在需求中选中一段内容（可含图片）。");
      return;
    }
    const md = milkdownEditorRef.current?.getSelectedMarkdown()?.trim();
    if (!md) {
      message.warning("选区为空，无法新增任务。");
      return;
    }
    try {
      setSplitError(null);
      const baseResult = activeResult
        ? activeResult
        : refreshSplitResultDerivedFields({
          source: prdDocumentFromMarkdownFragment(inputValue),
          context: buildPolicyAwareContext(),
          splitTasks: [],
          executableTasks: [],
          criticalPath: [],
          parallelGroups: [],
          unmetPreconditions: [],
        });
      const maxOrdinal = baseResult.splitTasks
        .map((task) => parseTaskNumericOrdinal(task.id))
        .reduce((max: number, current) => {
          if (current == null) return max;
          return current > max ? current : max;
        }, 0);
      const nextId = `task-${maxOrdinal + 1}`;
      const inferredRole: TaskRole =
        taskRoleFilter === "frontend" || taskRoleFilter === "backend" || taskRoleFilter === "document"
          ? taskRoleFilter
          : defaultTaskRoleForRepositoryType(baseResult.context?.repositoryType);
      const mappedRequirementIds = Array.from(requirementContentById.entries())
        .filter(([, content]) => includesLoosely(anchorDraft.text, content))
        .map(([id]) => id)
        .slice(0, 8);
      const anchorDescriptor = {
        from: Math.floor(anchorDraft.from),
        to: Math.floor(anchorDraft.to),
        mdFrom: Math.floor(anchorDraft.from),
        mdTo: Math.floor(anchorDraft.to),
        textHash: buildSelectionAnchorTextHash(
          anchorDraft.text,
          anchorDraft.from,
          anchorDraft.to,
          anchorDraft.contextBefore,
          anchorDraft.contextAfter,
        ),
        contextBefore: anchorDraft.contextBefore,
        contextAfter: anchorDraft.contextAfter,
      };
      const nextTask: TaskItem = {
        id: nextId,
        title: `任务 ${maxOrdinal + 1}`,
        description: anchorDraft.text,
        role: inferredRole,
        size: "M",
        estimateDays: estimateDaysFromSize("M"),
        dependencies: [],
        sourceRefs: [],
        sourceRequirementIds: mappedRequirementIds,
        subtasks: [],
        dod: [],
        executionStatus: "not_executable",
        executionStatusManual: false,
        flowStatus: "todo",
        taskAnchors: anchorDescriptor,
      };
      const nextResult = refreshSplitResultDerivedFields({
        ...baseResult,
        splitTasks: [nextTask, ...baseResult.splitTasks],
        taskAnchorDescriptors: {
          ...(baseResult.taskAnchorDescriptors ?? {}),
          [nextId]: anchorDescriptor,
        },
        taskAnchorTexts: {
          ...(baseResult.taskAnchorTexts ?? {}),
          [nextId]: anchorDraft.text,
        },
        taskAnchorPositions: {
          ...(baseResult.taskAnchorPositions ?? {}),
          [nextId]: { from: anchorDescriptor.from, to: anchorDescriptor.to },
        },
      });
      try {
        await savePrdTaskSplitResult(nextResult);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        message.error(`新增选区任务未能保存到数据库：${msg}`);
        return;
      }
      setActiveResult(nextResult);
      setTaskConfirmFilter("unconfirmed");
      setSelectedTaskId(nextId);
      setSelectedAnchorTaskId(nextId);
      requestAnimationFrame(() => scrollToTaskCard(nextId));
      message.success("已基于选中范围新增任务，并完成需求锚点映射。");
    } catch (err) {
      const nextError = toErrorMessage(err, "选中范围拆分失败。");
      setSplitError(nextError);
      message.error(nextError);
    }
  }

  function buildSplitContext(): TaskSplitContext {
    if (contextMode === "project") {
      return {
        mode: "project",
        projectId: linkedProject?.id ?? null,
        projectName: linkedProject?.name ?? null,
        repositoryId: linkedRepository?.id ?? null,
        repositoryName: linkedRepository?.name ?? null,
        repositoryPath: linkedRepository?.path ?? null,
        repositoryType: linkedRepository?.repositoryType ?? null,
      };
    }
    return {
      mode: "repository",
      projectId: linkedProject?.id ?? null,
      projectName: linkedProject?.name ?? null,
      repositoryId: linkedRepository?.id ?? null,
      repositoryName: linkedRepository?.name ?? null,
      repositoryPath: linkedRepository?.path ?? null,
      repositoryType: linkedRepository?.repositoryType ?? null,
    };
  }

  function buildPolicyAwareContext(): TaskSplitContext {
    return buildSplitContext();
  }

  function resetSplitRuntimePanel(title: string, options?: { inModal?: boolean }) {
    const inModal = options?.inModal === true;
    setSplitRuntimeVisible(!inModal);
    setRetryingPhase(null);
    splitStageRetryHandlersRef.current = {};
    setSplitRuntimeLogs([
      {
        id: `${Date.now()}-boot`,
        role: "system",
        text: `${title}：开始准备输入并执行 Claude（当前流程仅解析结果与日志展示，暂不自动落库）。`,
        at: Date.now(),
      },
    ]);
  }

  function appendSplitRuntimeLog(
    role: SplitRuntimeLogRole,
    text: string,
    options?: { retryPhase?: SplitRetryPhase },
  ) {
    const SPLIT_RUNTIME_LOG_LIMIT = 400;
    const content = text.trim();
    if (!content) return;
    setSplitRuntimeLogs((prev) => {
      const next = [
        ...prev,
        {
        id: `${Date.now()}-${prev.length + 1}`,
        role,
        text: content,
        at: Date.now(),
        retryPhase: options?.retryPhase,
        },
      ];
      if (next.length <= SPLIT_RUNTIME_LOG_LIMIT) {
        return next;
      }
      return next.slice(next.length - SPLIT_RUNTIME_LOG_LIMIT);
    });
  }

  async function handleRetrySplitStage(phase: SplitRetryPhase) {
    const handler = splitStageRetryHandlersRef.current[phase];
    if (!handler) {
      message.warning(`当前没有可重试的${phase === "phase1" ? "阶段1" : "阶段2"}上下文。`);
      return;
    }
    setRetryingPhase(phase);
    appendSplitRuntimeLog("system", `手动触发重试：${phase === "phase1" ? "阶段1" : "阶段2"}。`);
    try {
      await handler();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appendSplitRuntimeLog(
        "error",
        `${phase === "phase1" ? "阶段1" : "阶段2"}重试失败：${msg}`,
        { retryPhase: phase },
      );
    } finally {
      setRetryingPhase(null);
    }
  }

  function computeDefaultRepoAwarePromptMarkdown(): string {
    const ctx = buildSplitContext();
    if (activeResult) {
      const mergedContext: TaskSplitContext = {
        ...(activeResult.context ?? { mode: ctx.mode }),
        ...ctx,
        mode: ctx.mode,
      };
      return buildRepoAwarePromptSection({ ...activeResult, context: mergedContext });
    }
    return buildRepoAwarePromptSection(buildSyntheticSplitResultForRepoPrompt(ctx));
  }

  async function loadSplitPromptDraftsForEditing(): Promise<SplitPromptDraftBySlot> {
    const promptProjectId = linkedProjectId ?? null;
    const promptRepositoryId = linkedRepositoryId ?? null;
    const [rawRepoPrompts, effectivePhase1, effectivePhase2] = await Promise.all([
      promptRepositoryId ? loadRepositorySplitPromptLayers(promptRepositoryId) : Promise.resolve(null),
      resolveEffectiveSplitPromptTemplate(promptProjectId, promptRepositoryId, PROMPT_SLOT_PRD_TASK_SPLIT_PHASE1),
      resolveEffectiveSplitPromptTemplate(promptProjectId, promptRepositoryId, PROMPT_SLOT_PRD_TASK_SPLIT_PHASE2),
    ]);
    const slotMap = parsePromptStorageRaw(rawRepoPrompts);
    return {
      [PROMPT_SLOT_PRD_TASK_SPLIT_PHASE1]:
        slotMap[PROMPT_SLOT_PRD_TASK_SPLIT_PHASE1]?.systemBody?.trim() || effectivePhase1.systemBody,
      [PROMPT_SLOT_PRD_TASK_SPLIT_PHASE2]:
        slotMap[PROMPT_SLOT_PRD_TASK_SPLIT_PHASE2]?.systemBody?.trim() || effectivePhase2.systemBody,
    };
  }

  async function handleOpenRuntimePromptModal() {
    if (!linkedRepositoryId) {
      message.warning("请先在下方「项目 / 仓库」区域关联仓库，再查看拆分执行提示词。");
      return;
    }
    setRuntimePromptModalOpen(true);
    setRuntimePromptLoading(true);
    try {
      setRuntimePromptDraftBySlot(await loadSplitPromptDraftsForEditing());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      message.error(`加载拆分执行提示词失败：${msg}`);
    } finally {
      setRuntimePromptLoading(false);
    }
  }

  async function handleOpenSplitPromptAdjustModal() {
    setSplitWizardStep("prompts");
    setSplitPromptAdjustModalOpen(true);
    setSplitPromptAdjustLoading(true);
    try {
      setSplitPromptAdjustDraftBySlot(await loadSplitPromptDraftsForEditing());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      message.error(`加载拆分执行提示词失败：${msg}`);
    } finally {
      setSplitPromptAdjustLoading(false);
    }
  }

  function updateRuntimePromptDraft(slot: string, value: string) {
    setRuntimePromptDraftBySlot((prev) => ({ ...prev, [slot]: value }));
  }

  function getTaskAiMode(task: TaskItem): TaskAiMode {
    return taskAiModeById[task.id] ?? "optimize";
  }

  function getTaskAiInput(task: TaskItem, mode: TaskAiMode): string {
    return taskAiInputById[task.id]?.[mode] ?? TASK_AI_DEFAULT_PROMPT_BY_MODE[mode];
  }

  function ensureTaskAiInput(task: TaskItem, mode: TaskAiMode) {
    const next = getTaskAiInput(task, mode);
    setTaskAiInputById((prev) => {
      const currentTaskMap = prev[task.id] ?? {};
      if (currentTaskMap[mode] === next) return prev;
      return {
        ...prev,
        [task.id]: {
          ...currentTaskMap,
          [mode]: next,
        },
      };
    });
  }

  function openTaskAiPopover(task: TaskItem, mode: TaskAiMode) {
    setTaskAnchorPopoverTaskId(null);
    setTaskAiModeById((prev) => ({ ...prev, [task.id]: mode }));
    ensureTaskAiInput(task, mode);
    if (mode === "optimize") {
      setTaskAiOptimizedReadyById((prev) => ({ ...prev, [task.id]: false }));
      setTaskAiOptimizedContentById((prev) => ({ ...prev, [task.id]: "" }));
    }
    setTaskAiPopoverMode(mode);
    setTaskAiPopoverTaskId(task.id);
  }

  async function handleSaveRuntimePromptDraft() {
    if (runtimePromptOptimizingSlot) return;
    if (!linkedRepositoryId) return;
    const currentDraft = runtimePromptDraftBySlot[runtimePromptSlot]?.trim() ?? "";
    if (!currentDraft) {
      message.warning("提示词不能为空。");
      return;
    }
    setRuntimePromptSaving(true);
    try {
      const currentRaw = await loadRepositorySplitPromptLayers(linkedRepositoryId);
      const map = parsePromptStorageRaw(currentRaw);
      map[runtimePromptSlot] = {
        ...(map[runtimePromptSlot] ?? {}),
        enabled: true,
        systemBody: currentDraft,
      };
      await saveRepositorySplitPromptLayers(
        linkedRepositoryId,
        JSON.stringify({ schemaVersion: 2, prompts: map }, null, 2),
      );
      message.success("已保存拆分执行提示词。");
      setRuntimePromptModalOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      message.error(`保存失败：${msg}`);
    } finally {
      setRuntimePromptSaving(false);
    }
  }

  async function handleSaveSplitPromptAdjustDrafts() {
    if (splitPromptOptimizingSlot) return;
    if (!linkedRepositoryId) {
      message.warning("请先在下方「项目 / 仓库」区域关联仓库，再保存拆分执行提示词。");
      return;
    }
    const phase1Draft = splitPromptAdjustDraftBySlot[PROMPT_SLOT_PRD_TASK_SPLIT_PHASE1]?.trim() ?? "";
    const phase2Draft = splitPromptAdjustDraftBySlot[PROMPT_SLOT_PRD_TASK_SPLIT_PHASE2]?.trim() ?? "";
    if (!phase1Draft || !phase2Draft) {
      message.warning("阶段1和阶段2提示词不能为空。");
      return;
    }
    setSplitPromptAdjustSaving(true);
    try {
      const currentRaw = await loadRepositorySplitPromptLayers(linkedRepositoryId);
      const map = parsePromptStorageRaw(currentRaw);
      map[PROMPT_SLOT_PRD_TASK_SPLIT_PHASE1] = {
        ...(map[PROMPT_SLOT_PRD_TASK_SPLIT_PHASE1] ?? {}),
        enabled: true,
        systemBody: phase1Draft,
      };
      map[PROMPT_SLOT_PRD_TASK_SPLIT_PHASE2] = {
        ...(map[PROMPT_SLOT_PRD_TASK_SPLIT_PHASE2] ?? {}),
        enabled: true,
        systemBody: phase2Draft,
      };
      await saveRepositorySplitPromptLayers(
        linkedRepositoryId,
        JSON.stringify({ schemaVersion: 2, prompts: map }, null, 2),
      );
      message.success("已保存拆分执行提示词。");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      message.error(`保存失败：${msg}`);
    } finally {
      setSplitPromptAdjustSaving(false);
    }
  }

  async function handleStartSplitFromAdjustModal() {
    if (splitPromptOptimizingSlot) return;
    const phase1Draft = splitPromptAdjustDraftBySlot[PROMPT_SLOT_PRD_TASK_SPLIT_PHASE1]?.trim() ?? "";
    const phase2Draft = splitPromptAdjustDraftBySlot[PROMPT_SLOT_PRD_TASK_SPLIT_PHASE2]?.trim() ?? "";
    if (!phase1Draft || !phase2Draft) {
      message.warning("阶段1和阶段2提示词不能为空。");
      return;
    }
    setSplitPromptAdjustStarting(true);
    try {
      await handleParse(
        {
          [PROMPT_SLOT_PRD_TASK_SPLIT_PHASE1]: phase1Draft,
          [PROMPT_SLOT_PRD_TASK_SPLIT_PHASE2]: phase2Draft,
        },
        { splitRuntimeInModal: true },
      );
    } finally {
      setSplitPromptAdjustStarting(false);
    }
  }

  async function handleOptimizeSplitPromptDraft(slot: typeof PROMPT_SLOT_PRD_TASK_SPLIT_PHASE1 | typeof PROMPT_SLOT_PRD_TASK_SPLIT_PHASE2) {
    if (splitPromptOptimizingSlot || splitPromptAdjustSaving || splitPromptAdjustStarting) return;
    const currentDraft = splitPromptAdjustDraftBySlot[slot]?.trim() ?? "";
    if (!currentDraft) {
      message.warning("当前阶段提示词为空，无法优化。");
      return;
    }
    const projectPath = linkedRepository?.path ?? activeResult?.context?.repositoryPath ?? null;
    if (!projectPath) {
      message.warning("未关联仓库，无法执行 AI 优化。");
      return;
    }
    const slotLabel = slot === PROMPT_SLOT_PRD_TASK_SPLIT_PHASE1 ? "阶段1（拆分）" : "阶段2（溯源）";
    const optimizeSnapshot = await materializePrdSnapshot(
      projectPath,
      `# Prompt Optimize\n\nslot=${slot}\n\nts=${Date.now()}\n`,
      null,
      null,
      null,
      null,
    );
    const runDir = dirnameFromAbsolutePath(optimizeSnapshot.prdRelativePath);
    const optimizePrompt = [
      "你是提示词优化专家，请优化下面的提示词。",
      "",
      "执行边界（必须遵守）：",
      "- 不要读取本地仓库、目录或任何文件；",
      "- 不要使用 @文件、路径探测、工具调用结果等外部上下文；",
      "- 仅基于本次提供的“原始提示词”文本进行改写与精简。",
      "",
      "目标：",
      "1) 保留原始意图与约束，不改变任务目标；",
      "2) 精简冗余表达，提升结构清晰度与可执行性；",
      "3) 输出内容必须是可直接替换的提示词正文（Markdown 文本），不要解释。",
      "",
      `当前阶段：${slotLabel}`,
      "",
      "原始提示词：",
      "```markdown",
      currentDraft,
      "```",
      "",
      "请直接输出优化后的提示词正文，不要输出代码块标记。",
    ].join("\n");
    setSplitPromptOptimizingSlot(slot);
    try {
      const run = await runPrdSplitClaude({
        projectPath,
        runDir,
        prompt: optimizePrompt,
      });
      const raw = await readSnapshotFile(run.rawResultPath).catch(() => "");
      const cleaned = raw
        .replace(/^```[a-zA-Z]*\s*/g, "")
        .replace(/```$/g, "")
        .trim();
      if (!cleaned) {
        message.warning("AI 优化未返回有效内容。");
        return;
      }
      setSplitPromptAdjustDraftBySlot((prev) => ({
        ...prev,
        [slot]: cleaned,
      }));
      message.success(`${slotLabel} 提示词已完成 AI 优化。`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      message.error(`AI 优化失败：${msg}`);
    } finally {
      setSplitPromptOptimizingSlot(null);
    }
  }

  async function handleOptimizeRuntimePromptDraft(
    slot: typeof PROMPT_SLOT_PRD_TASK_SPLIT_PHASE1 | typeof PROMPT_SLOT_PRD_TASK_SPLIT_PHASE2,
  ) {
    if (runtimePromptOptimizingSlot || runtimePromptSaving || runtimePromptLoading) return;
    const currentDraft = runtimePromptDraftBySlot[slot]?.trim() ?? "";
    if (!currentDraft) {
      message.warning("当前阶段提示词为空，无法优化。");
      return;
    }
    const projectPath = linkedRepository?.path ?? activeResult?.context?.repositoryPath ?? null;
    if (!projectPath) {
      message.warning("未关联仓库，无法执行 AI 优化。");
      return;
    }
    const slotLabel = slot === PROMPT_SLOT_PRD_TASK_SPLIT_PHASE1 ? "阶段1（拆分）" : "阶段2（溯源）";
    const optimizeSnapshot = await materializePrdSnapshot(
      projectPath,
      `# Prompt Optimize\n\nslot=${slot}\n\nts=${Date.now()}\n`,
      null,
      null,
      null,
      null,
    );
    const runDir = dirnameFromAbsolutePath(optimizeSnapshot.prdRelativePath);
    const optimizePrompt = [
      "你是提示词优化专家，请优化下面的提示词。",
      "",
      "执行边界（必须遵守）：",
      "- 不要读取本地仓库、目录或任何文件；",
      "- 不要使用 @文件、路径探测、工具调用结果等外部上下文；",
      "- 仅基于本次提供的“原始提示词”文本进行改写与精简。",
      "",
      "目标：",
      "1) 保留原始意图与约束，不改变任务目标；",
      "2) 精简冗余表达，提升结构清晰度与可执行性；",
      "3) 输出内容必须是可直接替换的提示词正文（Markdown 文本），不要解释。",
      "",
      `当前阶段：${slotLabel}`,
      "",
      "原始提示词：",
      "```markdown",
      currentDraft,
      "```",
      "",
      "请直接输出优化后的提示词正文，不要输出代码块标记。",
    ].join("\n");
    setRuntimePromptOptimizingSlot(slot);
    try {
      const run = await runPrdSplitClaude({
        projectPath,
        runDir,
        prompt: optimizePrompt,
      });
      const raw = await readSnapshotFile(run.rawResultPath).catch(() => "");
      const cleaned = raw
        .replace(/^```[a-zA-Z]*\s*/g, "")
        .replace(/```$/g, "")
        .trim();
      if (!cleaned) {
        message.warning("AI 优化未返回有效内容。");
        return;
      }
      setRuntimePromptDraftBySlot((prev) => ({
        ...prev,
        [slot]: cleaned,
      }));
      message.success(`${slotLabel} 提示词已完成 AI 优化。`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      message.error(`AI 优化失败：${msg}`);
    } finally {
      setRuntimePromptOptimizingSlot(null);
    }
  }

  async function handleOptimizeTaskContent(task: TaskItem, currentPrompt: string) {
    if (taskAiActionLoadingById[task.id]) return;
    const currentTaskContent = (pendingTaskContentById[task.id] ?? taskToMarkdown(getDraftedTask(task))).trim();
    if (!currentTaskContent) {
      message.warning("当前任务内容为空，无法执行优化。");
      return;
    }
    const projectPath = linkedRepository?.path ?? activeResult?.context?.repositoryPath ?? null;
    if (!projectPath) {
      message.warning("未关联仓库，无法执行 AI 优化。");
      return;
    }
    const optimizeSnapshot = await materializePrdSnapshot(
      projectPath,
      `# Task Optimize\n\ntaskId=${task.id}\n\nts=${Date.now()}\n`,
      null,
      null,
      null,
      null,
    );
    const runDir = dirnameFromAbsolutePath(optimizeSnapshot.prdRelativePath);
    const optimizePrompt = [
      "你是研发任务优化专家，请优化下面的任务内容。",
      "",
      "执行边界（必须遵守）：",
      "- 不要读取本地仓库、目录或任何文件；",
      "- 不要使用 @文件、路径探测、工具调用结果等外部上下文；",
      "- 仅基于本次提供的“任务内容”文本进行改写与精简。",
      "",
      "优化目标：",
      "1) 保留任务目标、边界与验收意图，不改变原始业务方向；",
      "2) 精简冗余表述，结构化输出，突出可执行步骤；",
      "3) 输出必须是可直接替换的任务正文（Markdown），不要解释。",
      "",
      "任务项内容：",
      "```markdown",
      currentTaskContent,
      "```",
      "",
      "用户补充提示词：",
      "```markdown",
      currentPrompt,
      "```",
      "",
      "请直接输出优化后的任务正文，不要输出代码块标记。",
    ].join("\n");
    setTaskAiActionLoadingById((prev) => ({ ...prev, [task.id]: "optimize" }));
    try {
      const run = await runPrdSplitClaude({
        projectPath,
        runDir,
        prompt: optimizePrompt,
      });
      const raw = await readSnapshotFile(run.rawResultPath).catch(() => "");
      const cleaned = raw
        .replace(/^```[a-zA-Z]*\s*/g, "")
        .replace(/```$/g, "")
        .trim();
      if (!cleaned) {
        message.warning("AI 优化未返回有效内容。");
        return;
      }
      setTaskAiOptimizedContentById((prev) => ({ ...prev, [task.id]: cleaned }));
      setTaskAiOptimizedReadyById((prev) => ({ ...prev, [task.id]: true }));
      message.success("已生成优化内容，请确认后保存。");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      message.error(`任务内容优化失败：${msg}`);
    } finally {
      setTaskAiActionLoadingById((prev) => ({ ...prev, [task.id]: null }));
    }
  }

  async function handleSaveOptimizedTaskContent(task: TaskItem) {
    const optimized = taskAiOptimizedContentById[task.id]?.trim() ?? "";
    const ready = taskAiOptimizedReadyById[task.id] ?? false;
    if (!ready || !optimized) {
      message.warning("请先执行优化后再保存。");
      return;
    }
    if (!activeResult) return;
    const base = activeResult.splitTasks.find((item) => item.id === task.id);
    if (!base) return;
    setTaskAiSavingTaskId(task.id);
    try {
      const parsed = parseTaskMarkdownDraft(optimized);
      const draftedBase = buildTaskFromDraft(base);
      const mergedSelf: TaskItem = {
        ...draftedBase,
        description: parsed.description,
        subtasks: parsed.subtasks,
        dod: parsed.dod,
        apiSpec: pendingTaskApiSpecById[task.id] ?? parsed.apiSpec ?? draftedBase.apiSpec,
      };
      const nextTasks = activeResult.splitTasks.map((item) => (item.id === task.id ? mergedSelf : item));
      const out = refreshSplitResultDerivedFields({ ...activeResult, splitTasks: nextTasks });
      await savePrdTaskSplitResult(out);
      setActiveResult(out);
      stripPendingStateForTask(task.id);
      message.success("任务优化成功。");
      setTaskAiPopoverTaskId(null);
      setTaskAiPopoverMode(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      message.error(`任务优化保存失败：${msg}`);
    } finally {
      setTaskAiSavingTaskId(null);
    }
  }

  async function handleCheckTaskExecutable(task: TaskItem, currentPrompt: string) {
    if (taskAiActionLoadingById[task.id]) return;
    const currentTaskContent = (pendingTaskContentById[task.id] ?? taskToMarkdown(getDraftedTask(task))).trim();
    if (!currentTaskContent) {
      message.warning("当前任务内容为空，无法执行可执行检测。");
      return;
    }
    const projectPath = linkedRepository?.path ?? activeResult?.context?.repositoryPath ?? null;
    if (!projectPath) {
      message.warning("未关联仓库，无法执行可执行检测。");
      return;
    }
    const repoContextMarkdown = computeDefaultRepoAwarePromptMarkdown();
    const checkSnapshot = await materializePrdSnapshot(
      projectPath,
      `# Task Executable Check\n\ntaskId=${task.id}\n\nts=${Date.now()}\n`,
      null,
      null,
      null,
      null,
    );
    const runDir = dirnameFromAbsolutePath(checkSnapshot.prdRelativePath);
    const checkPrompt = [
      "你是技术负责人，请评估任务是否具备可执行前置条件。",
      "",
      "执行要求：",
      "- 可以使用下面提供的“仓库上下文摘要”，但不要读取任何额外本地文件；",
      "- 仅基于提供内容判断，不要猜测仓库中未给出的实现细节。",
      "",
      "请输出 Markdown，包含以下小节：",
      "## 可执行结论",
      "- 仅输出：可执行 / 不可执行 / 有风险可执行",
      "## 缺失前置条件",
      "- 逐条列出缺失项（若无则写“无”）",
      "## 建议补充",
      "- 给出可落地补充建议，按优先级排序",
      "",
      "仓库上下文摘要：",
      "```markdown",
      repoContextMarkdown,
      "```",
      "",
      "任务项内容：",
      "```markdown",
      currentTaskContent,
      "```",
      "",
      "用户补充提示词：",
      "```markdown",
      currentPrompt,
      "```",
    ].join("\n");
    setTaskAiActionLoadingById((prev) => ({ ...prev, [task.id]: "check" }));
    try {
      const run = await runPrdSplitClaude({
        projectPath,
        runDir,
        prompt: checkPrompt,
      });
      const raw = await readSnapshotFile(run.rawResultPath).catch(() => "");
      const cleaned = raw
        .replace(/^```[a-zA-Z]*\s*/g, "")
        .replace(/```$/g, "")
        .trim();
      if (!cleaned) {
        message.warning("可执行检测未返回有效内容。");
        return;
      }
      setTaskExecutableCheckResultById((prev) => ({ ...prev, [task.id]: cleaned }));
      message.success("可执行检测完成。");
      setTaskAiPopoverTaskId(null);
      setTaskAiPopoverMode(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      message.error(`可执行检测失败：${msg}`);
    } finally {
      setTaskAiActionLoadingById((prev) => ({ ...prev, [task.id]: null }));
    }
  }

  async function handleResetRuntimePromptToDefault() {
    if (!linkedRepositoryId) return;
    setRuntimePromptSaving(true);
    try {
      const currentRaw = await loadRepositorySplitPromptLayers(linkedRepositoryId);
      const map = parsePromptStorageRaw(currentRaw);
      delete map[runtimePromptSlot];
      if (Object.keys(map).length === 0) {
        await clearRepositorySplitPromptLayers(linkedRepositoryId);
      } else {
        await saveRepositorySplitPromptLayers(
          linkedRepositoryId,
          JSON.stringify({ schemaVersion: 2, prompts: map }, null, 2),
        );
      }
      const effective = await resolveEffectiveSplitPromptTemplate(
        linkedProjectId ?? null,
        linkedRepositoryId,
        runtimePromptSlot,
      );
      updateRuntimePromptDraft(runtimePromptSlot, effective.systemBody);
      message.success("已恢复默认提示词。");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      message.error(`恢复默认失败：${msg}`);
    } finally {
      setRuntimePromptSaving(false);
    }
  }

  function estimateDaysFromSize(size: TaskSize): number {
    if (size === "S") return 1;
    if (size === "M") return 2;
    return 4;
  }

  function resetRequirementTaskView() {
    setActiveResult(null);
    setSelectedTaskId(null);
    setSelectedAnchorTaskId(null);
    setSplitError(null);
    setTaskConfirmFilter("unconfirmed");
    setTaskRoleFilter("all");
  }

  async function loadTaskResultForActiveRequirement(requirementId: string | null) {
    setPrdTaskSplitRequirementScope(requirementId);
    if (!requirementId) {
      resetRequirementTaskView();
      return;
    }
    const stored = await loadPrdTaskSplitResult();
    if (!stored) {
      resetRequirementTaskView();
      return;
    }
    const migrated = migrateStoredSplitResult(stored);
    setActiveResult(migrated);
    setTaskConfirmFilter(defaultTaskConfirmFilterByTasks(migrated.splitTasks));
    setSelectedTaskId(migrated.splitTasks[0]?.id ?? null);
    setSelectedAnchorTaskId(null);
  }

  function buildRequirementFromCurrent(
    id: string,
    name: string,
    createdAt: number,
    updatedAt: number,
    isPinned = false,
  ): PrdRequirementHistoryItem {
    return {
      id,
      requirementDisplayName: name.trim(),
      isPinned,
      inputValue,
      originalInputValue,
      contextMode,
      linkedProjectId,
      linkedRepositoryId,
      createdAt,
      updatedAt,
    };
  }

  async function persistRequirementHistory(
    nextHistory: PrdRequirementHistoryItem[],
    nextActiveRequirementId: string | null,
    showNotice = false,
  ) {
    const selected = nextActiveRequirementId
      ? nextHistory.find((item) => item.id === nextActiveRequirementId) ?? null
      : null;
    const noActive = !nextActiveRequirementId || !selected;
    const projectDraftScope = activeProjectId?.trim() || linkedProjectId?.trim() || null;
    await savePrdDraft(projectDraftScope, {
      inputValue: selected?.inputValue ?? (noActive ? "" : inputValue),
      originalInputValue: selected?.originalInputValue ?? (noActive ? null : originalInputValue),
      contextMode: selected?.contextMode ?? contextMode,
      linkedProjectId: selected?.linkedProjectId ?? linkedProjectId,
      linkedRepositoryId: selected?.linkedRepositoryId ?? linkedRepositoryId,
      requirementDisplayName: selected?.requirementDisplayName ?? (noActive ? null : requirementDisplayName),
      currentRequirementId: nextActiveRequirementId,
      requirements: nextHistory,
    });
    if (showNotice) message.success("需求编辑已保存");
  }

  function handleDeleteActiveRequirement() {
    if (!activeRequirementId) {
      message.warning("请先选择要删除的需求");
      return;
    }
    const target = requirementHistoryById.get(activeRequirementId);
    if (!target) return;
    Modal.confirm({
      title: "删除需求",
      content: `确定删除「${target.requirementDisplayName}」吗？删除后不可恢复。`,
      okText: "删除",
      okType: "danger",
      cancelText: "取消",
      onOk: () => {
        void (async () => {
          const nextHistory = requirementHistory.filter((item) => item.id !== activeRequirementId);
          const nextActive = (
            [...nextHistory].sort((a, b) => {
              const pinA = a.isPinned ? 1 : 0;
              const pinB = b.isPinned ? 1 : 0;
              if (pinA !== pinB) return pinB - pinA;
              return b.updatedAt - a.updatedAt;
            })[0] ?? null
          );
          const nextActiveId = nextActive?.id ?? null;
          setRequirementHistory(nextHistory);
          setActiveRequirementId(nextActiveId);
          if (!nextActiveId) {
            setInputValue("");
            setOriginalInputValue(null);
            setRequirementDisplayName(null);
            resetRequirementTaskView();
          } else {
            switchToRequirement(nextActive);
          }
          await persistRequirementHistory(nextHistory, nextActiveId, false);
          message.success("已删除需求");
        })();
      },
    });
  }

  function handlePinActiveRequirement() {
    if (!activeRequirementId) {
      message.warning("请先选择要置顶的需求");
      return;
    }
    const target = requirementHistoryById.get(activeRequirementId);
    if (!target) return;
    if (target.isPinned) {
      message.info("该需求已置顶。");
      return;
    }
    const now = Date.now();
    const nextHistory = requirementHistory.map((item) => {
      if (item.id === activeRequirementId) {
        return { ...item, isPinned: true, updatedAt: now };
      }
      if (item.isPinned) {
        return { ...item, isPinned: false };
      }
      return item;
    });
    setRequirementHistory(nextHistory);
    void persistRequirementHistory(nextHistory, activeRequirementId, false).then(() => {
      message.success("已置顶当前需求。");
    });
  }

  async function handleUserPersistPrdDraft() {
    if (!hasInput) return;
    if (!activeRequirementId) {
      setRequirementNameModalMode("save");
      setRequirementNameInput("");
      setRequirementNameModalOpen(true);
      return;
    }
    const now = Date.now();
    const nextHistory = requirementHistory.map((item) => (
      item.id === activeRequirementId
        ? buildRequirementFromCurrent(
          item.id,
          (requirementDisplayName?.trim() || item.requirementDisplayName),
          item.createdAt,
          now,
          item.isPinned ?? false,
        )
        : item
    ));
    setRequirementHistory(nextHistory);
    await persistRequirementHistory(nextHistory, activeRequirementId, true);
  }

  function switchToRequirement(record: PrdRequirementHistoryItem) {
    setActiveRequirementId(record.id);
    setRequirementDisplayName(record.requirementDisplayName);
    setInputValue(record.inputValue);
    setOriginalInputValue(record.originalInputValue ?? null);
    setContextMode(record.contextMode);
    setLinkedProjectId(record.linkedProjectId);
    setLinkedRepositoryId(record.linkedRepositoryId);
  }

  async function handleCreateRequirementByName(name: string) {
    const now = Date.now();
    const id = createRequirementHistoryId();
    const created: PrdRequirementHistoryItem = {
      id,
      requirementDisplayName: name.trim(),
      isPinned: false,
      inputValue: "",
      originalInputValue: null,
      contextMode,
      linkedProjectId,
      linkedRepositoryId,
      createdAt: now,
      updatedAt: now,
    };
    const nextHistory = [created, ...requirementHistory];
    setRequirementHistory(nextHistory);
    setActiveRequirementId(id);
    setRequirementDisplayName(created.requirementDisplayName);
    setInputValue("");
    setOriginalInputValue(null);
    resetRequirementTaskView();
    await persistRequirementHistory(nextHistory, id, false);
  }

  async function handleConfirmRequirementNameModal() {
    const name = requirementNameInput.trim();
    if (!name) {
      message.warning("请填写需求名称");
      return;
    }
    setRequirementNameSaving(true);
    try {
      if (requirementNameModalMode === "create") {
        await handleCreateRequirementByName(name);
      } else {
        const now = Date.now();
        const id = activeRequirementId ?? createRequirementHistoryId();
        const createdAt = activeRequirement?.createdAt ?? now;
        const nextCurrent = buildRequirementFromCurrent(id, name, createdAt, now, activeRequirement?.isPinned ?? false);
        const nextHistory = (() => {
          const others = requirementHistory.filter((item) => item.id !== id);
          return [nextCurrent, ...others];
        })();
        setRequirementHistory(nextHistory);
        setActiveRequirementId(id);
        setRequirementDisplayName(name);
        await persistRequirementHistory(nextHistory, id, true);
      }
      setRequirementNameModalOpen(false);
    } finally {
      setRequirementNameSaving(false);
    }
  }

  function appendMarkdownSnippet(snippet: string) {
    setInputValue((prev) => {
      const base = prev.trimEnd();
      return `${base}\n\n${snippet}\n`;
    });
  }

  async function handlePasteImage(e: React.ClipboardEvent<HTMLDivElement>) {
    const imageItem = Array.from(e.clipboardData.items).find((item) => item.type.startsWith("image/"));
    if (!imageItem) return;
    const file = imageItem.getAsFile();
    if (!file) return;
    e.preventDefault();
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (!result) return;
      const ext = file.type.split("/")[1] || "png";
      const filename = `pasted-image-${Date.now()}.${ext}`;
      const repositoryPath = linkedRepository?.path ?? activeResult?.context?.repositoryPath ?? "__unknown_repository__";
      void (async () => {
        const imageUrl = await savePrdPastedImage(
          repositoryPath,
          linkedRepository?.name ?? null,
          linkedRepository?.id ?? null,
          linkedProject?.name ?? null,
          linkedProject?.id ?? null,
          filename,
          result,
        );
        if (imageUrl) {
          if (milkdownEditorRef.current) {
            milkdownEditorRef.current.insertImage({ src: imageUrl, alt: filename, title: filename });
          } else {
            appendMarkdownSnippet(`![${filename}](${imageUrl})`);
          }
          message.success("图片已保存到 ~/.wise 并插入引用。");
          return;
        }
        appendMarkdownSnippet(`![${filename}](${result})`);
        message.warning("图片落盘失败，已回退为内嵌图片。");
      })();
    };
    reader.readAsDataURL(file);
  }

  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleUserPersistPrdDraft();
      }
      if (e.key === "Enter") {
        if (splitPromptAdjustModalOpen) return;
        e.preventDefault();
        void handleParse();
      }
    }
    window.addEventListener("keydown", handleKeydown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeydown, { capture: true });
  }, [
    activeRequirementId,
    activeRequirement?.createdAt,
    hasInput,
    inputValue,
    originalInputValue,
    contextMode,
    linkedProjectId,
    linkedRepositoryId,
    requirementDisplayName,
    requirementHistory,
    requirementNameModalMode,
    splitPromptAdjustModalOpen,
  ]);

  function getDraftedTask(task: TaskItem): TaskItem {
    const draftSize = pendingTaskSizeById[task.id];
    const draftApiSpec = pendingTaskApiSpecById[task.id];
    return {
      ...task,
      size: draftSize ?? task.size,
      estimateDays: draftSize ? estimateDaysFromSize(draftSize) : task.estimateDays,
      apiSpec: draftApiSpec ?? task.apiSpec,
    };
  }

  function getTaskEffectiveForGaps(task: TaskItem): TaskItem {
    return buildTaskFromDraft(task);
  }

  function parseTaskMarkdownDraft(markdown: string): Pick<TaskItem, "description" | "subtasks" | "dod"> & { apiSpec?: TaskApiSpec } {
    const lines = markdown.split(/\r?\n/);
    type Section = "none" | "description" | "api" | "subtasks" | "dod";
    let section: Section = "none";
    const descriptionLines: string[] = [];
    const apiLines: string[] = [];
    const subtaskLines: string[] = [];
    const dodLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (/^####\s*任务内容/.test(trimmed)) {
        section = "description";
        continue;
      }
      if (/^####\s*接口协议/.test(trimmed)) {
        section = "api";
        continue;
      }
      if (/^####\s*子任务/.test(trimmed)) {
        section = "subtasks";
        continue;
      }
      if (/^####\s*验收标准/.test(trimmed)) {
        section = "dod";
        continue;
      }
      if (section === "description") descriptionLines.push(line);
      if (section === "api") apiLines.push(line);
      if (section === "subtasks") subtaskLines.push(line);
      if (section === "dod") dodLines.push(line);
    }

    const toList = (source: string[]): string[] =>
      source
        .map((line) => line.replace(/^\s*[-*]\s+/, "").trim())
        .filter((line) => line.length > 0);

    const pickApi = (label: string): string => {
      const row = apiLines.find((line) => new RegExp(`^\\s*[-*]?\\s*${label}\\s*[：:]`).test(line.trim()));
      if (!row) return "";
      return row.replace(new RegExp(`^\\s*[-*]?\\s*${label}\\s*[：:]\\s*`), "").trim();
    };

    const methodRaw = pickApi("请求方法").toUpperCase();
    const method = API_METHOD_OPTIONS.find((item) => item === methodRaw) ?? "POST";
    const endpoint = pickApi("接口路径");
    const requestSchema = pickApi("请求定义");
    const responseSchema = pickApi("响应定义");
    const errorCodesRaw = pickApi("错误码");
    const errorCodes = errorCodesRaw
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0 && item !== "无");
    const hasApiSpec = [endpoint, requestSchema, responseSchema, errorCodesRaw].some((item) => item.trim().length > 0);

    return {
      description: descriptionLines.join("\n").trim(),
      subtasks: toList(subtaskLines),
      dod: toList(dodLines),
      apiSpec: hasApiSpec
        ? {
          endpoint,
          method,
          requestSchema,
          responseSchema,
          errorCodes,
        }
        : undefined,
    };
  }

  function buildTaskFromDraft(task: TaskItem): TaskItem {
    const draftedTask = getDraftedTask(task);
    const markdownDraft = pendingTaskContentById[task.id] ?? taskToMarkdown(draftedTask);
    const parsed = parseTaskMarkdownDraft(markdownDraft);
    return {
      ...draftedTask,
      description: parsed.description,
      subtasks: parsed.subtasks,
      dod: parsed.dod,
      apiSpec: pendingTaskApiSpecById[task.id] ?? parsed.apiSpec ?? draftedTask.apiSpec,
    };
  }

  function sameApiSpec(a: TaskApiSpec | undefined, b: TaskApiSpec | undefined): boolean {
    if (!a && !b) return true;
    if (!a || !b) return false;
    if (a.endpoint !== b.endpoint) return false;
    if (a.method !== b.method) return false;
    if (a.requestSchema !== b.requestSchema) return false;
    if (a.responseSchema !== b.responseSchema) return false;
    if (a.errorCodes.length !== b.errorCodes.length) return false;
    for (let i = 0; i < a.errorCodes.length; i += 1) {
      if (a.errorCodes[i] !== b.errorCodes[i]) return false;
    }
    return true;
  }

  function hasTaskDraftChanges(task: TaskItem): boolean {
    const merged = buildTaskFromDraft(task);
    if (merged.description !== task.description) return true;
    if (!sameStringArray(merged.subtasks, task.subtasks)) return true;
    if (!sameStringArray(merged.dod, task.dod)) return true;
    if (!sameApiSpec(merged.apiSpec, task.apiSpec)) return true;
    if (merged.size !== task.size) return true;
    return false;
  }

  /** 仅本任务字段与依赖链上的缺口，用于卡片底部红框（拆分级问题见下方汇总卡片）。 */
  function cardUnmetPointsForTask(task: TaskItem): string[] {
    if (!activeResult) return [];
    const peers = activeResult.splitTasks.map(getTaskEffectiveForGaps);
    const self = peers.find((t) => t.id === task.id);
    if (!self) return [];
    return computeTaskUnmetPoints(self, activeResult.context, peers);
  }

  function displayExecutionStatus(task: TaskItem): TaskExecutionStatus {
    return task.executionStatus ?? "not_executable";
  }

  function stripPendingStateForTask(taskId: string) {
    setPendingTaskSizeById((prev) => {
      const next = { ...prev };
      delete next[taskId];
      return next;
    });
    setPendingTaskApiSpecById((prev) => {
      const next = { ...prev };
      delete next[taskId];
      return next;
    });
    setPendingTaskContentById((prev) => {
      const next = { ...prev };
      delete next[taskId];
      return next;
    });
    if (confirmSavingTaskId === taskId) {
      setConfirmSavingTaskId(null);
    }
  }

  function handleDeleteTask(taskId: string) {
    if (!activeResult) return;
    if (activeResult.splitTasks.length <= 1) {
      message.warning("至少保留一条任务。");
      return;
    }
    const taskLabel = taskId;
    Modal.confirm({
      title: "删除该任务？",
      content: `将删除「${taskLabel}」（${taskId}）。其它任务中指向它的依赖会被自动移除，并立即写入数据库。`,
      okText: "删除",
      okType: "danger",
      cancelText: "取消",
      onOk: async () => {
        const out = removeTaskFromSplitResult(activeResult, taskId);
        try {
          await savePrdTaskSplitResult(out);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          message.error(`删除后未能保存到数据库：${msg}`);
          throw err;
        }
        stripPendingStateForTask(taskId);
        setActiveResult(out);
        if (selectedTaskId === taskId) {
          setSelectedTaskId(out.splitTasks[0]?.id ?? null);
        }
        message.success("已删除任务并保存。");
      },
    });
  }

  function handleClearAllTasks() {
    if (!activeResult) return;
    Modal.confirm({
      title: "清空所有任务？",
      content: "将删除当前拆分结果中的全部任务，并清空映射与锚点信息。该操作会立即写入数据库。",
      okText: "清空",
      okType: "danger",
      cancelText: "取消",
      onOk: async () => {
        const out = refreshSplitResultDerivedFields({
          ...activeResult,
          splitTasks: [],
          executableTasks: [],
          claudeSplitMapping: undefined,
          taskAnchorDescriptors: undefined,
          taskAnchorTexts: undefined,
          taskAnchorPositions: undefined,
        });
        try {
          await savePrdTaskSplitResult(out);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          message.error(`清空任务未能保存到数据库：${msg}`);
          throw err;
        }
        setPendingTaskSizeById({});
        setPendingTaskContentById({});
        setPendingTaskApiSpecById({});
        setConfirmSavingTaskId(null);
        setActiveResult(out);
        setSelectedTaskId(null);
        setTaskConfirmFilter("unconfirmed");
        setTaskRoleFilter("all");
        message.success("已清空所有任务并保存。");
      },
    });
  }

  async function persistConfirmedTaskAdjustment(taskId: string, out: SplitResult, allGaps: string[]) {
    setConfirmSavingTaskId(taskId);
    try {
      await savePrdTaskSplitResult(out);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      message.error(`确认结果未能写入数据库，请重试：${msg}`);
      return;
    } finally {
      setConfirmSavingTaskId(null);
    }

    stripPendingStateForTask(taskId);
    setActiveResult(out);

    if (allGaps.length > 0) {
      message.warning(`已确认并写入数据库。该任务仍有 ${allGaps.length} 条缺口，请后续补齐。`);
    } else {
      message.success("已确认并写入数据库，任务已标记为可执行。");
    }
  }

  async function handleConfirmTaskAdjustment(taskId: string) {
    if (!activeResult) return;
    const base = activeResult.splitTasks.find((t) => t.id === taskId);
    if (!base) return;

    const draftedSelf = buildTaskFromDraft(base);
    const mergedSelf: TaskItem = {
      ...draftedSelf,
      executionStatusManual: false,
    };

    const peers = activeResult.splitTasks.map((x) => {
      if (x.id === taskId) return mergedSelf;
      return getTaskEffectiveForGaps(x);
    });

    const splitGaps = collectSplitContextGapLines(activeResult.context, peers);
    const ownGaps = computeTaskUnmetPoints(mergedSelf, activeResult.context, peers);
    const allGaps = [...splitGaps, ...ownGaps];
    const nextTasks = activeResult.splitTasks.map((t) =>
      t.id === taskId
        ? { ...mergedSelf, executionStatus: "executable" as const, executionStatusManual: false }
        : t,
    );

    const out = refreshSplitResultDerivedFields({ ...activeResult, splitTasks: nextTasks });

    await persistConfirmedTaskAdjustment(taskId, out, allGaps);
  }

  async function handleConfirmAllTasks() {
    if (!activeResult || activeResult.splitTasks.length === 0) return;
    const mergedTasks = activeResult.splitTasks.map((base) => ({
      ...buildTaskFromDraft(base),
      executionStatusManual: false as const,
    }));
    const nextTasks = mergedTasks.map((task) => {
      const ownGaps = computeTaskUnmetPoints(task, activeResult.context, mergedTasks);
      if (ownGaps.length > 0) {
        return { ...task, executionStatus: "not_executable" as const, executionStatusManual: false };
      }
      return { ...task, executionStatus: "executable" as const, executionStatusManual: false };
    });
    const out = refreshSplitResultDerivedFields({ ...activeResult, splitTasks: nextTasks });
    const blockedTaskCount = nextTasks.filter((task) => task.executionStatus !== "executable").length;
    setConfirmSavingTaskId("__all__");
    try {
      await savePrdTaskSplitResult(out);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      message.error(`一键确认未能写入数据库，请重试：${msg}`);
      return;
    } finally {
      setConfirmSavingTaskId(null);
    }
    setPendingTaskSizeById({});
    setPendingTaskApiSpecById({});
    setPendingTaskContentById({});
    setActiveResult(out);
    const hasExecutableTask = out.splitTasks.some((task) => displayExecutionStatus(task) === "executable");
    if (hasExecutableTask) {
      setTaskConfirmFilter("confirmed");
    }
    if (blockedTaskCount > 0) {
      message.warning(`已一键确认并写入数据库，其中 ${blockedTaskCount} 条任务仍为不可执行。`);
      return;
    }
    message.success(`已一键确认并写入数据库（${nextTasks.length} 条任务）。`);
  }

  async function handleSaveTaskDraft(taskId: string) {
    if (!activeResult) return;
    const base = activeResult.splitTasks.find((task) => task.id === taskId);
    if (!base) return;
    if (!hasTaskDraftChanges(base)) {
      message.info("当前任务没有可保存的变更。");
      return;
    }
    const mergedSelf = buildTaskFromDraft(base);
    const nextTasks = activeResult.splitTasks.map((task) => (task.id === taskId ? mergedSelf : task));
    const out = refreshSplitResultDerivedFields({ ...activeResult, splitTasks: nextTasks });
    setSavingTaskId(taskId);
    try {
      await savePrdTaskSplitResult(out);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      message.error(`任务保存失败：${msg}`);
      return;
    } finally {
      setSavingTaskId(null);
    }
    setActiveResult(out);
    stripPendingStateForTask(taskId);
    message.success("任务已保存。");
  }

  async function handleGenerateExecutableTasks() {
    if (!activeResult || activeResult.splitTasks.length === 0) return;
    const sourceTasks = activeResult.splitTasks.filter((task) => (
      displayExecutionStatus(task) === "executable" && !task.splitSourceTaskId
    ));
    if (sourceTasks.length === 0) {
      message.info("当前没有可用于生成的已确认拆分任务。");
      return;
    }
    const generatedTasks = buildExecutableTaskCopiesFromSplitSources(activeResult, sourceTasks);
    const out = refreshSplitResultDerivedFields({
      ...activeResult,
      executableTasks: [...activeResult.executableTasks, ...generatedTasks],
    });
    try {
      await savePrdTaskSplitResult(out);
      setActiveResult(out);
      window.dispatchEvent(new CustomEvent(WORKFLOW_UI_EVENT_SPLIT_TODO_COUNT_UPDATED, {
        detail: { todoCount: generatedTasks.length },
      }));
      closePanelToTaskListButton();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      message.error(`生成可执行任务失败：${msg}`);
    }
  }

  async function handleGenerateExecutableForSplitTask(taskId: string) {
    if (!activeResult || activeResult.splitTasks.length === 0) return;
    const task = activeResult.splitTasks.find((t) => t.id === taskId);
    if (!task) return;
    if (task.splitSourceTaskId) return;
    if (displayExecutionStatus(task) !== "executable") {
      message.info("该任务尚未确认可执行，请先确认或消除缺口。");
      return;
    }
    setGeneratingExecutableTaskId(taskId);
    try {
      const generatedTasks = buildExecutableTaskCopiesFromSplitSources(activeResult, [task]);
      const out = refreshSplitResultDerivedFields({
        ...activeResult,
        executableTasks: [...activeResult.executableTasks, ...generatedTasks],
      });
      await savePrdTaskSplitResult(out);
      setActiveResult(out);
      window.dispatchEvent(new CustomEvent(WORKFLOW_UI_EVENT_SPLIT_TODO_COUNT_UPDATED, {
        detail: { todoCount: generatedTasks.length },
      }));
      message.success("已为该任务生成可执行任务。");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      message.error(`生成可执行任务失败：${msg}`);
    } finally {
      setGeneratingExecutableTaskId(null);
    }
  }

  async function handleAddTask() {
    const baseResult = activeResult
      ? activeResult
      : refreshSplitResultDerivedFields({
        source: prdDocumentFromMarkdownFragment(inputValue),
        context: null,
        splitTasks: [],
        executableTasks: [],
        criticalPath: [],
        parallelGroups: [],
        unmetPreconditions: [],
      });
    const maxOrdinal = baseResult.splitTasks
      .map((task) => parseTaskNumericOrdinal(task.id))
      .reduce((max: number, current) => {
        if (current == null) return max;
        return current > max ? current : max;
      }, 0);
    const nextId = `task-${maxOrdinal + 1}`;
    const inferredRole: TaskRole =
      taskRoleFilter === "frontend" || taskRoleFilter === "backend" || taskRoleFilter === "document"
        ? taskRoleFilter
        : defaultTaskRoleForRepositoryType(baseResult.context?.repositoryType);
    const nextTask: TaskItem = {
      id: nextId,
      title: `任务 ${maxOrdinal + 1}`,
      description: "",
      role: inferredRole,
      size: "M",
      estimateDays: estimateDaysFromSize("M"),
      dependencies: [],
      sourceRefs: [],
      sourceRequirementIds: [],
      subtasks: [],
      dod: [],
      executionStatus: "not_executable",
      executionStatusManual: false,
      flowStatus: "todo",
    };
    const out = refreshSplitResultDerivedFields({
      ...baseResult,
      splitTasks: [nextTask, ...baseResult.splitTasks],
    });
    try {
      await savePrdTaskSplitResult(out);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      message.error(`新增任务未能保存到数据库：${msg}`);
      return;
    }
    setActiveResult(out);
    setTaskConfirmFilter("unconfirmed");
    setSelectedTaskId(nextId);
    requestAnimationFrame(() => scrollToTaskCard(nextId));
    message.success("已新增任务。");
  }

  function taskToMarkdown(task: TaskItem): string {
    const taskDescription = task.description.trim();
    const subtaskLines = task.subtasks;
    const dodLines = task.dod;
    return [
      "#### 任务内容",
      taskDescription,
      "",
      ...(task.apiSpec
        ? [
          "#### 接口协议",
          `- 接口路径：${task.apiSpec.endpoint}`,
          `- 请求方法：${task.apiSpec.method}`,
          `- 请求定义：${task.apiSpec.requestSchema}`,
          `- 响应定义：${task.apiSpec.responseSchema}`,
          `- 错误码：${task.apiSpec.errorCodes.join(", ") || "无"}`,
          "",
        ]
        : []),
      "#### 子任务",
      ...subtaskLines.map((item) => `- ${item}`),
      "",
      "#### 验收标准（DoD）",
      ...dodLines.map((item) => `- ${item}`),
    ].join("\n");
  }

  const promptActionItems: MenuProps["items"] = [
    {
      key: "runtime-prompt",
      label: "拆分执行提示词（阶段1/2）",
      icon: <SettingOutlined />,
      onClick: () => {
        void handleOpenRuntimePromptModal();
      },
      disabled: !linkedRepositoryId,
    },
  ];

  return (
    <Suspense
      fallback={
        <div className="app-file-editor-loading">
          <Spin size="small" />
        </div>
      }
    >
      <Layout.Content
        ref={(node) => {
          panelRootRef.current = node;
        }}
        className={[
          "app-prd-task-panel",
          closingToTaskListMotion?.active ? "app-prd-task-panel--closing-to-task-list" : "",
        ].join(" ").trim()}
        style={closingToTaskListMotion
          ? {
            transform: closingToTaskListMotion.active
              ? `translate3d(${closingToTaskListMotion.dx}px, ${closingToTaskListMotion.dy}px, 0) scale(${closingToTaskListMotion.scale})`
              : "translate3d(0, 0, 0) scale(1)",
            opacity: closingToTaskListMotion.active ? 0.14 : 1,
            transition: `transform ${TASK_SPLIT_CLOSE_ANIMATION_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity ${TASK_SPLIT_CLOSE_ANIMATION_MS}ms ease`,
            transformOrigin: "center center",
            pointerEvents: "none",
            willChange: "transform, opacity",
          }
          : undefined}
      >
      <SplitPromptWizardModal
        open={splitPromptAdjustModalOpen}
        step={splitWizardStep}
        parsing={parsing}
        starting={splitPromptAdjustStarting}
        saving={splitPromptAdjustSaving}
        optimizingSlot={splitPromptOptimizingSlot}
        loading={splitPromptAdjustLoading}
        draftBySlot={splitPromptAdjustDraftBySlot}
        runtimeLogs={splitRuntimeLogs}
        runtimeListRef={splitRuntimeListRef}
        retryingPhase={retryingPhase}
        onStepChange={setSplitWizardStep}
        onClose={() => {
          setSplitPromptAdjustModalOpen(false);
          setSplitWizardStep("prompts");
          setSplitRuntimeVisible(false);
        }}
        onDraftChange={(slot, markdown) => {
          setSplitPromptAdjustDraftBySlot((prev) => ({ ...prev, [slot]: markdown }));
        }}
        onSavePrompts={() => void handleSaveSplitPromptAdjustDrafts()}
        onStartSplit={() => void handleStartSplitFromAdjustModal()}
        onOptimize={(slot) => void handleOptimizeSplitPromptDraft(slot)}
        onRetryStage={(phase) => { void handleRetrySplitStage(phase); }}
      />
      <RuntimePromptEditModal
        open={runtimePromptModalOpen}
        linkedRepositoryId={linkedRepositoryId}
        loading={runtimePromptLoading}
        saving={runtimePromptSaving}
        optimizingSlot={runtimePromptOptimizingSlot}
        slot={runtimePromptSlot}
        draftBySlot={runtimePromptDraftBySlot}
        onSlotChange={setRuntimePromptSlot}
        onDraftChange={updateRuntimePromptDraft}
        onResetToDefault={() => void handleResetRuntimePromptToDefault()}
        onCancel={() => {
          setRuntimePromptModalOpen(false);
          setRuntimePromptSaving(false);
        }}
        onSave={() => void handleSaveRuntimePromptDraft()}
        onOptimize={(slot) => void handleOptimizeRuntimePromptDraft(slot)}
      />
      <Modal
        title={projectPrdLinkKind === "employee" ? "关联已有员工" : "关联已有团队"}
        open={projectPrdLinkModalOpen}
        onCancel={() => {
          if (projectPrdLinkSaving) return;
          setProjectPrdLinkModalOpen(false);
          setProjectPrdLinkSelection(null);
        }}
        destroyOnClose
        okText="关联"
        cancelText="取消"
        confirmLoading={projectPrdLinkSaving}
        onOk={() => void handleConfirmProjectPrdLinkExisting()}
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
          将侧栏已有员工或团队模板关联到当前项目，便于在需求顶栏查看；新建请使用右侧「+」打开与仓库一致的全局配置。
        </Typography.Paragraph>
        <Select
          showSearch
          allowClear
          optionFilterProp="label"
          placeholder={projectPrdLinkKind === "employee" ? "选择员工" : "选择团队"}
          style={{ width: "100%" }}
          value={projectPrdLinkSelection ?? undefined}
          onChange={(v) => setProjectPrdLinkSelection(v ?? null)}
          options={projectPrdLinkKind === "employee" ? projectPrdAddEmployeeOptions : projectPrdAddWorkflowOptions}
        />
        {(projectPrdLinkKind === "employee" ? projectPrdAddEmployeeOptions : projectPrdAddWorkflowOptions).length ===
        0 ? (
          <Typography.Text type="secondary" style={{ display: "block", marginTop: 8 }}>
            {projectPrdLinkKind === "employee" ? "没有可关联的员工（均已关联或已禁用）。" : "没有可关联的团队（均已关联）。"}
          </Typography.Text>
        ) : null}
      </Modal>
      <RequirementNameModal
        open={requirementNameModalOpen}
        mode={requirementNameModalMode}
        saving={requirementNameSaving}
        value={requirementNameInput}
        onChange={setRequirementNameInput}
        onCancel={() => setRequirementNameModalOpen(false)}
        onConfirm={() => void handleConfirmRequirementNameModal()}
      />
      <Space direction="vertical" size={4} className="app-prd-task-panel__stack">
        <Space className="app-prd-task-panel__header" align="start">
          <div className="app-prd-task-panel__header-summary-wrap" style={{ minWidth: 0, flex: 1 }}>
            {headerProjectName || headerRepositoryTagItems.length > 0 || activeProjectId?.trim() ? (
              <div className="app-prd-task-panel__header-summary-project">
                <Space
                  wrap
                  size={[6, 4]}
                  align="center"
                  className="app-prd-task-panel__header-summary-project-inner"
                >
                  {headerProjectName ? (
                    <Typography.Text type="secondary" className="app-prd-task-panel__header-project-line">
                      项目：{headerProjectName}
                    </Typography.Text>
                  ) : null}
                  <Space size={4} wrap align="center" className="app-prd-task-panel__header-project-scope">
                    <div className="app-prd-task-panel__header-scope-split">
                      <div className="app-prd-task-panel__header-scope-split__trigger-wrap">
                        <Popover
                          title={projectEmployeePopoverTitle}
                          trigger="click"
                          content={projectEmployeePopoverContent}
                          rootClassName="app-prd-project-employee-popover"
                        >
                          <Button
                            size="small"
                            type="default"
                            icon={<UserOutlined />}
                            disabled={!activeProjectId?.trim()}
                            loading={projectPrdScopeLoading}
                            className="app-prd-task-panel__requirement-op-btn app-prd-task-panel__header-scope-split__main"
                          >
                            员工（{projectEmployeeHeaderBadgeCount}）
                          </Button>
                        </Popover>
                      </div>
                      <span className="app-prd-task-panel__header-scope-split__divider" aria-hidden />
                      <div className="app-prd-task-panel__header-scope-split__addon-wrap">
                        <Tooltip title="新增员工（与仓库配置一致）">
                          <Button
                            size="small"
                            type="default"
                            icon={<PlusOutlined />}
                            disabled={!activeProjectId?.trim()}
                            aria-label="新增员工"
                            className="app-prd-task-panel__requirement-op-btn app-prd-task-panel__header-scope-split__addon"
                            onClick={() => onOpenEmployeeConfigForProject?.()}
                          />
                        </Tooltip>
                      </div>
                    </div>
                    <div className="app-prd-task-panel__header-scope-split">
                      <div className="app-prd-task-panel__header-scope-split__trigger-wrap">
                        <Popover title="项目团队（本面板关联）" trigger="click" content={projectTeamPopoverContent}>
                          <Button
                            size="small"
                            type="default"
                            icon={<TeamOutlined />}
                            disabled={!activeProjectId?.trim()}
                            loading={projectPrdScopeLoading}
                            className="app-prd-task-panel__requirement-op-btn app-prd-task-panel__header-scope-split__main"
                          >
                            团队（{projectPrdWorkflowIds.length}）
                          </Button>
                        </Popover>
                      </div>
                      <span className="app-prd-task-panel__header-scope-split__divider" aria-hidden />
                      <div className="app-prd-task-panel__header-scope-split__addon-wrap">
                        <Tooltip title="新增团队（与仓库配置一致）">
                          <Button
                            size="small"
                            type="default"
                            icon={<PlusOutlined />}
                            disabled={!activeProjectId?.trim()}
                            aria-label="新增团队"
                            className="app-prd-task-panel__requirement-op-btn app-prd-task-panel__header-scope-split__addon"
                            onClick={() => onOpenWorkflowConfigForProject?.()}
                          />
                        </Tooltip>
                      </div>
                    </div>
                  </Space>
                  {headerRepositoryTagItems.map((item) => (
                    <Popover
                      key={item.key}
                      title={`仓库：${item.label}`}
                      trigger="click"
                      content={renderRepositoryScopePopover(item.repositoryId)}
                    >
                      <span className="app-prd-task-panel__header-repo-tag-wrap">
                        <Tag className="app-prd-task-panel__header-repo-tag app-prd-task-panel__header-repo-tag--interactive" bordered={false}>
                          {item.label}
                        </Tag>
                        {item.hasMainOwner ? (
                          <span
                            className="app-prd-task-panel__header-repo-tag-owner-mark"
                            aria-label="已配置主 Owner"
                            title="已配置主 Owner"
                          >
                            <UserOutlined />
                          </span>
                        ) : null}
                      </span>
                    </Popover>
                  ))}
                  {headerProjectName && headerRepositoryTagItems.length === 0 ? (
                    <Tag className="app-prd-task-panel__header-repo-tag" bordered={false}>
                      暂无仓库
                    </Tag>
                  ) : null}
                </Space>
              </div>
            ) : null}
          </div>
          <Space className="app-prd-task-panel__header-actions">
            <Button
              size="small"
              icon={<CloseOutlined />}
              onClick={onClose}
              aria-label="关闭需求面板"
              disabled={closingToTaskListMotion?.active}
            />
          </Space>
        </Space>

        <Row gutter={12} className="app-prd-task-panel__columns">
          <Col span={12} className="app-prd-task-panel__col">
            <Card
              size="small"
              title={(
                <RequirementBoardHeader
                  activeRequirementId={activeRequirementId}
                  activeRequirement={activeRequirement ?? null}
                  options={sortedRequirementHistory}
                  onPick={(value) => {
                    const picked = requirementHistoryById.get(value);
                    if (!picked) return;
                    switchToRequirement(picked);
                  }}
                  onPin={() => handlePinActiveRequirement()}
                  onCreate={() => {
                    setRequirementNameModalMode("create");
                    setRequirementNameInput("");
                    setRequirementNameModalOpen(true);
                  }}
                  onDelete={() => handleDeleteActiveRequirement()}
                />
              )}
              className="app-prd-task-panel__left-card"
              bodyStyle={{ padding: "0 0 16px 0" }}
            >
              <Space
                direction="vertical"
                size={10}
                className="app-prd-task-panel__full-width app-prd-task-panel__requirement-content"
              >
                <div
                  ref={requirementEditorShellRef}
                  className="app-prd-task-panel__editor-shell"
                  onPasteCapture={(e) => void handlePasteImage(e)}
                >
                    <MilkdownEditor
                      ref={milkdownEditorRef}
                      text={inputValue}
                      onChange={setInputValue}
                      onToolbarSplitSelection={() => void handleSplitSelection()}
                      taskAnchors={milkdownTaskAnchors}
                      selectedRequirementAnchorKey={selectedAnchorTaskId}
                      onResolvedTaskAnchorIdsChange={(taskIds) => {
                        if (filteredTasks.length === 0) return;
                        const normalizedTaskIds = Array.from(
                          new Set(
                            taskIds
                              .map((id) => id.trim())
                              .filter((id) => id.length > 0),
                          ),
                        ).sort((a, b) => a.localeCompare(b));
                        setResolvedTaskAnchorIds((prev) => (
                          sameStringArray(prev, normalizedTaskIds) ? prev : normalizedTaskIds
                        ));
                        setAnchorResolveReported((prev) => (prev ? prev : true));
                      }}
                      onTaskAnchorRangesChange={(ranges) => {
                        if (filteredTasks.length === 0) return;
                        setActiveResult((prev) => {
                          if (!prev) return prev;
                          const taskIds = new Set(prev.splitTasks.map((task) => task.id));
                          const resolvedNow: Record<string, TaskAnchorPosition> = {};
                          for (const [taskId, range] of Object.entries(ranges)) {
                            if (!taskIds.has(taskId)) continue;
                            const from = Number(range.from);
                            const to = Number(range.to);
                            if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue;
                            resolvedNow[taskId] = { from: Math.floor(from), to: Math.floor(to) };
                          }
                          const current = prev.taskAnchorPositions ?? {};
                          if (Object.keys(resolvedNow).length === 0) {
                            return prev;
                          }
                          // 采用增量合并，避免状态切换时瞬时回传不完整导致锚点位置被清空后又恢复而闪烁。
                          const mergedPositionsRaw: Record<string, TaskAnchorPosition> = {
                            ...current,
                            ...resolvedNow,
                          };
                          const mergedPositions: Record<string, TaskAnchorPosition> = {};
                          for (const [taskId, pos] of Object.entries(mergedPositionsRaw)) {
                            if (!taskIds.has(taskId)) continue;
                            mergedPositions[taskId] = pos;
                          }
                          const nextPositions = Object.keys(mergedPositions).length > 0 ? mergedPositions : undefined;
                          if (sameTaskAnchorPositions(prev.taskAnchorPositions, nextPositions)) return prev;
                          const merged: SplitResult = {
                            ...prev,
                            taskAnchorPositions: nextPositions,
                          };
                          latestAnchorRangePersistResultRef.current = merged;
                          if (anchorRangePersistTimerRef.current != null) {
                            window.clearTimeout(anchorRangePersistTimerRef.current);
                          }
                          anchorRangePersistTimerRef.current = window.setTimeout(() => {
                            const payload = latestAnchorRangePersistResultRef.current;
                            if (!payload) return;
                            void savePrdTaskSplitResult(payload).catch((err) => {
                              const msg = err instanceof Error ? err.message : String(err);
                              message.warning(`任务锚点位置持久化失败：${msg}`);
                            });
                          }, 300);
                          return merged;
                        });
                      }}
                      onTaskAnchorMarkerClick={(taskId) => {
                        focusTaskWithFilterSync(taskId);
                      }}
                    />
                  {splitRuntimeVisible ? (
                    <div ref={splitRuntimeRef} className="app-prd-task-panel__split-runtime">
                        <div className="app-prd-task-panel__split-runtime-head">
                          <Space size={8} align="center" className="app-prd-task-panel__split-runtime-head-title">
                            <Typography.Text strong>处理信息 · Claude Code 会话</Typography.Text>
                            {parsing ? <Spin size="small" aria-label="拆分进行中" /> : null}
                          </Space>
                          <Button
                            size="small"
                            icon={<CloseOutlined />}
                            onClick={() => setSplitRuntimeVisible(false)}
                            aria-label="关闭处理信息面板"
                          />
                        </div>
                        <SplitRuntimeMessages
                          logs={splitRuntimeLogs}
                          listRef={splitRuntimeListRef}
                          retryingPhase={retryingPhase}
                          onRetryStage={(phase) => { void handleRetrySplitStage(phase); }}
                        />
                    </div>
                  ) : null}
                </div>
                {inputError ? <Typography.Text type="danger">{inputError}</Typography.Text> : null}
                {showUrlAnchorHint ? (
                  <Typography.Text type="warning">
                    当前输入为 URL，若左侧仅显示链接文本则无法定位需求锚点；请先执行一次拆分以回填正文后再查看锚点。
                  </Typography.Text>
                ) : null}
                <RequirementBoardActions
                  hasInput={hasInput}
                  parsing={parsing}
                  splitStarting={splitPromptAdjustStarting}
                  promptActionItems={promptActionItems}
                  onSaveDraft={() => void handleUserPersistPrdDraft()}
                  onStartSplit={() => void handleOpenSplitPromptAdjustModal()}
                />
              </Space>
            </Card>
          </Col>
          <Col span={12} className="app-prd-task-panel__col">
            <Space direction="vertical" size={12} className="app-prd-task-panel__full-width app-prd-task-panel__stack">
              {splitError ? <Typography.Text type="danger">{splitError}</Typography.Text> : null}
              {mappingFallbackStats?.hasFallback ? (
                <Typography.Text type={mappingFallbackStats.allFallback ? "warning" : "secondary"}>
                  映射提示：当前需求映射 {mappingFallbackStats.fallbackCount}/{mappingFallbackStats.total}
                  条由本地自动映射生成（不依赖模型返回 requirement 映射字段）。
                </Typography.Text>
              ) : null}
              {splitQualityStats ? (
                <div className="app-prd-task-panel__quality-strip">
                  <span className="app-prd-task-panel__quality-chip">
                    映射覆盖 {splitQualityStats.mappedTaskCount}/{splitQualityStats.totalTasks}（{splitQualityStats.mappingRate}%）
                  </span>
                  <span
                    className={[
                      "app-prd-task-panel__quality-chip",
                      splitQualityStats.untraceableTaskIds.length > 0
                        ? "app-prd-task-panel__quality-chip--warning"
                        : "app-prd-task-panel__quality-chip--good",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    锚点可追溯 {splitQualityStats.traceableTaskCount}/{splitQualityStats.totalTasks}（{splitQualityStats.traceRate}%）
                  </span>
                  {splitQualityStats.untraceableTaskIds.length > 0 ? (
                    <span className="app-prd-task-panel__quality-chip app-prd-task-panel__quality-chip--warning">
                      不可追溯：{splitQualityStats.untraceableTaskIds.join(", ")}
                    </span>
                  ) : null}
                </div>
              ) : null}

              <div ref={taskSplitHostRef} className="app-prd-task-panel__task-card-host">
                  <Card
                    size="small"
                    title={(
                      <div className="app-prd-task-panel__task-title-row">
                        <div className="app-prd-task-panel__task-title-row-main">
                          <span>
                            拆分任务
                            <Typography.Text type="secondary">（{filteredTasks.length}）</Typography.Text>
                          </span>
                          {unmetTaskIds.length > 0 ? (
                            <Dropdown
                              trigger={["click"]}
                              placement="bottomLeft"
                              menu={{ items: unmetPreconditionsMenuItems }}
                              overlayClassName="app-prd-task-panel__unmet-dropdown-root"
                            >
                              <button
                                type="button"
                                className="app-prd-task-panel__unmet-trigger"
                                title="存在问题任务，点击查看锚点"
                                aria-label={`存在问题任务 ${unmetTaskIds.length} 个，点击查看锚点`}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <UnmetConditionsQuestionIcon />
                                <span className="app-prd-task-panel__unmet-trigger-count">
                                  {unmetTaskIds.length}
                                </span>
                              </button>
                            </Dropdown>
                          ) : null}
                        </div>
                        <div className="app-prd-task-panel__task-title-row-tools">
                          <Button
                            size="small"
                            type="primary"
                            className="app-prd-task-panel__task-toolbar-btn"
                            loading={confirmSavingTaskId === "__all__"}
                            disabled={!activeResult || activeResult.splitTasks.length === 0 || Boolean(confirmSavingTaskId)}
                            onClick={() => void handleConfirmAllTasks()}
                          >
                            一键确认
                          </Button>
                          <Button
                            size="small"
                            className="app-prd-task-panel__task-toolbar-btn"
                            onClick={() => void handleAddTask()}
                            disabled={Boolean(confirmSavingTaskId)}
                          >
                            新增
                          </Button>
                          <Button
                            size="small"
                            danger
                            type="default"
                            className="app-prd-task-panel__task-toolbar-btn"
                            icon={<DeleteOutlined />}
                            onClick={() => handleClearAllTasks()}
                            disabled={!activeResult || activeResult.splitTasks.length === 0}
                          >
                            全部清空
                          </Button>
                          <Segmented
                            size="small"
                            className="app-prd-task-panel__task-toolbar-segmented"
                            value={taskConfirmFilter}
                            onChange={(value: string | number) => setTaskConfirmFilter(value as TaskConfirmFilter)}
                            options={[
                              { label: `未确认（${taskConfirmCounts.unconfirmedCount}）`, value: "unconfirmed" },
                              { label: `已确认（${taskConfirmCounts.confirmedCount}）`, value: "confirmed" },
                            ]}
                          />
                          {showRoleFilterTabs ? (
                            <Segmented
                              size="small"
                              className="app-prd-task-panel__task-toolbar-segmented"
                              value={taskRoleFilter}
                              onChange={(value: string | number) => setTaskRoleFilter(value as TaskRoleFilter)}
                              options={taskRoleFilterOptions}
                            />
                          ) : null}
                        </div>
                      </div>
                    )}
                    className="app-prd-task-panel__result-card app-prd-task-panel__task-card"
                    bodyStyle={{ padding: 0 }}
                  >
                  <div className="app-prd-task-panel__task-split-layout">
                    <div className="app-prd-task-panel__task-upper">
                      <div className="app-prd-task-panel__task-list">
                        {filteredTasks.length === 0 ? (
                          <div className="app-prd-task-panel__task-list-empty">
                            <Typography.Text type="secondary">暂未拆分任务</Typography.Text>
                          </div>
                        ) : (
                          filteredTasks.map((task) => {
                            const taskUnmetLines = cardUnmetPointsForTask(task);
                            const taskExecutableCheckResult = taskExecutableCheckResultById[task.id] ?? "";
                            const unmetCollapsed = taskUnmetCollapsedById[task.id] ?? false;
                            const checkCollapsed = taskCheckCollapsedById[task.id] ?? false;
                            const taskAiMode = getTaskAiMode(task);
                            const taskAiPopoverContent = (
                              <div
                                className="app-prd-task-panel__task-ai-popover-content"
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className="app-prd-task-panel__task-ai-popover-main">
                                  <Typography.Text strong>提示词</Typography.Text>
                                  <div className="app-prd-task-panel__split-prompt-milkdown">
                                    <MilkdownEditor
                                      floatingToolbar={false}
                                      text={getTaskAiInput(task, taskAiMode)}
                                      onChange={(markdown) => {
                                        setTaskAiInputById((prev) => ({
                                          ...prev,
                                          [task.id]: {
                                            ...(prev[task.id] ?? {}),
                                            [taskAiMode]: markdown,
                                          },
                                        }));
                                      }}
                                    />
                                  </div>
                                  {taskAiMode === "optimize" ? (
                                    <>
                                      <Typography.Text strong>优化后任务内容</Typography.Text>
                                      <div className="app-prd-task-panel__split-prompt-milkdown">
                                        <MilkdownEditor
                                          floatingToolbar={false}
                                          text={taskAiOptimizedContentById[task.id] ?? ""}
                                          onChange={(markdown) => {
                                            setTaskAiOptimizedContentById((prev) => ({
                                              ...prev,
                                              [task.id]: markdown,
                                            }));
                                          }}
                                        />
                                      </div>
                                    </>
                                  ) : null}
                                </div>
                                <div className="app-prd-task-panel__task-ai-popover-actions">
                                  <Button
                                    size="small"
                                    disabled={!!taskAiActionLoadingById[task.id]}
                                    onClick={() => {
                                      setTaskAiPopoverTaskId(null);
                                      setTaskAiPopoverMode(null);
                                    }}
                                  >
                                    关闭
                                  </Button>
                                  <Button
                                    type="primary"
                                    size="small"
                                    loading={!!taskAiActionLoadingById[task.id]}
                                    disabled={!!taskAiActionLoadingById[task.id]}
                                    onClick={() => {
                                      const prompt = getTaskAiInput(task, taskAiMode).trim();
                                      if (!prompt) {
                                        message.warning("请输入提示词后再执行。");
                                        return;
                                      }
                                      if (taskAiMode === "optimize") {
                                        void handleOptimizeTaskContent(task, prompt);
                                        return;
                                      }
                                      void handleCheckTaskExecutable(task, prompt);
                                    }}
                                  >
                                    {taskAiMode === "optimize" ? "优化" : "确定"}
                                  </Button>
                                  {taskAiMode === "optimize" ? (
                                    <Button
                                      size="small"
                                      loading={taskAiSavingTaskId === task.id}
                                      disabled={!(taskAiOptimizedReadyById[task.id] ?? false) || !!taskAiActionLoadingById[task.id]}
                                      onClick={() => void handleSaveOptimizedTaskContent(task)}
                                    >
                                      保存
                                    </Button>
                                  ) : null}
                                </div>
                              </div>
                            );
                            return (
                            <div
                              key={task.id}
                              data-task-id={task.id}
                              className={`app-prd-task-panel__task-list-item ${selectedTaskId === task.id ? "is-active" : ""}`}
                              tabIndex={0}
                              onClick={() => {
                                if (selectedTaskId !== null && selectedTaskId !== task.id) {
                                  milkdownEditorRef.current?.clearRequirementFocusHighlight();
                                }
                                setSelectedTaskId(task.id);
                                setSelectedAnchorTaskId(task.id);
                              }}
                            >
                            <div className="app-prd-task-panel__task-card-head">
                              <div className="app-prd-task-panel__task-card-meta-row">
                                <Button
                                  type="text"
                                  size="small"
                                  className="app-prd-task-panel__task-link-btn"
                                  title={`定位需求锚点 #${anchorLabelFromTaskId(task.id)}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (selectedTaskId !== task.id) {
                                      milkdownEditorRef.current?.clearRequirementFocusHighlight();
                                    }
                                    setSelectedTaskId(task.id);
                                    setSelectedAnchorTaskId(task.id);
                                    const locatedByAnchor = scrollToTaskAnchorInPrd(task);
                                    if (locatedByAnchor) return;
                                    const requirementId = pickRequirementIdForTask(task);
                                    if (requirementId) {
                                      const locatedByRequirement = scrollToRequirementInPrd(requirementId);
                                      if (locatedByRequirement) return;
                                    }
                                    message.warning("没有相应的锚点。");
                                  }}
                                >
                                  定位需求 #{anchorLabelFromTaskId(task.id)}
                                </Button>
                                <div className="app-prd-task-panel__task-card-tags">
                                  <span
                                    className={`app-prd-task-panel__task-role-tag ${taskRoleTagModifierClass(task.role)}`}
                                  >
                                    {taskRoleChineseLabel(task.role)}
                                  </span>
                                </div>
                                <Button
                                  type="text"
                                  danger
                                  size="small"
                                  className="app-prd-task-panel__task-delete-btn"
                                  icon={<DeleteOutlined />}
                                  title="删除该任务项"
                                  aria-label={`删除任务 ${task.id}`}
                                  disabled={(activeResult?.splitTasks.length ?? 0) <= 1}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteTask(task.id);
                                  }}
                                />
                              </div>
                            </div>
                            <div
                              className="app-prd-task-panel__task-card-editor is-editing"
                              onMouseDown={(e) => {
                                e.stopPropagation();
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                              }}
                            >
                              <MilkdownEditor
                                floatingToolbar={false}
                                text={pendingTaskContentById[task.id] ?? taskToMarkdown(getDraftedTask(task))}
                                onChange={(markdown) => {
                                  setPendingTaskContentById((prev) => {
                                    if (prev[task.id] === markdown) return prev;
                                    return {
                                      ...prev,
                                      [task.id]: markdown,
                                    };
                                  });
                                }}
                              />
                            </div>
                          {(getDraftedTask(task).apiSpec || task.title.includes("接口协议")) ? (
                            <div
                              className="app-prd-task-panel__task-api-spec-block"
                            >
                              {(() => {
                                const method = (pendingTaskApiSpecById[task.id] ?? getDraftedTask(task).apiSpec)?.method;
                                if (method !== "GET" && method !== "DELETE") return null;
                                return (
                                  <Typography.Text type="warning">
                                    当前方法通常不使用请求体，建议优先使用 query/path 参数定义请求。
                                  </Typography.Text>
                                );
                              })()}
                              <Typography.Text type="secondary">接口协议（结构化）</Typography.Text>
                              <Space direction="vertical" size={6} style={{ width: "100%", marginTop: 6 }}>
                                <Space>
                                  <Button
                                    size="small"
                                    onClick={() => {
                                      setPendingTaskApiSpecById((prev) => ({
                                        ...prev,
                                        [task.id]: buildApiSpecTemplate(getDraftedTask(task)),
                                      }));
                                    }}
                                  >
                                    一键生成 REST 模板
                                  </Button>
                                </Space>
                                <Input
                                  size="small"
                                  placeholder="接口路径，例如 /api/tasks/split"
                                  value={(pendingTaskApiSpecById[task.id] ?? getDraftedTask(task).apiSpec)?.endpoint ?? ""}
                                  onChange={(e) => {
                                    const base = pendingTaskApiSpecById[task.id] ?? getDraftedTask(task).apiSpec ?? {
                                      endpoint: "",
                                      method: "POST" as const,
                                      requestSchema: "",
                                      responseSchema: "",
                                      errorCodes: [],
                                    };
                                    setPendingTaskApiSpecById((prev) => ({
                                      ...prev,
                                      [task.id]: { ...base, endpoint: e.target.value },
                                    }));
                                  }}
                                />
                                <Select
                                  size="small"
                                  value={(pendingTaskApiSpecById[task.id] ?? getDraftedTask(task).apiSpec)?.method ?? "POST"}
                                  options={API_METHOD_OPTIONS.map((item) => ({ label: item, value: item }))}
                                  onChange={(value) => {
                                    const draftedTask = getDraftedTask(task);
                                    const base = pendingTaskApiSpecById[task.id] ?? draftedTask.apiSpec ?? {
                                      endpoint: "",
                                      method: "POST" as const,
                                      requestSchema: "",
                                      responseSchema: "",
                                      errorCodes: [],
                                    };
                                    const defaultPost = normalizeJsonText(buildRequestSchemaByMethod("POST", draftedTask.title));
                                    const defaultGet = normalizeJsonText(buildRequestSchemaByMethod("GET", draftedTask.title));
                                    const defaultDelete = normalizeJsonText(buildRequestSchemaByMethod("DELETE", draftedTask.title));
                                    const currentNormalized = normalizeJsonText(base.requestSchema);
                                    const shouldAutoUpdateRequest = currentNormalized.length === 0
                                      || currentNormalized === defaultPost
                                      || currentNormalized === defaultGet
                                      || currentNormalized === defaultDelete;
                                    setPendingTaskApiSpecById((prev) => ({
                                      ...prev,
                                      [task.id]: {
                                        ...base,
                                        method: value,
                                        requestSchema: shouldAutoUpdateRequest
                                          ? buildRequestSchemaByMethod(value, draftedTask.title)
                                          : base.requestSchema,
                                      },
                                    }));
                                  }}
                                />
                                <Input.TextArea
                                  rows={2}
                                  placeholder="请求定义（JSON Schema 或字段说明）"
                                  value={(pendingTaskApiSpecById[task.id] ?? getDraftedTask(task).apiSpec)?.requestSchema ?? ""}
                                  onChange={(e) => {
                                    const base = pendingTaskApiSpecById[task.id] ?? getDraftedTask(task).apiSpec ?? {
                                      endpoint: "",
                                      method: "POST" as const,
                                      requestSchema: "",
                                      responseSchema: "",
                                      errorCodes: [],
                                    };
                                    setPendingTaskApiSpecById((prev) => ({
                                      ...prev,
                                      [task.id]: { ...base, requestSchema: e.target.value },
                                    }));
                                  }}
                                />
                                <Input.TextArea
                                  rows={2}
                                  placeholder="响应定义（JSON Schema 或字段说明）"
                                  value={(pendingTaskApiSpecById[task.id] ?? getDraftedTask(task).apiSpec)?.responseSchema ?? ""}
                                  onChange={(e) => {
                                    const base = pendingTaskApiSpecById[task.id] ?? getDraftedTask(task).apiSpec ?? {
                                      endpoint: "",
                                      method: "POST" as const,
                                      requestSchema: "",
                                      responseSchema: "",
                                      errorCodes: [],
                                    };
                                    setPendingTaskApiSpecById((prev) => ({
                                      ...prev,
                                      [task.id]: { ...base, responseSchema: e.target.value },
                                    }));
                                  }}
                                />
                                <Input
                                  size="small"
                                  placeholder="错误码，逗号分隔，例如 400,401,500"
                                  value={((pendingTaskApiSpecById[task.id] ?? getDraftedTask(task).apiSpec)?.errorCodes ?? []).join(", ")}
                                  onChange={(e) => {
                                    const base = pendingTaskApiSpecById[task.id] ?? getDraftedTask(task).apiSpec ?? {
                                      endpoint: "",
                                      method: "POST" as const,
                                      requestSchema: "",
                                      responseSchema: "",
                                      errorCodes: [],
                                    };
                                    setPendingTaskApiSpecById((prev) => ({
                                      ...prev,
                                      [task.id]: {
                                        ...base,
                                        errorCodes: e.target.value.split(",").map((item) => item.trim()).filter(Boolean),
                                      },
                                    }));
                                  }}
                                />
                              </Space>
                            </div>
                          ) : null}
                            <div
                              className="app-prd-task-panel__task-card-footer"
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="app-prd-task-panel__task-execution-row">
                                <Popover
                                  trigger="click"
                                  placement="topLeft"
                                  open={taskAnchorPopoverTaskId === task.id}
                                  onOpenChange={(open) => {
                                    if (open) {
                                      setTaskAiPopoverTaskId(null);
                                      setTaskAiPopoverMode(null);
                                      setTaskAnchorPopoverTaskId(task.id);
                                      return;
                                    }
                                    setTaskAnchorPopoverTaskId((prev) => (prev === task.id ? null : prev));
                                  }}
                                  overlayClassName="app-prd-task-panel__task-anchor-popover"
                                  content={(
                                    <TaskAnchorPopoverBody
                                      task={task}
                                      activeResult={activeResult}
                                      anchorResolvedInEditor={resolvedTaskAnchorIds.includes(task.id)}
                                    />
                                  )}
                                >
                                  <Button
                                    type="default"
                                    size="small"
                                    className="app-prd-task-panel__task-anchor-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                    }}
                                  >
                                    taskAnchors
                                  </Button>
                                </Popover>
                                <div className="app-prd-task-panel__task-execution-actions">
                                <Tooltip
                                  title={
                                    displayExecutionStatus(task) === "executable"
                                      ? "根据当前拆分任务生成一条可执行任务（写入可执行任务列表）"
                                      : "请先点击「任务合理，确认」或消除缺口后再生成"
                                  }
                                >
                                  <span className="app-prd-task-panel__task-generate-exec-footer-wrap">
                                    <Button
                                      type="default"
                                      size="small"
                                      className="app-prd-task-panel__task-save-btn"
                                      loading={generatingExecutableTaskId === task.id}
                                      disabled={
                                        displayExecutionStatus(task) !== "executable"
                                        || Boolean(confirmSavingTaskId)
                                        || Boolean(closingToTaskListMotion)
                                        || (generatingExecutableTaskId !== null
                                          && generatingExecutableTaskId !== task.id)
                                      }
                                      onClick={() => void handleGenerateExecutableForSplitTask(task.id)}
                                    >
                                      生成可执行任务
                                    </Button>
                                  </span>
                                </Tooltip>
                                <Popover
                                  trigger="click"
                                  placement="leftTop"
                                  open={taskAiPopoverTaskId === task.id && taskAiPopoverMode === "optimize"}
                                  onOpenChange={(open) => {
                                    if (open) {
                                      setTaskAnchorPopoverTaskId(null);
                                      openTaskAiPopover(task, "optimize");
                                      return;
                                    }
                                    if (taskAiPopoverTaskId === task.id && taskAiPopoverMode === "optimize") {
                                      setTaskAiPopoverTaskId(null);
                                      setTaskAiPopoverMode(null);
                                    }
                                  }}
                                  overlayClassName="app-prd-task-panel__task-ai-popover"
                                  content={taskAiPopoverContent}
                                >
                                  <Button
                                    type="default"
                                    size="small"
                                    className="app-prd-task-panel__task-save-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openTaskAiPopover(task, "optimize");
                                    }}
                                  >
                                    内容优化
                                  </Button>
                                </Popover>
                                <Popover
                                  trigger="click"
                                  placement="leftTop"
                                  open={taskAiPopoverTaskId === task.id && taskAiPopoverMode === "check"}
                                  onOpenChange={(open) => {
                                    if (open) {
                                      setTaskAnchorPopoverTaskId(null);
                                      openTaskAiPopover(task, "check");
                                      return;
                                    }
                                    if (taskAiPopoverTaskId === task.id && taskAiPopoverMode === "check") {
                                      setTaskAiPopoverTaskId(null);
                                      setTaskAiPopoverMode(null);
                                    }
                                  }}
                                  overlayClassName="app-prd-task-panel__task-ai-popover"
                                  content={taskAiPopoverContent}
                                >
                                  <Button
                                    type="default"
                                    size="small"
                                    className="app-prd-task-panel__task-save-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openTaskAiPopover(task, "check");
                                    }}
                                  >
                                    可执行检测
                                  </Button>
                                </Popover>
                                <Button
                                  type="default"
                                  size="small"
                                  className="app-prd-task-panel__task-save-btn"
                                  loading={savingTaskId === task.id}
                                  onClick={() => void handleSaveTaskDraft(task.id)}
                                >
                                  保存
                                </Button>
                                {displayExecutionStatus(task) !== "executable" ? (
                                  <Button
                                    type="primary"
                                    size="small"
                                    className="app-prd-task-panel__task-confirm-btn"
                                    loading={confirmSavingTaskId === task.id}
                                    disabled={Boolean(savingTaskId) || (Boolean(confirmSavingTaskId) && confirmSavingTaskId !== task.id)}
                                    onClick={() => void handleConfirmTaskAdjustment(task.id)}
                                  >
                                    任务合理，确认
                                  </Button>
                                ) : null}
                                </div>
                              </div>
                              {taskUnmetLines.length > 0 || taskExecutableCheckResult.trim() ? (
                                <div className="app-prd-task-panel__task-unmet-box">
                                  {taskUnmetLines.length > 0 && !unmetCollapsed ? (
                                    <>
                                      <div className="app-prd-task-panel__task-unmet-title-row">
                                        <div className="app-prd-task-panel__task-unmet-title">
                                          待沟通或补充的缺口（请合并进任务描述 / 子任务 / 验收标准 / 接口协议等）
                                        </div>
                                        <Button
                                          size="small"
                                          type="text"
                                          className="app-prd-task-panel__task-unmet-toggle-btn"
                                          onClick={() => {
                                            setTaskUnmetCollapsedById((prev) => ({
                                              ...prev,
                                              [task.id]: !unmetCollapsed,
                                            }));
                                          }}
                                        >
                                          收起缺口
                                        </Button>
                                      </div>
                                      <ul className="app-prd-task-panel__task-unmet-list">
                                        {taskUnmetLines.map((line) => (
                                          <li key={line}>{line}</li>
                                        ))}
                                      </ul>
                                    </>
                                  ) : null}
                                  {taskUnmetLines.length > 0 && unmetCollapsed ? (
                                    <div className="app-prd-task-panel__task-unmet-title-row">
                                      <div className="app-prd-task-panel__task-unmet-title">
                                        待沟通或补充的缺口（已收起）
                                      </div>
                                      <Button
                                        size="small"
                                        type="text"
                                        className="app-prd-task-panel__task-unmet-toggle-btn"
                                        onClick={() => {
                                          setTaskUnmetCollapsedById((prev) => ({
                                            ...prev,
                                            [task.id]: false,
                                          }));
                                        }}
                                      >
                                        展开缺口
                                      </Button>
                                    </div>
                                  ) : null}
                                  {taskExecutableCheckResult.trim() && !checkCollapsed ? (
                                    <div className="app-prd-task-panel__task-unmet-check-result">
                                      <div className="app-prd-task-panel__task-unmet-title-row">
                                        <div className="app-prd-task-panel__task-unmet-title">可执行检测结果</div>
                                        <Button
                                          size="small"
                                          type="text"
                                          className="app-prd-task-panel__task-unmet-toggle-btn"
                                          onClick={() => {
                                            setTaskCheckCollapsedById((prev) => ({
                                              ...prev,
                                              [task.id]: !checkCollapsed,
                                            }));
                                          }}
                                        >
                                          收起检测
                                        </Button>
                                      </div>
                                      <pre className="app-prd-task-panel__task-unmet-check-result-text">
                                        {taskExecutableCheckResult}
                                      </pre>
                                    </div>
                                  ) : null}
                                  {taskExecutableCheckResult.trim() && checkCollapsed ? (
                                    <div className="app-prd-task-panel__task-unmet-check-result">
                                      <div className="app-prd-task-panel__task-unmet-title-row">
                                        <div className="app-prd-task-panel__task-unmet-title">可执行检测结果（已收起）</div>
                                        <Button
                                          size="small"
                                          type="text"
                                          className="app-prd-task-panel__task-unmet-toggle-btn"
                                          onClick={() => {
                                            setTaskCheckCollapsedById((prev) => ({
                                              ...prev,
                                              [task.id]: false,
                                            }));
                                          }}
                                        >
                                          展开检测
                                        </Button>
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                              {null}
                            </div>
                            </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                    <div className="app-prd-task-panel__task-lower">
                      <Button
                        type="primary"
                        block
                        className={[
                          "app-prd-task-panel__task-generate-btn",
                          canGenerateExecutableTasks
                            ? "app-prd-task-panel__task-generate-btn--ready"
                            : "app-prd-task-panel__task-generate-btn--blocked",
                        ].join(" ")}
                        onClick={() => void handleGenerateExecutableTasks()}
                        disabled={!canGenerateExecutableTasks || Boolean(closingToTaskListMotion)}
                      >
                        {!hasConfirmedTasks
                          ? "生成可执行任务（已确认 0）"
                          : hasUnconfirmedTasks
                            ? `生成可执行任务（未确认 ${taskConfirmCounts.unconfirmedCount}）`
                            : "生成可执行任务（可执行）"}
                      </Button>
                    </div>
                  </div>
                  </Card>
                </div>
            </Space>
          </Col>
        </Row>
      </Space>
      </Layout.Content>
    </Suspense>
  );
}

import { SettingOutlined } from "@ant-design/icons";
import { App as AntdApp, Modal } from "antd";
import type { MenuProps } from "antd";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type {
  PrdDocument,
  ProjectItem,
  Repository,
  SplitResult,
  TaskApiSpec,
  TaskExecutionStatus,
  TaskItem,
  TaskRole,
  TaskSize,
  TaskSplitContext,
} from "../../types";
import type { AssistantWorkflowRef } from "../../types/assistant";
import type { ClusterRunState } from "../PrdSplitWizard/types";
import { defaultTaskRoleForRepositoryType } from "../../utils/repositoryType";
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
  materializePrdSnapshot,
  readSnapshotFile,
} from "../../services/materializePrdSnapshot";
import { logSplitInputPrepareBundle } from "../../services/buildSplitRequestPayload";
import { listPrdRequirementIndexEntries } from "../../services/prdRequirementIndex";
import { parsePrdInput } from "../../services/prdSource";
import { savePrdPastedImage } from "../../services/savePrdPastedImage";
import { validateSplitResult } from "../../services/taskSplitValidator";
import {
  PROMPT_SLOT_PRD_TASK_SPLIT_PHASE1,
  PROMPT_SLOT_PRD_TASK_SPLIT_PHASE2,
  parsePromptStorageRaw,
} from "../../services/splitPromptBundle";
import { prdDocumentToSplitMarkdown } from "../../services/prdDocumentMarkdown";
import { resolveEffectiveSplitPromptTemplate } from "../../services/resolveSplitPromptLayers";
import {
  buildAssistantRuntimeBundleJson,
  DEFAULT_PRD_SPLIT_ASSISTANT_ID,
  parseAssistantRuntimeBundle,
  resolveAssistantRuntime,
  saveAssistantRuntimeOverrides,
  type AssistantBundleItem,
} from "../../services/assistantPromptLayers";
import { listMcpServers } from "../../services/mcp";
import { listAssistants } from "../../services/assistants";
import {
  listLegacyRuns,
  readLegacyRun,
  type LegacyRunSummary,
} from "../../services/prdSplit/legacyRunsImport";
import {
  buildRepoAwarePromptSection,
  buildSyntheticSplitResultForRepoPrompt,
} from "../../services/repoTaskSplitPrompt";
import {
  clearRepositorySplitPromptLayers,
  loadRepositorySplitPromptLayers,
  saveRepositorySplitPromptLayers,
} from "../../services/splitPromptLayersStore";
import {
  type ExecutionFanoutSnapshot,
} from "../../services/prdSplit/executionFanout";
import { listActivePrdRuns } from "../../services/prdSplit/activeRuns";
import { buildPrdSplitMissionId } from "../../services/prdSplit/missionIds";
import { runPrdSplitClaude } from "../../services/claudeSplitExecutor";
import {
  resolveTrellisTarget,
  type TrellisTarget,
} from "../PrdSplitWizard/targetModel";
import {
  TASK_AI_DEFAULT_PROMPT_BY_MODE,
  anchorLabelFromTaskId,
  buildSelectionAnchorTextHash,
  createRequirementHistoryId,
  defaultTaskConfirmFilterByTasks,
  dirnameFromAbsolutePath,
  estimateDaysFromSize,
  includesLoosely,
  parseTaskMarkdownDraft,
  parseTaskNumericOrdinal,
  pickMostRelevantRequirementId,
  sameApiSpec,
  stripEmbeddedTaskAnchorsFromRequirementMarkdown,
  taskToMarkdown,
  toErrorMessage,
  type TaskAiMode,
  type TaskConfirmFilter,
} from "./helpers";
import { sameStringArray } from "../../utils/anchorStability";
import { safeUnlisten } from "../../utils/safeTauriUnlisten";
import type {
  RequirementEntry,
  RequirementNameModalMode,
  SplitRuntimeLogDetail,
  SplitPromptDraftBySlot,
  SplitQualitySummary,
  SplitWizardStep,
} from "./types";
import { useSplitRuntimePanel } from "./useSplitRuntimePanel";
import { useRequirementMissionController } from "./useRequirementMissionController";
import { summarizeSplitQuality } from "./splitExecutionQuality";
import {
  inferLikelyExecutionDependencies,
  moveTaskInExecutionPlan,
  moveTaskToExecutionWave,
  type ExecutionPlanMoveDirection,
} from "./executionPlanAdjustments";
import { buildExecutionOrchestrationModel } from "./executionOrchestrationModel";
import {
  buildRequirementAssistantStageItems,
  type RequirementAssistantStageItem,
} from "./stageModel";
import type {
  RequirementMissionMaterializeResult,
  RequirementMissionPlanSummary,
} from "./useRequirementMissionController";

export interface GenerateExecutableTasksResult extends ExecutionFanoutSnapshot {
  materializedResult: RequirementMissionMaterializeResult;
}

export type { RequirementAssistantStageItem };

export interface TrellisTargetSummary {
  title: string;
  subtitle: string;
  rootPath: string;
  repositoryCount: number;
  activeRepositoryLabel: string;
  healthy: boolean;
}

export interface TrellisRuntimeLensTarget {
  rootPath: string;
  projectId: string | null;
}

interface SplitterCompleteEvent {
  clusterId: string;
  status: "succeeded" | "failed" | "cancelled";
  runId?: string;
  runDir: string;
  durationMs: number;
}

export interface PrdTaskSplitPanelControllerInput {
  onClose: () => void;
  projects: ProjectItem[];
  repositories: Repository[];
  activeProjectId: string | null;
  activeRepositoryId: number | null;
  initialProjectId?: string | null;
  initialRepositoryId?: number | null;
}

function scrollToTaskCard(taskId: string) {
  window.requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>(`[data-task-id="${taskId}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

function compactRuntimeDetails(details: Array<SplitRuntimeLogDetail | null | undefined | false>): SplitRuntimeLogDetail[] {
  return details
    .filter((detail): detail is SplitRuntimeLogDetail => Boolean(detail))
    .map((detail) => ({
      label: detail.label.trim(),
      value: detail.value.trim(),
    }))
    .filter((detail) => detail.label.length > 0 && detail.value.length > 0);
}

function formatDurationMs(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function mergeAssistantBundleItems(items: AssistantBundleItem[]): AssistantBundleItem[] {
  const map = new Map<string, AssistantBundleItem>();
  for (const item of items) {
    const id = item.id.trim();
    const label = item.label.trim();
    if (!id || !label) continue;
    if (!map.has(id)) {
      map.set(id, {
        id,
        label,
        origin: item.origin ?? null,
        sourcePath: item.sourcePath,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
}

function buildTrellisTargetSummary(
  target: TrellisTarget | null,
  error: string | null,
): TrellisTargetSummary {
  if (!target) {
    return {
      title: "未绑定 Trellis 目标",
      subtitle: error ?? "请选择 Workspace 或游离仓库",
      rootPath: "",
      repositoryCount: 0,
      activeRepositoryLabel: "无执行仓库",
      healthy: false,
    };
  }
  const activeRepo = target.activeRepositoryId == null
    ? null
    : target.repositories.find((repository) => repository.id === target.activeRepositoryId) ?? null;
  const fallbackRepo = target.defaultExecutionRepositoryId == null
    ? null
    : target.repositories.find((repository) => repository.id === target.defaultExecutionRepositoryId) ?? null;
  const repositoryLabel = activeRepo?.name ?? fallbackRepo?.name ?? "待选择执行仓库";
  return {
    title: target.kind === "workspace" ? `工作区：${target.displayName}` : `仓库：${target.displayName}`,
    subtitle: target.kind === "workspace"
      ? "任务会按当前工作区生成，并派到成员仓库执行"
      : "任务会在当前仓库内生成并执行",
    rootPath: target.rootPath,
    repositoryCount: target.repositories.length,
    activeRepositoryLabel: repositoryLabel,
    healthy: target.rootPath.trim().length > 0 && target.repositories.length > 0,
  };
}

export function usePrdTaskSplitPanelController({
  onClose: _onClose,
  projects,
  repositories,
  activeProjectId,
  activeRepositoryId,
  initialProjectId = null,
  initialRepositoryId = null,
}: PrdTaskSplitPanelControllerInput) {
  const { message } = AntdApp.useApp();
  const [parsing, setParsing] = useState(false);
  const [activeResult, setActiveResult] = useState<SplitResult | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedAnchorTaskId, setSelectedAnchorTaskId] = useState<string | null>(null);
  const [contextMode, setContextMode] = useState<"project" | "repository">("repository");
  const [linkedProjectId, setLinkedProjectId] = useState<string | null>(initialProjectId ?? activeProjectId);
  const [linkedRepositoryId, setLinkedRepositoryId] = useState<number | null>(initialRepositoryId ?? activeRepositoryId);
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
  const [executionFanoutSnapshot, setExecutionFanoutSnapshot] = useState<ExecutionFanoutSnapshot | null>(null);
  const [materializedExecutionResult, setMaterializedExecutionResult] = useState<RequirementMissionMaterializeResult | null>(null);
  const [plannedMissionSummary, setPlannedMissionSummary] = useState<RequirementMissionPlanSummary | null>(null);
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
  const [assistantRuntimeLoading, setAssistantRuntimeLoading] = useState(false);
  const [assistantWorkflowOptions, setAssistantWorkflowOptions] = useState<AssistantWorkflowRef[]>([]);
  const [assistantMcpOptions, setAssistantMcpOptions] = useState<AssistantBundleItem[]>([]);
  const [assistantSelectedMcpIds, setAssistantSelectedMcpIds] = useState<string[]>([]);
  const [assistantHistoryOptions, setAssistantHistoryOptions] = useState<LegacyRunSummary[]>([]);
  const [assistantHistoryLoading, setAssistantHistoryLoading] = useState(false);
  const [activeRequirementId, setActiveRequirementId] = useState<string | null>(null);
  const [splitError, setSplitError] = useState<string | null>(null);
  const [splitQualitySummary, setSplitQualitySummary] = useState<SplitQualitySummary | null>(null);
  const [resolvedTaskAnchorIds, setResolvedTaskAnchorIds] = useState<string[]>([]);
  const [anchorResolveReported, setAnchorResolveReported] = useState(false);
  const [taskConfirmFilter, setTaskConfirmFilter] = useState<TaskConfirmFilter>("unconfirmed");
  const milkdownEditorRef = useRef<MilkdownEditorHandle | null>(null);
  /** 与 `focusTask` 同步，用于在切换任务时清除需求侧区间高亮（避免依赖闭包中的旧 `selectedTaskId`）。 */
  const selectedTaskIdRef = useRef<string | null>(null);
  const taskSplitHostRef = useRef<HTMLDivElement | null>(null);
  const fixedBannerRef = useRef<HTMLDivElement | null>(null);
  const requirementEditorShellRef = useRef<HTMLDivElement | null>(null);
  const urlAnchorAutoBackfilledRef = useRef(false);
  const anchorRangePersistTimerRef = useRef<number | null>(null);
  const latestAnchorRangePersistResultRef = useRef<SplitResult | null>(null);
  const hydratedBackgroundRunIdsRef = useRef<Set<string>>(new Set());
  const activeResultRef = useRef<SplitResult | null>(null);
  const plannedMissionSummaryRef = useRef<RequirementMissionPlanSummary | null>(null);
  const {
    appendSplitRuntimeLog,
    handleRetrySplitStage,
    resetSplitRuntimePanel,
    retryingPhase,
    setSplitRuntimeVisible,
    splitRuntimeListRef,
    splitRuntimeLogs,
    splitRuntimeRef,
    splitRuntimeVisible,
  } = useSplitRuntimePanel({
    requirementEditorShellRef,
    splitPromptAdjustModalOpen,
    splitWizardStep,
    onWarning: message.warning,
  });
  const appendSplitRuntimeLogRef = useRef(appendSplitRuntimeLog);
  useEffect(() => {
    appendSplitRuntimeLogRef.current = appendSplitRuntimeLog;
  }, [appendSplitRuntimeLog]);
  useEffect(() => {
    activeResultRef.current = activeResult;
  }, [activeResult]);
  useEffect(() => {
    plannedMissionSummaryRef.current = plannedMissionSummary;
  }, [plannedMissionSummary]);
  const requirementHistoryById = useMemo(
    () => new Map(requirementHistory.map((item) => [item.id, item])),
    [requirementHistory],
  );

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
  const initialTargetKey = useMemo(
    () => `${initialProjectId?.trim() ?? ""}:${initialRepositoryId ?? ""}`,
    [initialProjectId, initialRepositoryId],
  );
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
  const trellisTargetResolution = useMemo(
    () => resolveTrellisTarget({
      projects,
      repositories,
      activeProjectId,
      activeRepositoryId,
      linkedProjectId,
      linkedRepositoryId,
    }),
    [activeProjectId, activeRepositoryId, linkedProjectId, linkedRepositoryId, projects, repositories],
  );
  const trellisTarget = trellisTargetResolution.ok ? trellisTargetResolution.target : null;
  const trellisTargetError = trellisTargetResolution.ok ? null : trellisTargetResolution.reason;
  const targetProject = useMemo<ProjectItem | null>(() => {
    if (!trellisTarget) return linkedProject;
    if (trellisTarget.kind === "workspace") {
      return projects.find((project) => project.id === trellisTarget.projectId) ?? linkedProject;
    }
    return {
      id: trellisTarget.project.id,
      name: trellisTarget.project.name,
      repositoryIds: [trellisTarget.repositoryId],
      rootPath: trellisTarget.rootPath,
      sddMode: "wise_trellis",
      createdAt: 0,
      updatedAt: 0,
    };
  }, [linkedProject, projects, trellisTarget]);
  const trellisTargetSummary = useMemo(
    () => buildTrellisTargetSummary(trellisTarget, trellisTargetError),
    [trellisTarget, trellisTargetError],
  );
  const trellisRuntimeLensTarget = useMemo<TrellisRuntimeLensTarget | null>(() => {
    if (!trellisTarget?.rootPath.trim()) return null;
    return {
      rootPath: trellisTarget.rootPath,
      projectId: trellisTarget.kind === "workspace" ? trellisTarget.projectId : null,
    };
  }, [trellisTarget]);
  const requirementMission = useRequirementMissionController({ target: trellisTarget });
  const requirementMissionRef = useRef(requirementMission);
  useEffect(() => {
    requirementMissionRef.current = requirementMission;
  }, [requirementMission]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;
    void listen<SplitterCompleteEvent>("splitter-complete", (event) => {
      const payload = event.payload;
      const runId = payload.runId?.trim();
      const runDir = payload.runDir.trim();
      if (!runId || !runDir) return;
      const currentMission = requirementMissionRef.current;
      const currentRun = currentMission.api.state.clusterRuns[payload.clusterId];
      if (currentRun?.raw?.runId !== runId) return;
      void currentMission
        .hydrateClusterRun(payload.clusterId, runId, runDir, payload.status)
        .then((out) => {
          if (cancelled || !out?.result) return;
          const nextResult = syncTaskAnchorTextsFromRequirements(out.result);
          setSplitQualitySummary(summarizeSplitQuality(nextResult.source, nextResult));
          void savePrdTaskSplitResult(nextResult).catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            message.warning(`重试结果保存失败：${msg}`);
          });
          setActiveResult(nextResult);
          setPlannedMissionSummary(null);
          setSelectedTaskId(nextResult.splitTasks[0]?.id ?? null);
          setSplitRuntimeVisible(false);
          appendSplitRuntimeLogRef.current(
            payload.status === "succeeded" ? "assistant" : "error",
            payload.status === "succeeded"
              ? `重试完成，已回流 ${nextResult.splitTasks.length} 个候选任务。`
              : "重试结束但未产出可用任务，请展开分组查看详情。",
            {
              scope: "subagent",
              agentName: "任务生成器",
              clusterId: payload.clusterId,
              title: payload.clusterId,
              status: payload.status,
              details: compactRuntimeDetails([
                { label: "运行目录", value: runDir },
                { label: "耗时", value: formatDurationMs(payload.durationMs) },
              ]),
            },
          );
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          appendSplitRuntimeLogRef.current("error", `重试结果回流失败：${msg}`, {
            scope: "subagent",
            agentName: "任务生成器",
            clusterId: payload.clusterId,
            title: payload.clusterId,
            status: "failed",
          });
        });
    }).then((fn) => {
      if (cancelled) {
        safeUnlisten(fn);
        return;
      }
      unlisten = fn;
    });
    return () => {
      cancelled = true;
      if (unlisten) safeUnlisten(unlisten);
    };
  }, [message]);

  useEffect(() => {
    let cancelled = false;
    setAssistantRuntimeLoading(true);
    void (async () => {
      try {
        const [runtime, mcps] = await Promise.all([
          resolveAssistantRuntime({
            assistantId: DEFAULT_PRD_SPLIT_ASSISTANT_ID,
            projectId: linkedProjectId,
            repositoryId: linkedRepositoryId,
          }),
          listMcpServers(),
        ]);
        if (cancelled) return;
        const runtimeMcps = parseAssistantRuntimeBundle(runtime.mcpBundleJson);
        const mcpOptions = mergeAssistantBundleItems([
          ...runtimeMcps.custom,
          ...mcps.map((mcp) => ({
            id: `mcp:${mcp.id}`,
            label: mcp.name,
            origin: mcp.source,
          })),
        ]);
        setAssistantMcpOptions(mcpOptions);
        setAssistantSelectedMcpIds(
          runtimeMcps.custom
            .filter((item) => !runtimeMcps.disabled.includes(item.id))
            .map((item) => item.id),
        );
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          message.warning(`加载助手资源失败：${msg}`);
        }
      } finally {
        if (!cancelled) setAssistantRuntimeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [linkedProjectId, linkedRepositoryId, message]);
  useEffect(() => {
    let cancelled = false;
    void listAssistants()
      .then((rows) => {
        if (cancelled) return;
        const prdSplit = rows.find((row) => row.id === DEFAULT_PRD_SPLIT_ASSISTANT_ID);
        setAssistantWorkflowOptions(prdSplit?.defaultWorkflows ?? []);
      })
      .catch((err) => {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          message.warning(`加载内置 Trellis 编排失败：${msg}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [message]);
  useEffect(() => {
    let cancelled = false;
    setAssistantHistoryLoading(true);
    listLegacyRuns()
      .then((rows) => {
        if (!cancelled) setAssistantHistoryOptions(rows);
      })
      .catch((err) => {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          message.warning(`加载历史 PRD 失败：${msg}`);
        }
      })
      .finally(() => {
        if (!cancelled) setAssistantHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [message]);
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
      return true;
    });
  }, [activeResult, taskConfirmFilter]);
  const taskConfirmCounts = useMemo(() => {
    const tasks = activeResult?.splitTasks ?? [];
    const confirmedCount = tasks.filter((task) => displayExecutionStatus(task) === "executable").length;
    return {
      confirmedCount,
      unconfirmedCount: tasks.length - confirmedCount,
    };
  }, [activeResult?.splitTasks]);
  const trellisStageItems = useMemo(
    () => buildRequirementAssistantStageItems({
      hasInput,
      parsing,
      hasPlannedSummary: plannedMissionSummary !== null,
      hasResult: Boolean(activeResult),
      allTasksConfirmed: Boolean(
        activeResult
        && activeResult.splitTasks.length > 0
        && taskConfirmCounts.unconfirmedCount === 0,
      ),
      hasMaterializedResult: Boolean(materializedExecutionResult),
      executionStatus: executionFanoutSnapshot?.status ?? null,
    }),
    [
      activeResult,
      executionFanoutSnapshot?.status,
      hasInput,
      materializedExecutionResult,
      parsing,
      plannedMissionSummary,
      taskConfirmCounts.unconfirmedCount,
    ],
  );
  const hasUnconfirmedTasks = taskConfirmCounts.unconfirmedCount > 0;
  const hasConfirmedTasks = taskConfirmCounts.confirmedCount > 0;
  const canGenerateExecutableTasks = Boolean(
    activeResult
    && activeResult.splitTasks.length > 0
    && !hasUnconfirmedTasks
    && hasConfirmedTasks
    && !confirmSavingTaskId,
  );
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
      if (needTabSwitch) {
        setTaskConfirmFilter(targetConfirmFilter);
      }
      if (needTabSwitch) {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            focusTask(taskId);
          });
        });
      } else {
        focusTask(taskId);
      }
    },
    [activeResult?.splitTasks, focusTask, taskConfirmFilter],
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
    let cancelled = false;
    void (async () => {
      const draft = await loadPrdDraft(projectDraftScope);
      if (cancelled) return;
      if (!draft) return;
      const historical = (draft.requirements ?? []).filter((item) => item.requirementDisplayName.trim().length > 0);
      if (historical.length > 0) {
        const sorted = [...historical].sort((a, b) => b.updatedAt - a.updatedAt);
        const pinned = sorted.find((item) => item.isPinned);
        const storedCurrentId = draft.currentRequirementId?.trim();
        const storedCurrent = storedCurrentId ? sorted.find((item) => item.id === storedCurrentId) ?? null : null;
        const selectedId = storedCurrent?.id ?? pinned?.id ?? sorted[0]?.id ?? null;
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
    return () => {
      cancelled = true;
    };
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
    setPlannedMissionSummary(null);
  }, [activeRequirementId]);

  useEffect(() => {
    if (activeProjectId) setLinkedProjectId(activeProjectId);
    if (activeRepositoryId) setLinkedRepositoryId(activeRepositoryId);
  }, [activeProjectId, activeRepositoryId]);

  useEffect(() => {
    if (initialProjectId) {
      setLinkedProjectId(initialProjectId);
      setContextMode("project");
    }
    if (initialRepositoryId != null) {
      setLinkedRepositoryId(initialRepositoryId);
      if (!initialProjectId) setContextMode("repository");
    }
  }, [initialTargetKey, initialProjectId, initialRepositoryId]);

  useEffect(() => {
    if (!trellisTarget?.rootPath || !inputValue.trim()) return;
    if (activeResultRef.current || plannedMissionSummaryRef.current) return;
    let cancelled = false;
    void (async () => {
      const rows = await listActivePrdRuns().catch(() => []);
      if (cancelled) return;
      const targetRoot = trellisTarget.rootPath.trim();
      const expectedMissionId = buildPrdSplitMissionId(trellisTarget.project.id, inputValue);
      const candidates = rows
        .filter((row) => row.projectRootPath.trim() === targetRoot)
        .filter((row) => !row.missionId || row.missionId === expectedMissionId)
        .filter((row) => !hydratedBackgroundRunIdsRef.current.has(row.runId));
      if (candidates.length === 0) return;
      if (activeResultRef.current || plannedMissionSummaryRef.current) return;
      const planResult = await requirementMission.plan(inputValue);
      if (cancelled || !planResult.ok) return;
      setPlannedMissionSummary(planResult.summary);
      setSplitRuntimeVisible(true);
      appendSplitRuntimeLog("system", "已恢复后台任务草案生成进度。", {
        scope: "main",
        agentName: "主会话",
        status: "running",
        title: "恢复进度",
        details: compactRuntimeDetails([
          { label: "后台运行", value: String(candidates.length) },
          { label: "工作目录", value: targetRoot },
        ]),
      });
      for (const row of candidates) {
        hydratedBackgroundRunIdsRef.current.add(row.runId);
        if (cancelled) return;
        if (row.status === "running") {
          requirementMission.api.patchClusterRun(row.clusterId, {
            status: "dispatching",
            parentTaskName: null,
            parentTaskPath: row.parentTaskPath,
            raw: {
              runId: row.runId,
              runDir: row.runDir,
              exitCode: row.exitCode ?? 0,
              durationMs: Math.max(0, Date.now() - row.startedAtMs),
              stdoutPath: row.stdoutPath,
              stderrPath: row.stderrPath,
              rawResultPath: row.rawResultPath,
              rawOutput: null,
              stdoutTruncatedPreview: row.stdoutTail,
            },
            errors: row.error ? [row.error] : [],
            startedAt: row.startedAtMs,
            progress: {
              status: "running",
              progressPercent: 35,
              stageLabel: "后台生成中",
              elapsedMs: Math.max(0, Date.now() - row.startedAtMs),
              error: null,
            },
          });
          appendSplitRuntimeLog("assistant", "任务生成器仍在后台运行。", {
            scope: "subagent",
            agentName: "任务生成器",
            clusterId: row.clusterId,
            title: row.clusterId,
            status: "running",
            details: compactRuntimeDetails([
              { label: "运行目录", value: row.runDir },
              row.stdoutTail ? { label: "输出预览", value: row.stdoutTail } : null,
              row.stderrTail ? { label: "错误预览", value: row.stderrTail } : null,
            ]),
          });
          continue;
        }
        const out = await requirementMission.hydrateClusterRun(
          row.clusterId,
          row.runId,
          row.runDir,
          row.status,
        );
        if (cancelled || !out?.result) continue;
        const nextResult = syncTaskAnchorTextsFromRequirements(out.result);
        setSplitQualitySummary(summarizeSplitQuality(nextResult.source, nextResult));
        await savePrdTaskSplitResult(nextResult).catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          message.warning(`恢复结果保存失败：${msg}`);
        });
        if (cancelled) return;
        setActiveResult(nextResult);
        setPlannedMissionSummary(null);
        setSelectedTaskId(nextResult.splitTasks[0]?.id ?? null);
        setSplitRuntimeVisible(false);
        appendSplitRuntimeLog(row.status === "succeeded" ? "assistant" : "error", row.status === "succeeded"
          ? `已恢复后台结果，回流 ${nextResult.splitTasks.length} 个候选任务。`
          : "后台任务已结束，但未产出可用任务。", {
          scope: "subagent",
          agentName: "任务生成器",
          clusterId: row.clusterId,
          title: row.clusterId,
          status: row.status,
          details: compactRuntimeDetails([
            { label: "运行目录", value: row.runDir },
            row.error ? { label: "错误", value: row.error } : null,
          ]),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    appendSplitRuntimeLog,
    inputValue,
    message,
    requirementMission,
    setSplitRuntimeVisible,
    trellisTarget?.project.id,
    trellisTarget?.rootPath,
  ]);


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
  }, [hasSplitTopFixedBanner, activeResult]);

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

  async function handleParse(
    promptDraftOverrides?: SplitPromptDraftBySlot,
    options?: { splitRuntimeInModal?: boolean },
  ) {
    void promptDraftOverrides;
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
      resetSplitRuntimePanel("生成任务草案", { inModal: splitRuntimeInModal });

      const splitContext = buildPolicyAwareContext();
      logSplitInputPrepareBundle(doc, splitContext, "主编辑器 · 拆分");
      try {
        const rootPath = trellisTarget?.rootPath.trim();
        if (!trellisTarget || !targetProject || !rootPath) {
          throw new Error(trellisTargetError ?? "当前需求助手必须先关联到工作区或仓库。");
        }
        const prdMarkdown = splitSourceInput.trim() || prdDocumentToSplitMarkdown(doc);
        const planResult = await requirementMission.plan(prdMarkdown);
        if (!planResult.ok) {
          throw new Error(planResult.reason);
        }
        const plannedState = requirementMission.api.state;
        setPlannedMissionSummary(planResult.summary);
        setActiveResult(null);
        setSplitQualitySummary(null);
        setMaterializedExecutionResult(null);
        setExecutionFanoutSnapshot(null);
        appendSplitRuntimeLog(
          "system",
          "已读完需求并完成任务草案规划，正在启动任务生成器。",
          {
            scope: "main",
            agentName: "主会话",
            status: "succeeded",
            title: "规划完成",
            details: compactRuntimeDetails([
              { label: "需求分组", value: String(plannedState.plan?.clusters.length ?? 0) },
              { label: "需求条目", value: String(plannedState.requirementsIndex?.requirements.length ?? 0) },
              { label: "工作目录", value: rootPath },
            ]),
          },
        );
        for (const [index, cluster] of (plannedState.plan?.clusters ?? []).entries()) {
          appendSplitRuntimeLog(
            "assistant",
            index === 0
              ? "任务草案计划已生成，即将生成候选任务。"
              : `第 ${index + 1} 组需求已进入任务草案计划。`,
            {
              scope: "subagent",
              agentName: "任务生成器",
              clusterId: cluster.id,
              title: cluster.title,
              status: "queued",
              details: compactRuntimeDetails([
                { label: "需求条目", value: cluster.requirementIds.join(", ") },
              ]),
            },
          );
        }
        appendSplitRuntimeLog(
          "system",
          `已规划 ${planResult.summary.clusters.length} 个需求分组，开始生成候选任务。`,
          {
            scope: "main",
            agentName: "主会话",
            status: "running",
            title: "草案计划就绪",
            details: compactRuntimeDetails([
              { label: "需求分组", value: String(planResult.summary.clusters.length) },
            ]),
          },
        );
        if (splitRuntimeInModal) {
          setSplitWizardStep("runtime");
        } else {
          setSplitRuntimeVisible(true);
        }
        await dispatchPlannedClusters(planResult.summary);
      } catch (e) {
        const msg = toErrorMessage(e, "生成任务草案失败");
        appendSplitRuntimeLog(
          "error",
          msg,
          {
            scope: "main",
            agentName: "主会话",
            status: "failed",
            title: "拆分未完成",
          },
        );
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
      const inferredRole: TaskRole = defaultTaskRoleForRepositoryType(baseResult.context?.repositoryType);
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
    if (trellisTarget) {
      return trellisTarget.context;
    }
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

  function appendClusterRunLog(run: ClusterRunState) {
    const taskCount = run.normalized?.splitTasks.length ?? 0;
    const ok = run.status === "succeeded";
    const status = run.status === "cancelled" ? "cancelled" : ok ? "succeeded" : "failed";
    appendSplitRuntimeLog(
      ok ? "assistant" : "error",
      ok
        ? `任务草案已生成并通过校验，产出 ${taskCount} 个任务。`
        : `任务草案生成失败：${run.errors.join("\n") || run.progress?.error?.summary || "未知错误"}`,
      {
        scope: "subagent",
        agentName: "任务生成器",
        clusterId: run.clusterId,
        title: requirementMission.state.plan?.clusters.find((cluster) => cluster.id === run.clusterId)?.title ?? run.clusterId,
        status,
        details: compactRuntimeDetails([
          { label: "任务数", value: String(taskCount) },
          run.normalized?.splitTasks.length
            ? { label: "任务标题", value: run.normalized.splitTasks.map((task) => task.title).join("\n") }
            : null,
          { label: "耗时", value: formatDurationMs((run.endedAt ?? 0) - (run.startedAt ?? 0)) },
          run.parentTaskPath ? { label: "任务集合", value: run.parentTaskPath } : null,
          run.parentTaskName ? { label: "任务集合名称", value: run.parentTaskName } : null,
          run.raw?.claudeSessionId ? { label: "会话", value: run.raw.claudeSessionId } : null,
          run.raw?.runDir ? { label: "运行目录", value: run.raw.runDir } : null,
          run.raw?.stdoutPath ? { label: "标准输出", value: run.raw.stdoutPath } : null,
          run.raw?.stderrPath ? { label: "错误输出", value: run.raw.stderrPath } : null,
          run.raw?.rawResultPath ? { label: "原始结果", value: run.raw.rawResultPath } : null,
          run.validationIssues?.length
            ? { label: "校验问题", value: run.validationIssues.slice(0, 8).map((issue) => `${issue.path}：${issue.message}`).join("\n") }
            : null,
        ]),
      },
    );
  }

  async function dispatchPlannedClusters(summary: RequirementMissionPlanSummary) {
    setSplitRuntimeVisible(true);
    appendSplitRuntimeLog(
      "system",
      "开始生成任务草案。系统会在后台准备运行记录，完成后回到任务复核区。",
      {
        scope: "main",
        agentName: "主会话",
        status: "running",
        title: "生成开始",
        details: compactRuntimeDetails([
          { label: "需求分组", value: String(summary.clusters.length) },
        ]),
      },
    );
    const out = await requirementMission.dispatchClusters();
    const allRuns = out?.allClusterRuns ?? Object.values(requirementMission.api.state.clusterRuns);
    for (const run of allRuns) {
      appendClusterRunLog(run);
    }
    if (!out) {
      throw new Error("未产出有效任务草案，请展开分组查看失败详情。");
    }
    const nextResult = syncTaskAnchorTextsFromRequirements(out.result);
    setSplitQualitySummary(summarizeSplitQuality(nextResult.source, nextResult));
    await savePrdTaskSplitResult(nextResult);
    setActiveResult(nextResult);
    setPlannedMissionSummary(null);
    setSelectedTaskId(nextResult.splitTasks[0]?.id ?? null);
    setSplitRuntimeVisible(false);
    appendSplitRuntimeLog(
      "system",
      "主会话已开始汇总任务草案，准备做需求溯源与锚点定位。",
      {
        scope: "main",
        agentName: "主会话",
        status: "running",
        title: "整理任务",
      },
    );
    appendSplitRuntimeLog(
      "system",
      `任务草案已保存，右侧任务列表已刷新（共 ${nextResult.splitTasks.length} 个任务）。`,
      {
        scope: "main",
        agentName: "主会话",
        status: "succeeded",
        title: "拆分完成",
        details: compactRuntimeDetails([
          { label: "任务数", value: String(nextResult.splitTasks.length) },
        ]),
      },
    );
    message.success(`任务草案已生成：${nextResult.splitTasks.length} 个任务`);
  }

  async function handleDispatchPlannedClusters() {
    const summary = plannedMissionSummaryRef.current;
    if (!summary || parsing) return;
    try {
      setParsing(true);
      await dispatchPlannedClusters(summary);
    } catch (err) {
      const msg = toErrorMessage(err, "生成任务草案失败");
      appendSplitRuntimeLog("error", msg, {
        scope: "main",
        agentName: "主会话",
        status: "failed",
        title: "生成未完成",
      });
      message.warning(`任务草案生成：${msg}`);
    } finally {
      setParsing(false);
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

  function resetRequirementTaskView() {
    setActiveResult(null);
    setMaterializedExecutionResult(null);
    setExecutionFanoutSnapshot(null);
    setPlannedMissionSummary(null);
    setSelectedTaskId(null);
    setSelectedAnchorTaskId(null);
    setSplitError(null);
    setTaskConfirmFilter("unconfirmed");
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
      if (isStoredSplitResultStale(requirementId, migrated)) {
        resetRequirementTaskView();
        return;
      }
      setPlannedMissionSummary(null);
      setActiveResult(migrated);
    setTaskConfirmFilter(defaultTaskConfirmFilterByTasks(migrated.splitTasks));
    setSelectedTaskId(migrated.splitTasks[0]?.id ?? null);
    setSelectedAnchorTaskId(null);
  }

  /**
   * The PRD draft (left panel) and the persisted split result (right panel)
   * are stored separately under the same requirementId. If the user edits the
   * PRD without re-splitting, reopening the panel would surface a task list
   * derived from a stale PRD. Detect divergence and drop the stale result so
   * the UI shows the empty-state until the user re-splits.
   */
  function isStoredSplitResultStale(requirementId: string, stored: SplitResult): boolean {
    const currentInput = (requirementHistoryById.get(requirementId)?.inputValue ?? "").trim();
    if (!currentInput) return false;
    try {
      const meta = parsePrdInput(currentInput);
      if (meta.sourceType === "url") {
        const storedUrl = (stored.source.sourceRef ?? "").trim();
        return storedUrl !== (meta.rawUrl ?? "").trim();
      }
      const currentRendered = prdDocumentToSplitMarkdown(normalizePrdDocument(meta)).trim();
      const storedRendered = prdDocumentToSplitMarkdown(stored.source).trim();
      return currentRendered !== storedRendered;
    } catch {
      return false;
    }
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

  async function handleImportPrdFile() {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }],
      });
      if (typeof selected !== "string" || !selected.trim()) return;
      const content = await invoke<string>("read_local_text_file", { path: selected });
      if (!content.trim()) {
        message.warning("导入文件为空。");
        return;
      }
      setInputValue(content);
      resetRequirementTaskView();
      message.success("已导入 PRD 文件。");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      message.error(`导入 PRD 失败：${msg}`);
    }
  }

  async function handleImportLegacyPrd(summary: LegacyRunSummary) {
    try {
      const detail = await readLegacyRun(summary.runId);
      if (!detail.prdMarkdown.trim()) {
        message.warning("该历史记录没有可导入的 PRD 内容。");
        return;
      }
      setInputValue(detail.prdMarkdown);
      resetRequirementTaskView();
      message.success("已导入历史 PRD。");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      message.error(`导入历史 PRD 失败：${msg}`);
    }
  }

  async function persistAssistantResourceSelection(input: {
    selectedIds: string[];
    options: AssistantBundleItem[];
  }) {
    const selected = new Set(input.selectedIds);
    const bundle = {
      disabled: input.options.filter((item) => !selected.has(item.id)).map((item) => item.id),
      custom: input.options,
    };
    try {
      await saveAssistantRuntimeOverrides({
        assistantId: DEFAULT_PRD_SPLIT_ASSISTANT_ID,
        scope: "assistant",
        patch: { mcpBundleJson: buildAssistantRuntimeBundleJson(bundle) },
      });
      message.success("已更新助手 MCP。");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      message.error(`保存助手资源失败：${msg}`);
    }
  }

  function handleAssistantMcpsChange(nextIds: string[]) {
    setAssistantSelectedMcpIds(nextIds);
    void persistAssistantResourceSelection({
      selectedIds: nextIds,
      options: assistantMcpOptions,
    });
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

    const out = inferLikelyExecutionDependencies(refreshSplitResultDerivedFields({ ...activeResult, splitTasks: nextTasks }));

    await persistConfirmedTaskAdjustment(taskId, out, allGaps);
  }

  async function handleConfirmAllTasks() {
    if (!activeResult || activeResult.splitTasks.length === 0) return false;
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
    const out = inferLikelyExecutionDependencies(refreshSplitResultDerivedFields({ ...activeResult, splitTasks: nextTasks }));
    const blockedTaskCount = nextTasks.filter((task) => task.executionStatus !== "executable").length;
    setConfirmSavingTaskId("__all__");
    try {
      await savePrdTaskSplitResult(out);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      message.error(`一键确认未能写入数据库，请重试：${msg}`);
      return false;
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
      setSplitRuntimeVisible(false);
    }
    if (blockedTaskCount > 0) {
      message.warning(`已一键确认并写入数据库，其中 ${blockedTaskCount} 条任务仍为不可执行。`);
      return true;
    }
    message.success(`已一键确认并写入数据库（${nextTasks.length} 条任务）。`);
    return true;
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

  async function handleGenerateExecutableTasks(): Promise<GenerateExecutableTasksResult | false> {
    if (!activeResult || activeResult.splitTasks.length === 0) return false;
    const sourceTasks = activeResult.splitTasks.filter((task) => (
      displayExecutionStatus(task) === "executable" && !task.splitSourceTaskId
    ));
    if (sourceTasks.length === 0) {
      message.info("当前没有可用于生成的已确认拆分任务。");
      return false;
    }
    setGeneratingExecutableTaskId("__all__");
    try {
      return await materializeMissionReviewedTasks(sourceTasks);
    } finally {
      setGeneratingExecutableTaskId(null);
    }
  }

  async function materializeMissionReviewedTasks(
    sourceTasks: TaskItem[],
  ): Promise<GenerateExecutableTasksResult | false> {
    if (!activeResult) return false;
    try {
      setMaterializedExecutionResult(null);
      setExecutionFanoutSnapshot(null);
      const initialSnapshot: ExecutionFanoutSnapshot = {
        status: "running",
        workflowRunId: null,
        totalCount: sourceTasks.length,
        doneCount: 0,
        failedCount: 0,
        waves: [],
        message: "任务文件已生成，准备按执行计划开始处理。",
      };
      setExecutionFanoutSnapshot(initialSnapshot);
      const materialized = await requirementMission.materializeReviewedTasks(sourceTasks.map((task) => task.id));
      if (!materialized) {
        throw new Error("没有可生成的任务文件。");
      }
      setMaterializedExecutionResult(materialized);
      const finalSnapshot = buildMissionExecutionSnapshot(activeResult, sourceTasks, materialized);
      setExecutionFanoutSnapshot(finalSnapshot);
      const result: GenerateExecutableTasksResult = {
        ...finalSnapshot,
        materializedResult: materialized,
      };
      if (result.failedCount > 0) {
        message.error(`开始执行：成功 ${result.doneCount}，失败 ${result.failedCount}。`);
      } else {
        message.success(`已开始执行：${result.doneCount} 个任务。`);
      }
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setExecutionFanoutSnapshot((prev) => prev
        ? { ...prev, status: "failed", message: msg }
        : {
          status: "failed",
          workflowRunId: null,
          totalCount: sourceTasks.length,
          doneCount: 0,
          failedCount: sourceTasks.length,
          waves: [],
          message: msg,
        });
      message.error(`开始执行失败：${msg}`);
      return false;
    }
  }

  function buildMissionExecutionSnapshot(
    result: SplitResult,
    sourceTasks: TaskItem[],
    materialized: RequirementMissionMaterializeResult,
  ): ExecutionFanoutSnapshot {
    const childTaskBySourceId = new Map(materialized.childTasks.map((task) => [task.sourceTaskId, task]));
    const waves = result.parallelGroups
      .map((group, waveIndex) => ({
        waveIndex,
        status: "succeeded" as const,
        tasks: group
          .map((taskId) => {
            const sourceTask = sourceTasks.find((task) => task.id === taskId);
            const childTask = childTaskBySourceId.get(taskId);
            if (!sourceTask || !childTask) return null;
            return {
              sourceTaskId: sourceTask.id,
              workflowTaskId: childTask.taskPath,
              title: sourceTask.title,
              status: "succeeded" as const,
              taskName: childTask.taskName,
              taskPath: childTask.taskPath,
              activeTaskPath: childTask.taskPath,
            };
          })
          .filter((task): task is NonNullable<typeof task> => Boolean(task)),
      }))
      .filter((wave) => wave.tasks.length > 0);
    const failedCount = materialized.failedCount;
    return {
      status: failedCount > 0 ? "failed" : "succeeded",
      workflowRunId: null,
      totalCount: sourceTasks.length,
      doneCount: materialized.childTasks.length,
      failedCount,
      waves,
      message: failedCount > 0
        ? "部分任务已生成，但有任务启动失败。"
        : "任务已生成并开始执行。",
    };
  }

  async function handleMoveTaskInExecutionPlan(taskId: string, direction: ExecutionPlanMoveDirection) {
    if (!activeResult) return;
    const out = moveTaskInExecutionPlan(activeResult, taskId, direction);
    if (!out) {
      message.info("当前任务无法继续移动。");
      return;
    }
    await confirmAndPersistExecutionPlanAdjustment(out, taskId);
  }

  async function handleMoveTaskToExecutionWave(taskId: string, waveIndex: number) {
    if (!activeResult) return;
    const out = moveTaskToExecutionWave(activeResult, taskId, waveIndex);
    if (!out) {
      message.info("当前任务无法移动到该波次。");
      return;
    }
    await confirmAndPersistExecutionPlanAdjustment(out, taskId);
  }

  async function confirmAndPersistExecutionPlanAdjustment(out: SplitResult, taskId: string) {
    const conflictWarnings = buildExecutionOrchestrationModel(out).conflictWarnings
      .filter((warning) => warning.relatedTaskIds.includes(taskId));
    if (conflictWarnings.length > 0) {
      Modal.confirm({
        title: "目标波次存在并行冲突",
        content: (
          <div className="app-prd-task-panel__confirm-lines">
            {conflictWarnings.map((warning) => (
              <p key={warning.id}>{warning.message}</p>
            ))}
          </div>
        ),
        okText: "确认强行编排",
        cancelText: "取消拖拽",
        onOk: async () => {
          await persistExecutionPlanAdjustment(out);
        },
      });
      return;
    }
    await persistExecutionPlanAdjustment(out);
  }

  async function persistExecutionPlanAdjustment(out: SplitResult) {
    try {
      await savePrdTaskSplitResult(out);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      message.error(`编排调整保存失败：${msg}`);
      return;
    }
    setActiveResult(out);
    message.success("编排已更新。");
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
      await materializeMissionReviewedTasks([task]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      message.error(`开始执行失败：${msg}`);
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
    const inferredRole: TaskRole = defaultTaskRoleForRepositoryType(baseResult.context?.repositoryType);
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


  return {
    activeRequirement,
    activeRequirementId,
    activeResult,
    assistantMcpOptions,
    assistantHistoryLoading,
    assistantHistoryOptions,
    assistantRuntimeLoading,
    assistantSelectedMcpIds,
    assistantWorkflowOptions,
    anchorRangePersistTimerRef,
    canGenerateExecutableTasks,
    cardUnmetPointsForTask,
    confirmSavingTaskId,
    displayExecutionStatus,
    executionFanoutSnapshot,
    materializedExecutionResult,
    plannedMissionSummary,
    filteredTasks,
    focusTaskWithFilterSync,
    generatingExecutableTaskId,
    getDraftedTask,
    getTaskAiInput,
    getTaskAiMode,
    handleAddTask,
    handleAssistantMcpsChange,
    handleCheckTaskExecutable,
    handleClearAllTasks,
    handleConfirmAllTasks,
    handleConfirmRequirementNameModal,
    handleConfirmTaskAdjustment,
    handleDeleteActiveRequirement,
    handleDeleteTask,
    handleGenerateExecutableForSplitTask,
    handleGenerateExecutableTasks,
    handleDispatchPlannedClusters,
    handleImportLegacyPrd,
    handleImportPrdFile,
    handleMoveTaskInExecutionPlan,
    handleMoveTaskToExecutionWave,
    handleParse,
    handleOpenRuntimePromptModal,
    handleOpenSplitPromptAdjustModal,
    handleOptimizeRuntimePromptDraft,
    handleOptimizeSplitPromptDraft,
    handleOptimizeTaskContent,
    handlePasteImage,
    handlePinActiveRequirement,
    handleResetRuntimePromptToDefault,
    handleRetrySplitStage,
    handleSaveOptimizedTaskContent,
    handleSaveRuntimePromptDraft,
    handleSaveSplitPromptAdjustDrafts,
    handleSaveTaskDraft,
    handleSplitSelection,
    handleStartSplitFromAdjustModal,
    handleUserPersistPrdDraft,
    hasConfirmedTasks,
    hasInput,
    hasUnconfirmedTasks,
    inputError,
    inputValue,
    latestAnchorRangePersistResultRef,
    linkedProject,
    linkedRepository,
    linkedRepositoryId,
    mappingFallbackStats,
    message,
    milkdownEditorRef,
    milkdownTaskAnchors,
    parsing,
    pendingTaskApiSpecById,
    pendingTaskContentById,
    pickRequirementIdForTask,
    promptActionItems,
    requirementDisplayName,
    requirementEditorShellRef,
    requirementHistoryById,
    requirementNameInput,
    requirementNameModalMode,
    requirementNameModalOpen,
    requirementNameSaving,
    resolvedTaskAnchorIds,
    retryingPhase,
    runtimePromptDraftBySlot,
    runtimePromptLoading,
    runtimePromptModalOpen,
    runtimePromptOptimizingSlot,
    runtimePromptSaving,
    runtimePromptSlot,
    savingTaskId,
    scrollToRequirementInPrd,
    scrollToTaskAnchorInPrd,
    selectedAnchorTaskId,
    selectedTaskId,
    setActiveResult,
    setAnchorResolveReported,
    setInputValue,
    setPendingTaskApiSpecById,
    setPendingTaskContentById,
    setRequirementNameInput,
    setRequirementNameModalMode,
    setRequirementNameModalOpen,
    setResolvedTaskAnchorIds,
    setRuntimePromptModalOpen,
    setRuntimePromptSaving,
    setRuntimePromptSlot,
    setSelectedAnchorTaskId,
    setSelectedTaskId,
    setSplitPromptAdjustDraftBySlot,
    setSplitPromptAdjustModalOpen,
    setSplitRuntimeVisible,
    setSplitWizardStep,
    setTaskAiInputById,
    setTaskAiOptimizedContentById,
    setTaskAiPopoverMode,
    setTaskAiPopoverTaskId,
    setTaskAnchorPopoverTaskId,
    setTaskCheckCollapsedById,
    setTaskConfirmFilter,
    setTaskUnmetCollapsedById,
    showUrlAnchorHint,
    sortedRequirementHistory,
    splitError,
    splitPromptAdjustDraftBySlot,
    splitPromptAdjustLoading,
    splitPromptAdjustModalOpen,
    splitPromptAdjustSaving,
    splitPromptAdjustStarting,
    splitPromptOptimizingSlot,
    splitQualityStats,
    splitRuntimeListRef,
    splitRuntimeLogs,
    splitRuntimeRef,
    splitRuntimeVisible,
    splitWizardStep,
    switchToRequirement,
    trellisStageItems,
    trellisTarget,
    trellisTargetError,
    trellisRuntimeLensTarget,
    trellisTargetSummary,
    requirementMission,
    openTaskAiPopover,
    taskAiActionLoadingById,
    taskAiOptimizedContentById,
    taskAiOptimizedReadyById,
    taskAiPopoverMode,
    taskAiPopoverTaskId,
    taskAiSavingTaskId,
    taskAnchorPopoverTaskId,
    taskCheckCollapsedById,
    taskConfirmCounts,
    taskConfirmFilter,
    taskExecutableCheckResultById,
    taskSplitHostRef,
    taskUnmetCollapsedById,
    unmetPreconditionsMenuItems,
    unmetTaskIds,
    updateRuntimePromptDraft,
  };
}

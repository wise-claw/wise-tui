import { useCallback, useState } from "react";
import type { SplitPromptDraftBySlot, SplitWizardStep } from "./types";
import {
  PROMPT_SLOT_PRD_TASK_SPLIT_PHASE1,
  PROMPT_SLOT_PRD_TASK_SPLIT_PHASE2,
  parsePromptStorageRaw,
} from "../../services/splitPromptBundle";
import { resolveEffectiveSplitPromptTemplate } from "../../services/resolveSplitPromptLayers";
import {
  clearRepositorySplitPromptLayers,
  loadRepositorySplitPromptLayers,
  saveRepositorySplitPromptLayers,
} from "../../services/splitPromptLayersStore";
import { materializePrdSnapshot, readSnapshotFile } from "../../services/materializePrdSnapshot";
import { runPrdSplitClaude } from "../../services/claudeSplitExecutor";
import { dirnameFromAbsolutePath } from "./helpers";

type SplitPromptSlot =
  | typeof PROMPT_SLOT_PRD_TASK_SPLIT_PHASE1
  | typeof PROMPT_SLOT_PRD_TASK_SPLIT_PHASE2;

interface PromptFeedback {
  warning: (content: string) => void;
  error: (content: string) => void;
  success: (content: string) => void;
}

interface UseSplitPromptDraftsInput {
  activeResultRepositoryPath: string | null;
  feedback: PromptFeedback;
  linkedProjectId: string | null;
  linkedRepositoryId: number | null;
  linkedRepositoryPath: string | null;
  onStartSplit: (
    promptDraftOverrides: SplitPromptDraftBySlot,
    options: { splitRuntimeInModal: boolean },
  ) => Promise<void>;
}

const EMPTY_PROMPT_DRAFTS: SplitPromptDraftBySlot = {
  [PROMPT_SLOT_PRD_TASK_SPLIT_PHASE1]: "",
  [PROMPT_SLOT_PRD_TASK_SPLIT_PHASE2]: "",
};

export function useSplitPromptDrafts({
  activeResultRepositoryPath,
  feedback,
  linkedProjectId,
  linkedRepositoryId,
  linkedRepositoryPath,
  onStartSplit,
}: UseSplitPromptDraftsInput) {
  const [runtimePromptModalOpen, setRuntimePromptModalOpen] = useState(false);
  const [runtimePromptLoading, setRuntimePromptLoading] = useState(false);
  const [runtimePromptSaving, setRuntimePromptSaving] = useState(false);
  const [runtimePromptOptimizingSlot, setRuntimePromptOptimizingSlot] = useState<string | null>(null);
  const [runtimePromptSlot, setRuntimePromptSlot] = useState<SplitPromptSlot>(PROMPT_SLOT_PRD_TASK_SPLIT_PHASE1);
  const [runtimePromptDraftBySlot, setRuntimePromptDraftBySlot] = useState<Record<string, string>>({
    ...EMPTY_PROMPT_DRAFTS,
  });
  const [splitPromptAdjustModalOpen, setSplitPromptAdjustModalOpen] = useState(false);
  const [splitPromptAdjustLoading, setSplitPromptAdjustLoading] = useState(false);
  const [splitPromptAdjustSaving, setSplitPromptAdjustSaving] = useState(false);
  const [splitPromptAdjustStarting, setSplitPromptAdjustStarting] = useState(false);
  const [splitPromptOptimizingSlot, setSplitPromptOptimizingSlot] = useState<string | null>(null);
  const [splitPromptAdjustDraftBySlot, setSplitPromptAdjustDraftBySlot] = useState<SplitPromptDraftBySlot>({
    ...EMPTY_PROMPT_DRAFTS,
  });
  const [splitWizardStep, setSplitWizardStep] = useState<SplitWizardStep>("prompts");

  const loadSplitPromptDraftsForEditing = useCallback(async (): Promise<SplitPromptDraftBySlot> => {
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
  }, [linkedProjectId, linkedRepositoryId]);

  const handleOpenRuntimePromptModal = useCallback(async () => {
    if (!linkedRepositoryId) {
      feedback.warning("请先在下方「项目 / 仓库」区域关联仓库，再查看拆分执行提示词。");
      return;
    }
    setRuntimePromptModalOpen(true);
    setRuntimePromptLoading(true);
    try {
      setRuntimePromptDraftBySlot(await loadSplitPromptDraftsForEditing());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      feedback.error(`加载拆分执行提示词失败：${msg}`);
    } finally {
      setRuntimePromptLoading(false);
    }
  }, [feedback, linkedRepositoryId, loadSplitPromptDraftsForEditing]);

  const handleOpenSplitPromptAdjustModal = useCallback(async () => {
    setSplitWizardStep("prompts");
    setSplitPromptAdjustModalOpen(true);
    setSplitPromptAdjustLoading(true);
    try {
      setSplitPromptAdjustDraftBySlot(await loadSplitPromptDraftsForEditing());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      feedback.error(`加载拆分执行提示词失败：${msg}`);
    } finally {
      setSplitPromptAdjustLoading(false);
    }
  }, [feedback, loadSplitPromptDraftsForEditing]);

  const updateRuntimePromptDraft = useCallback((slot: string, value: string) => {
    setRuntimePromptDraftBySlot((prev) => ({ ...prev, [slot]: value }));
  }, []);

  const handleSaveRuntimePromptDraft = useCallback(async () => {
    if (runtimePromptOptimizingSlot) return;
    if (!linkedRepositoryId) return;
    const currentDraft = runtimePromptDraftBySlot[runtimePromptSlot]?.trim() ?? "";
    if (!currentDraft) {
      feedback.warning("提示词不能为空。");
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
      feedback.success("已保存拆分执行提示词。");
      setRuntimePromptModalOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      feedback.error(`保存失败：${msg}`);
    } finally {
      setRuntimePromptSaving(false);
    }
  }, [
    feedback,
    linkedRepositoryId,
    runtimePromptDraftBySlot,
    runtimePromptOptimizingSlot,
    runtimePromptSlot,
  ]);

  const handleSaveSplitPromptAdjustDrafts = useCallback(async () => {
    if (splitPromptOptimizingSlot) return;
    if (!linkedRepositoryId) {
      feedback.warning("请先在下方「项目 / 仓库」区域关联仓库，再保存拆分执行提示词。");
      return;
    }
    const phase1Draft = splitPromptAdjustDraftBySlot[PROMPT_SLOT_PRD_TASK_SPLIT_PHASE1]?.trim() ?? "";
    const phase2Draft = splitPromptAdjustDraftBySlot[PROMPT_SLOT_PRD_TASK_SPLIT_PHASE2]?.trim() ?? "";
    if (!phase1Draft || !phase2Draft) {
      feedback.warning("阶段1和阶段2提示词不能为空。");
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
      feedback.success("已保存拆分执行提示词。");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      feedback.error(`保存失败：${msg}`);
    } finally {
      setSplitPromptAdjustSaving(false);
    }
  }, [feedback, linkedRepositoryId, splitPromptAdjustDraftBySlot, splitPromptOptimizingSlot]);

  const handleStartSplitFromAdjustModal = useCallback(async () => {
    if (splitPromptOptimizingSlot) return;
    const phase1Draft = splitPromptAdjustDraftBySlot[PROMPT_SLOT_PRD_TASK_SPLIT_PHASE1]?.trim() ?? "";
    const phase2Draft = splitPromptAdjustDraftBySlot[PROMPT_SLOT_PRD_TASK_SPLIT_PHASE2]?.trim() ?? "";
    if (!phase1Draft || !phase2Draft) {
      feedback.warning("阶段1和阶段2提示词不能为空。");
      return;
    }
    setSplitPromptAdjustStarting(true);
    try {
      await onStartSplit(
        {
          [PROMPT_SLOT_PRD_TASK_SPLIT_PHASE1]: phase1Draft,
          [PROMPT_SLOT_PRD_TASK_SPLIT_PHASE2]: phase2Draft,
        },
        { splitRuntimeInModal: true },
      );
    } finally {
      setSplitPromptAdjustStarting(false);
    }
  }, [feedback, onStartSplit, splitPromptAdjustDraftBySlot, splitPromptOptimizingSlot]);

  const optimizePromptDraft = useCallback(async (
    slot: SplitPromptSlot,
    currentDraft: string,
    setOptimizingSlot: (slot: string | null) => void,
    onOptimized: (slot: SplitPromptSlot, content: string) => void,
  ) => {
    const projectPath = linkedRepositoryPath ?? activeResultRepositoryPath;
    if (!projectPath) {
      feedback.warning("未关联仓库，无法执行 AI 优化。");
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
    setOptimizingSlot(slot);
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
        feedback.warning("AI 优化未返回有效内容。");
        return;
      }
      onOptimized(slot, cleaned);
      feedback.success(`${slotLabel} 提示词已完成 AI 优化。`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      feedback.error(`AI 优化失败：${msg}`);
    } finally {
      setOptimizingSlot(null);
    }
  }, [activeResultRepositoryPath, feedback, linkedRepositoryPath]);

  const handleOptimizeSplitPromptDraft = useCallback(async (slot: SplitPromptSlot) => {
    if (splitPromptOptimizingSlot || splitPromptAdjustSaving || splitPromptAdjustStarting) return;
    const currentDraft = splitPromptAdjustDraftBySlot[slot]?.trim() ?? "";
    if (!currentDraft) {
      feedback.warning("当前阶段提示词为空，无法优化。");
      return;
    }
    await optimizePromptDraft(
      slot,
      currentDraft,
      setSplitPromptOptimizingSlot,
      (targetSlot, content) => {
        setSplitPromptAdjustDraftBySlot((prev) => ({
          ...prev,
          [targetSlot]: content,
        }));
      },
    );
  }, [
    feedback,
    optimizePromptDraft,
    splitPromptAdjustDraftBySlot,
    splitPromptAdjustSaving,
    splitPromptAdjustStarting,
    splitPromptOptimizingSlot,
  ]);

  const handleOptimizeRuntimePromptDraft = useCallback(async (slot: SplitPromptSlot) => {
    if (runtimePromptOptimizingSlot || runtimePromptSaving || runtimePromptLoading) return;
    const currentDraft = runtimePromptDraftBySlot[slot]?.trim() ?? "";
    if (!currentDraft) {
      feedback.warning("当前阶段提示词为空，无法优化。");
      return;
    }
    await optimizePromptDraft(
      slot,
      currentDraft,
      setRuntimePromptOptimizingSlot,
      (targetSlot, content) => {
        setRuntimePromptDraftBySlot((prev) => ({
          ...prev,
          [targetSlot]: content,
        }));
      },
    );
  }, [
    feedback,
    optimizePromptDraft,
    runtimePromptDraftBySlot,
    runtimePromptLoading,
    runtimePromptOptimizingSlot,
    runtimePromptSaving,
  ]);

  const handleResetRuntimePromptToDefault = useCallback(async () => {
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
      feedback.success("已恢复默认提示词。");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      feedback.error(`恢复默认失败：${msg}`);
    } finally {
      setRuntimePromptSaving(false);
    }
  }, [feedback, linkedProjectId, linkedRepositoryId, runtimePromptSlot, updateRuntimePromptDraft]);

  return {
    handleOpenRuntimePromptModal,
    handleOpenSplitPromptAdjustModal,
    handleOptimizeRuntimePromptDraft,
    handleOptimizeSplitPromptDraft,
    handleResetRuntimePromptToDefault,
    handleSaveRuntimePromptDraft,
    handleSaveSplitPromptAdjustDrafts,
    handleStartSplitFromAdjustModal,
    runtimePromptDraftBySlot,
    runtimePromptLoading,
    runtimePromptModalOpen,
    runtimePromptOptimizingSlot,
    runtimePromptSaving,
    runtimePromptSlot,
    setRuntimePromptModalOpen,
    setRuntimePromptSaving,
    setRuntimePromptSlot,
    setSplitPromptAdjustDraftBySlot,
    setSplitPromptAdjustModalOpen,
    setSplitWizardStep,
    splitPromptAdjustDraftBySlot,
    splitPromptAdjustLoading,
    splitPromptAdjustModalOpen,
    splitPromptAdjustSaving,
    splitPromptAdjustStarting,
    splitPromptOptimizingSlot,
    splitWizardStep,
    updateRuntimePromptDraft,
  };
}

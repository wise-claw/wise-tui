import { useCallback, useEffect, useMemo, useState } from "react";
import { listAssistants } from "../../services/assistants";
import type { AssistantEntry } from "../../types/assistant";
import { DEFAULT_PRD_SPLIT_ASSISTANT_ID } from "../../services/assistantPromptLayers";
import {
  AssistantConversationView,
  type AssistantConversationMissionControlProps,
  type AssistantConversationPrdTaskSplitPanelProps,
} from "./AssistantConversationView";
import { AssistantHeader } from "./AssistantHeader";
import { AssistantHub } from "./AssistantHub";
import { AssistantSettingsDrawer } from "./AssistantSettingsDrawer";
import "./index.css";

type CockpitSubMode =
  | { kind: "hub" }
  | { kind: "conversation"; assistantId: string };

function cockpitSubModeFromEntry(
  hasInitialTarget: boolean,
  initialAssistantId?: string | null,
): CockpitSubMode {
  const assistantId = initialAssistantId?.trim();
  if (assistantId) {
    return { kind: "conversation", assistantId };
  }
  if (hasInitialTarget) {
    return { kind: "conversation", assistantId: DEFAULT_PRD_SPLIT_ASSISTANT_ID };
  }
  return { kind: "hub" };
}

export interface CockpitSurfaceProps {
  /** 当前 conversation 助手 id 变化时通知宿主（用于需求拆分全屏盖住左栏）。 */
  onActiveAssistantIdChange?: (assistantId: string | null) => void;
  /** 当前选定的工作区 id;影响 hub 是否启用 PRD-split 助手以及对话 header 显示。 */
  activeProjectId: string | null;
  activeProjectName: string | null;
  /** 是否携带显式入口(项目 FAB / 仓库 FAB)。携带时直接进入对话子态。 */
  hasInitialTarget: boolean;
  /** 从会话快捷条「更多」指定内置助手时直接进入该助手对话页。 */
  initialAssistantId?: string | null;
  /** 显式打开助手入口的递增信号;用于同一 cockpit 实例内重复打开。 */
  openRequestKey: number;
  /** 透传给现有 MissionControl 内核(Wave B 拆为 ChatPane / ArtifactPane)。 */
  missionControlProps: AssistantConversationMissionControlProps;
  /** 透传给现有 PRD 拆分面板,作为需求助手主工作台。 */
  prdTaskSplitPanelProps: AssistantConversationPrdTaskSplitPanelProps;
}

/**
 * Cockpit 主屏壳(D1):管理 `cockpitSubMode` 在 `hub` ↔ `conversation`
 * 之间切换。不引入新 ViewMode kind(宪法 §3 4-kind 约束)。
 */
export function CockpitSurface({
  activeProjectId,
  activeProjectName,
  hasInitialTarget,
  initialAssistantId = null,
  openRequestKey,
  missionControlProps,
  prdTaskSplitPanelProps,
  onActiveAssistantIdChange,
}: CockpitSurfaceProps) {
  const [subMode, setSubMode] = useState<CockpitSubMode>(() =>
    cockpitSubModeFromEntry(hasInitialTarget, initialAssistantId),
  );
  const [assistants, setAssistants] = useState<AssistantEntry[] | null>(null);
  const [settingsAssistantId, setSettingsAssistantId] = useState<string | null>(null);

  // 拉一次助手列表用于 Header 渲染;失败不致命(Header 退化为简标题)。
  useEffect(() => {
    let cancelled = false;
    listAssistants()
      .then((rows) => {
        if (!cancelled) setAssistants(rows);
      })
      .catch(() => {
        if (!cancelled) setAssistants([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 显式入口变更(项目 FAB / 仓库 FAB / 左栏助手)时切换子态。
  useEffect(() => {
    if (openRequestKey <= 0) return;
    setSubMode(cockpitSubModeFromEntry(hasInitialTarget, initialAssistantId));
  }, [hasInitialTarget, initialAssistantId, openRequestKey]);

  const activeAssistant = useMemo(() => {
    if (subMode.kind !== "conversation") return null;
    return assistants?.find((a) => a.id === subMode.assistantId) ?? null;
  }, [assistants, subMode]);
  const settingsAssistant = useMemo(() => {
    if (!settingsAssistantId) return null;
    return assistants?.find((a) => a.id === settingsAssistantId) ?? null;
  }, [assistants, settingsAssistantId]);

  const handleSelectAssistant = useCallback((assistantId: string) => {
    setSubMode({ kind: "conversation", assistantId });
  }, []);

  const handleBackToHub = useCallback(() => {
    setSubMode({ kind: "hub" });
  }, []);

  const handleOpenSettings = useCallback((assistantId: string) => {
    setSettingsAssistantId(assistantId);
  }, []);

  const handleOpenActiveSettings = useCallback(() => {
    if (activeAssistant) setSettingsAssistantId(activeAssistant.id);
  }, [activeAssistant]);

  const handleCloseSettings = useCallback(() => {
    setSettingsAssistantId(null);
  }, []);

  const isPrdSplitConversation =
    subMode.kind === "conversation" && subMode.assistantId === DEFAULT_PRD_SPLIT_ASSISTANT_ID;

  useEffect(() => {
    if (!onActiveAssistantIdChange) return;
    onActiveAssistantIdChange(subMode.kind === "conversation" ? subMode.assistantId : null);
  }, [onActiveAssistantIdChange, subMode]);

  return (
    <div
      className={`cockpit-surface${isPrdSplitConversation ? " cockpit-surface--prd-split-fullscreen" : ""}`}
    >
      <AssistantHeader
        assistant={activeAssistant}
        activeProjectName={activeProjectName}
        showBackToHub={subMode.kind === "conversation"}
        backClosesSurface={isPrdSplitConversation}
        onBackToHub={
          isPrdSplitConversation ? prdTaskSplitPanelProps.onClose : handleBackToHub
        }
        onOpenChat={prdTaskSplitPanelProps.onClose}
        onOpenSettings={activeAssistant ? handleOpenActiveSettings : undefined}
      />
      <div className="cockpit-surface__body">
        {subMode.kind === "hub" ? (
          <AssistantHub
            activeProjectId={activeProjectId}
            activeProjectName={activeProjectName}
            onOpenChat={prdTaskSplitPanelProps.onClose}
            onSelectAssistant={handleSelectAssistant}
            onOpenAssistantSettings={handleOpenSettings}
          />
        ) : (
          <AssistantConversationView
            assistantId={subMode.assistantId}
            assistant={activeAssistant}
            activeProjectId={activeProjectId}
            activeProjectName={activeProjectName}
            missionControlProps={missionControlProps}
            prdTaskSplitPanelProps={prdTaskSplitPanelProps}
            onOpenSettings={handleOpenActiveSettings}
          />
        )}
      </div>
      <AssistantSettingsDrawer
        open={settingsAssistantId !== null}
        assistant={settingsAssistant}
        activeProjectId={activeProjectId}
        activeProjectName={activeProjectName}
        onClose={handleCloseSettings}
      />
    </div>
  );
}

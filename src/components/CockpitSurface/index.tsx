import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App as AntdApp } from "antd";
import { listAssistants } from "../../services/assistants";
import type { AssistantEntry } from "../../types/assistant";
import {
  WORKFLOW_UI_EVENT_RUN_ASSISTANT_BRIEF,
  type RunAssistantBriefDetail,
} from "../../constants/workflowUiEvents";
import {
  hydrateCockpitConversations,
  latestCockpitConversationForAssistant,
  useCockpitConversations,
} from "../../services/cockpitConversationStore";
import { useCockpitRunFinalizer } from "../../hooks/useCockpitRunFinalizer";
import { openWorkspaceRequirementExecutionSession } from "../../stores/workspaceMemoPanelStore";
import type { CockpitConversationRecord } from "../../utils/cockpitConversation";
import { AssistantConversationView } from "./AssistantConversationView";
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
    return { kind: "hub" };
  }
  return { kind: "hub" };
}

export interface CockpitSurfaceProps {
  onActiveAssistantIdChange?: (assistantId: string | null) => void;
  activeProjectId: string | null;
  activeProjectName: string | null;
  activeRepositoryPath: string | null;
  activeRepositoryName: string | null;
  hasInitialTarget: boolean;
  initialAssistantId?: string | null;
  openRequestKey: number;
  resumeAssistantId?: string | null;
  onClose: () => void;
  onClearInitialAssistant?: () => void;
}

export function CockpitSurface({
  activeProjectId,
  activeProjectName,
  activeRepositoryPath,
  activeRepositoryName,
  hasInitialTarget,
  initialAssistantId = null,
  openRequestKey,
  resumeAssistantId = null,
  onClose,
  onActiveAssistantIdChange,
  onClearInitialAssistant,
}: CockpitSurfaceProps) {
  const { message } = AntdApp.useApp();
  const [subMode, setSubMode] = useState<CockpitSubMode>(() =>
    cockpitSubModeFromEntry(hasInitialTarget, initialAssistantId),
  );
  const [assistants, setAssistants] = useState<AssistantEntry[] | null>(null);
  const [settingsAssistantId, setSettingsAssistantId] = useState<string | null>(null);
  const resumeAssistantIdRef = useRef(resumeAssistantId);
  resumeAssistantIdRef.current = resumeAssistantId;
  const conversations = useCockpitConversations();
  useCockpitRunFinalizer();

  useEffect(() => {
    void hydrateCockpitConversations();
  }, []);

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

  useEffect(() => {
    if (openRequestKey <= 0) return;
    setSubMode(
      cockpitSubModeFromEntry(
        hasInitialTarget,
        initialAssistantId ?? resumeAssistantIdRef.current,
      ),
    );
  }, [hasInitialTarget, initialAssistantId, openRequestKey]);

  const activeAssistant = useMemo(() => {
    if (subMode.kind !== "conversation") return null;
    return assistants?.find((a) => a.id === subMode.assistantId) ?? null;
  }, [assistants, subMode]);
  const settingsAssistant = useMemo(() => {
    if (!settingsAssistantId) return null;
    return assistants?.find((a) => a.id === settingsAssistantId) ?? null;
  }, [assistants, settingsAssistantId]);

  const handleSelectAssistant = useCallback(
    (assistantId: string) => {
      onClearInitialAssistant?.();
      setSubMode({ kind: "conversation", assistantId });
    },
    [onClearInitialAssistant],
  );

  const handleBackToHub = useCallback(() => {
    onClearInitialAssistant?.();
    setSubMode({ kind: "hub" });
  }, [onClearInitialAssistant]);

  const handleOpenRecent = useCallback(
    (record: CockpitConversationRecord) => {
      onClearInitialAssistant?.();
      setSubMode({ kind: "conversation", assistantId: record.assistantId });
      if (record.sessionId) {
        openWorkspaceRequirementExecutionSession(record.sessionId);
      }
    },
    [onClearInitialAssistant],
  );

  const handleSendBrief = useCallback(
    (assistantId: string, request: string) => {
      const assistant = assistants?.find((item) => item.id === assistantId);
      if (!assistant) {
        message.warning("找不到所选助手");
        return;
      }
      if (!activeRepositoryPath?.trim()) {
        message.warning("请先在左栏选择仓库");
        return;
      }
      onClearInitialAssistant?.();
      setSubMode({ kind: "conversation", assistantId });
      window.dispatchEvent(
        new CustomEvent<RunAssistantBriefDetail>(WORKFLOW_UI_EVENT_RUN_ASSISTANT_BRIEF, {
          detail: {
            assistantId: assistant.id,
            assistantName: assistant.name,
            prompt: request,
            projectId: activeProjectId,
            projectName: activeProjectName,
            repositoryPath: activeRepositoryPath,
            repositoryName: activeRepositoryName,
          },
        }),
      );
    },
    [
      activeProjectId,
      activeProjectName,
      activeRepositoryName,
      activeRepositoryPath,
      assistants,
      message,
      onClearInitialAssistant,
    ],
  );

  const handleOpenSettings = useCallback((assistantId: string) => {
    setSettingsAssistantId(assistantId);
  }, []);

  const handleOpenActiveSettings = useCallback(() => {
    if (activeAssistant) setSettingsAssistantId(activeAssistant.id);
  }, [activeAssistant]);

  const handleCloseSettings = useCallback(() => {
    setSettingsAssistantId(null);
  }, []);

  useEffect(() => {
    if (!onActiveAssistantIdChange) return;
    onActiveAssistantIdChange(subMode.kind === "conversation" ? subMode.assistantId : null);
  }, [onActiveAssistantIdChange, subMode]);

  return (
    <div className="cockpit-surface">
      <AssistantHeader
        assistant={activeAssistant}
        activeProjectName={activeProjectName}
        showBackToHub={subMode.kind === "conversation"}
        backClosesSurface={false}
        onBackToHub={handleBackToHub}
        onOpenChat={onClose}
        onOpenSettings={activeAssistant ? handleOpenActiveSettings : undefined}
      />
      <div className="cockpit-surface__body">
        {subMode.kind === "hub" ? (
          <AssistantHub
            activeProjectId={activeProjectId}
            activeProjectName={activeProjectName}
            activeRepositoryPath={activeRepositoryPath}
            activeRepositoryName={activeRepositoryName}
            recentConversations={conversations.records}
            lastAssistantId={conversations.lastAssistantId}
            onOpenChat={onClose}
            onSelectAssistant={handleSelectAssistant}
            onOpenAssistantSettings={handleOpenSettings}
            onSendBrief={handleSendBrief}
            onOpenRecent={handleOpenRecent}
          />
        ) : (
          <AssistantConversationView
            assistantId={subMode.assistantId}
            assistant={activeAssistant}
            activeProjectId={activeProjectId}
            activeProjectName={activeProjectName}
            activeRepositoryPath={activeRepositoryPath}
            activeRepositoryName={activeRepositoryName}
            latestRun={
              activeAssistant ? latestCockpitConversationForAssistant(activeAssistant.id) : null
            }
            onClose={onClose}
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

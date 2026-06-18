import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listAssistants } from "../../services/assistants";
import type { AssistantEntry } from "../../types/assistant";
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
  hasInitialTarget,
  initialAssistantId = null,
  openRequestKey,
  resumeAssistantId = null,
  onClose,
  onActiveAssistantIdChange,
  onClearInitialAssistant,
}: CockpitSurfaceProps) {
  const [subMode, setSubMode] = useState<CockpitSubMode>(() =>
    cockpitSubModeFromEntry(hasInitialTarget, initialAssistantId),
  );
  const [assistants, setAssistants] = useState<AssistantEntry[] | null>(null);
  const [settingsAssistantId, setSettingsAssistantId] = useState<string | null>(null);
  const resumeAssistantIdRef = useRef(resumeAssistantId);
  resumeAssistantIdRef.current = resumeAssistantId;

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
            onOpenChat={onClose}
            onSelectAssistant={handleSelectAssistant}
            onOpenAssistantSettings={handleOpenSettings}
          />
        ) : (
          <AssistantConversationView
            assistantId={subMode.assistantId}
            assistant={activeAssistant}
            activeProjectId={activeProjectId}
            activeProjectName={activeProjectName}
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

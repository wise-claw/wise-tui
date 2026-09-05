import {
  ApartmentOutlined,
  CodeOutlined,
  FolderOpenOutlined,
  LinkOutlined,
  PlayCircleOutlined,
  StopOutlined,
  ThunderboltOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { message, Popover } from "antd";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import {
  partitionSessionQuickActions,
  type SessionQuickActionId,
  type SessionQuickActionsAvailability,
} from "../../constants/sessionQuickActionsLayout";
import {
  filterComposerCommonPhrasesForQuickBar,
  type ComposerCommonPhrase,
} from "../../constants/composerCommonPhrase";
import { dispatchApplyComposerCommonPhrase } from "../../constants/composerCommonPhraseEvents";
import { ComposerCommonPhrasesBar } from "../ClaudeChatInput/ComposerCommonPhrasesBar";
import { useComposerCommonPhrases } from "../../hooks/useComposerCommonPhrases";
import { useHudOverlaySelectOpen } from "../../hooks/useHudOverlaySelectOpen";
import { usePointerClickAction } from "../../hooks/usePointerClickAction";
import { useSessionQuickActionsLayout } from "../../hooks/useSessionQuickActionsLayout";
import {
  wiseHudActivateAssistant,
  wiseHudToggleRepositoryRun,
} from "../../services/wiseHud";
import { openInFinder } from "../../services/repository";
import {
  tryOpenWorkspaceInDefaultTerminal,
  tryOpenWorkspaceInDefaultTerminalWithCommand,
} from "../../services/openWorkspaceWithTerminalPreference";
import { openWorkspaceWithOpenAppTarget } from "../../services/openWorkspaceWithPreference";
import { getOpenAppPreferenceSync, hydrateOpenAppPreference } from "../../services/openAppPreference";
import { isTerminalOpenAppId } from "../../services/macosTerminal";
import { closeRepositoryRunnerTerminal, writeTerminalSession } from "../../services/terminal";
import { DEFAULT_OPEN_APP_TARGETS } from "../OpenAppMenu/constants";
import type { AssistantEntry } from "../../types/assistant";
import { resolveAssistantEntryKind } from "../../utils/assistantTemplateEntry";
import {
  hudSelectPopupContainer,
  isInsideHudQuickActionsPicker,
} from "../../utils/hudSelectPopup";
import {
  isAssistantTemplateQuickActionId,
  resolveSessionQuickActionMeta,
} from "../../utils/sessionQuickAssistantCatalog";
import type { WiseHudSessionSnapshot } from "../../utils/wiseHudSnapshot";
import {
  REPOSITORY_RUNNER_TERMINAL_ID,
  repositoryRunCommandStorageKeys,
} from "../../utils/repositoryRunCommand";
import { shouldIgnoreTerminalError } from "../../utils/terminalErrors";
import "../ClaudeChatInput/ComposerCommonPhrasesBar.css";

export interface HudQuickActionsPickerProps {
  snapshot: WiseHudSessionSnapshot;
  onOverlayWantedChange?: (wanted: boolean) => void;
}

function IconHudQuickActions() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M13 3 5 14h6.5l-1 7 8-11h-6.5l1-7Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function actionMenuIcon(assistant?: AssistantEntry): ReactNode {
  if (assistant) {
    switch (resolveAssistantEntryKind(assistant)) {
      case "open_link":
        return <LinkOutlined />;
      case "run_workflow":
        return <ApartmentOutlined />;
      case "run_script":
        return <CodeOutlined />;
      case "dispatch_direct":
        return <ThunderboltOutlined />;
      default:
        break;
    }
  }
  return <UserOutlined />;
}

const HudQuickActionPill = memo(function HudQuickActionPill({
  id,
  pillLabel,
  assistant,
  onActivate,
}: {
  id: SessionQuickActionId;
  pillLabel: string;
  assistant: AssistantEntry | undefined;
  onActivate: (id: SessionQuickActionId) => void;
}) {
  const activate = useCallback(() => onActivate(id), [id, onActivate]);
  const click = usePointerClickAction(activate);
  return (
    <button
      type="button"
      className="app-session-quick-pill"
      onPointerDown={click.onPointerDown}
      onClick={click.onClick}
    >
      <span className="app-session-quick-pill__icon app-session-quick-pill__icon--neutral" aria-hidden>
        {actionMenuIcon(assistant)}
      </span>
      <span className="app-session-quick-pill__label">{pillLabel}</span>
    </button>
  );
});

const HudWorkspaceQuickActionPill = memo(function HudWorkspaceQuickActionPill({
  label,
  icon,
  disabled,
  onActivate,
}: {
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  onActivate: () => void;
}) {
  const click = usePointerClickAction(onActivate);
  return (
    <button
      type="button"
      className="app-session-quick-pill"
      disabled={disabled}
      onPointerDown={click.onPointerDown}
      onClick={click.onClick}
    >
      <span className="app-session-quick-pill__icon app-session-quick-pill__icon--neutral" aria-hidden>
        {icon}
      </span>
      <span className="app-session-quick-pill__label">{label}</span>
    </button>
  );
});

export function HudQuickActionsPicker({ snapshot, onOverlayWantedChange }: HudQuickActionsPickerProps) {
  const hudSelect = useHudOverlaySelectOpen(true);
  const pointerDownTargetRef = useRef<EventTarget | null>(null);
  const [repositoryRunStatus, setRepositoryRunStatus] = useState(
    snapshot.repositoryRunStatus,
  );
  const { layout, catalog, assistantsById } = useSessionQuickActionsLayout();
  const { phrases: composerCommonPhrases } = useComposerCommonPhrases({
    repositoryId: snapshot.activeRepositoryId,
  });

  const quickBarPhrases = useMemo(
    () => filterComposerCommonPhrasesForQuickBar(composerCommonPhrases),
    [composerCommonPhrases],
  );

  const sessionBusyWithoutEnqueue = snapshot.busy && !snapshot.canSend;
  const phrasesDisabled = !snapshot.sessionId?.trim();

  useEffect(() => {
    setRepositoryRunStatus(snapshot.repositoryRunStatus);
  }, [snapshot]);

  const availability: SessionQuickActionsAvailability = useMemo(
    () => ({
      canNewSession: snapshot.activeRepositoryId != null,
      canCompactContext: false,
    }),
    [snapshot.activeRepositoryId],
  );

  const actionIds = useMemo(() => {
    const { primary, overflow } = partitionSessionQuickActions(layout, availability, catalog);
    const ids = [...primary, ...overflow];
    return ids.filter(isAssistantTemplateQuickActionId);
  }, [layout, availability, catalog]);

  useEffect(() => {
    onOverlayWantedChange?.(hudSelect.overlayWanted);
  }, [hudSelect.overlayWanted, onOverlayWantedChange]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      pointerDownTargetRef.current = event.target;
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, []);

  const close = useCallback(() => {
    hudSelect.onOpenChange(false);
  }, [hudSelect]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        hudSelect.onOpenChange(true);
        return;
      }
      if (isInsideHudQuickActionsPicker(pointerDownTargetRef.current)) {
        return;
      }
      hudSelect.onOpenChange(false);
    },
    [hudSelect],
  );

  const handleAnchorMouseDown = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      // 在 click 之前撑高 HUD 并启动打开计时，避免窗口 resize 吞掉 Popover 的 click trigger。
      if (!hudSelect.open) {
        hudSelect.onOpenChange(true);
      } else {
        hudSelect.prepareOverlay();
      }
    },
    [hudSelect],
  );

  const activateAction = useCallback(
    (id: SessionQuickActionId) => {
      if (isAssistantTemplateQuickActionId(id)) {
        void wiseHudActivateAssistant(id);
        close();
      }
    },
    [close],
  );

  const applyCommonPhrase = useCallback(
    (phrase: ComposerCommonPhrase) => {
      const sessionId = snapshot.sessionId?.trim();
      if (!sessionId) return;
      dispatchApplyComposerCommonPhrase(sessionId, phrase);
      close();
    },
    [close, snapshot.sessionId],
  );

  const activeRepository = useMemo(
    () => snapshot.repositories.find((item) => item.id === snapshot.activeRepositoryId) ?? null,
    [snapshot.activeRepositoryId, snapshot.repositories],
  );

  const activateWorkspaceAction = useCallback(
    async (action: "files" | "terminal" | "ide" | "run") => {
      if (!activeRepository?.path.trim()) {
        message.warning("请先选择仓库");
        return;
      }
      const path = activeRepository.path.trim();
      try {
        if (action === "files") {
          close();
          await openInFinder(path);
          return;
        }
        if (action === "terminal") {
          close();
          const terminalRunKey = repositoryRunCommandStorageKeys(path).terminalRunKey;
          const command = terminalRunKey
            ? (window.localStorage.getItem(terminalRunKey) ?? "").trim()
            : "";
          const result = command
            ? await tryOpenWorkspaceInDefaultTerminalWithCommand(path, command)
            : await tryOpenWorkspaceInDefaultTerminal(path);
          if (!result.ok) message.warning(result.message);
          return;
        }
        if (action === "ide") {
          close();
          await hydrateOpenAppPreference();
          const preferredId =
            activeRepository.openAppId?.trim() || getOpenAppPreferenceSync().trim();
          const isIde = (id: string, kind: string) =>
            kind !== "finder" && !isTerminalOpenAppId(id);
          const target =
            DEFAULT_OPEN_APP_TARGETS.find(
              (item) => item.id === preferredId && isIde(item.id, item.kind),
            ) ?? DEFAULT_OPEN_APP_TARGETS.find((item) => isIde(item.id, item.kind));
          if (!target) {
            message.warning("未找到可用的 IDE");
            return;
          }
          await openWorkspaceWithOpenAppTarget(path, target);
          return;
        }
        if (repositoryRunStatus !== "idle") {
          setRepositoryRunStatus("stopping");
          const workspaceId = String(activeRepository.id);
          try {
            await writeTerminalSession(workspaceId, REPOSITORY_RUNNER_TERMINAL_ID, "\u0003");
          } catch (error) {
            if (!shouldIgnoreTerminalError(error)) throw error;
          }
          try {
            await closeRepositoryRunnerTerminal(workspaceId, path);
          } catch (error) {
            if (!shouldIgnoreTerminalError(error)) throw error;
          }
          setRepositoryRunStatus("idle");
          return;
        }
        setRepositoryRunStatus("running");
        await wiseHudToggleRepositoryRun(activeRepository.id);
      } catch (error) {
        setRepositoryRunStatus(snapshot.repositoryRunStatus);
        message.error(error instanceof Error ? error.message : "操作失败");
      }
    },
    [activeRepository, close, repositoryRunStatus, snapshot.repositoryRunStatus],
  );

  const hasActions = true;
  const hasPhrases = quickBarPhrases.length > 0;

  const panel = (
    <div
      className="app-hud-quick-actions-panel"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {!hasActions && !hasPhrases ? (
        <div className="app-hud-quick-actions-panel__empty">暂无快捷操作</div>
      ) : (
        <>
          {hasActions ? (
            <>
              <div className="app-hud-quick-actions-panel__title">快捷操作</div>
              <div className="app-hud-quick-actions-panel__grid" role="toolbar" aria-label="快捷操作">
                <HudWorkspaceQuickActionPill
                  label="打开文件"
                  icon={<FolderOpenOutlined />}
                  disabled={!activeRepository}
                  onActivate={() => void activateWorkspaceAction("files")}
                />
                <HudWorkspaceQuickActionPill
                  label="打开外部终端"
                  icon={<CodeOutlined />}
                  disabled={!activeRepository}
                  onActivate={() => void activateWorkspaceAction("terminal")}
                />
                <HudWorkspaceQuickActionPill
                  label="打开 IDE"
                  icon={<ApartmentOutlined />}
                  disabled={!activeRepository}
                  onActivate={() => void activateWorkspaceAction("ide")}
                />
                <HudWorkspaceQuickActionPill
                  label={repositoryRunStatus === "idle" ? "开始" : "停止"}
                  icon={
                    repositoryRunStatus === "idle" ? (
                      <PlayCircleOutlined />
                    ) : (
                      <StopOutlined />
                    )
                  }
                  disabled={!activeRepository}
                  onActivate={() => void activateWorkspaceAction("run")}
                />
                {actionIds.map((id) => {
                  const meta = resolveSessionQuickActionMeta(id, catalog);
                  return (
                    <HudQuickActionPill
                      key={id}
                      id={id}
                      pillLabel={meta.pillLabel}
                      assistant={assistantsById.get(id)}
                      onActivate={activateAction}
                    />
                  );
                })}
              </div>
            </>
          ) : null}
          {hasPhrases ? (
            <>
              <div
                className={`app-hud-quick-actions-panel__title${hasActions ? " app-hud-quick-actions-panel__title--section" : ""}`}
              >
                常用语
              </div>
              <ComposerCommonPhrasesBar
                variant="quickBar"
                phrases={quickBarPhrases}
                disabled={phrasesDisabled}
                sessionBusyWithoutEnqueue={sessionBusyWithoutEnqueue}
                onApplyPhrase={applyCommonPhrase}
              />
            </>
          ) : null}
        </>
      )}
    </div>
  );

  return (
    <div className="app-hud-quick-actions-anchor" onMouseDown={handleAnchorMouseDown}>
      <Popover
        trigger="click"
        placement="topLeft"
        arrow={false}
        autoAdjustOverflow={false}
        open={hudSelect.open}
        onOpenChange={handleOpenChange}
        getPopupContainer={hudSelectPopupContainer}
        destroyOnHidden={false}
        classNames={{ root: "app-hud-quick-actions-popover" }}
        styles={{
          container: { padding: 0 },
          content: { padding: 0 },
        }}
        content={panel}
      >
        <button
          type="button"
          className={`app-hud-quick-actions-btn${hudSelect.open ? " app-hud-quick-actions-btn--open" : ""}`}
          aria-expanded={hudSelect.open}
          aria-label="快捷操作"
          title="快捷操作"
        >
          <IconHudQuickActions />
        </button>
      </Popover>
    </div>
  );
}

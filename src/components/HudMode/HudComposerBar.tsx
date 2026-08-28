import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Select } from "antd";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ComposerRegion, type DualPaneComposerRepositoryPickerProps } from "../ClaudeChatInput/composer-region";
import { useHudOverlaySelectOpen } from "../../hooks/useHudOverlaySelectOpen";
import { wiseHudCancel, wiseHudExit, wiseHudNewSession, wiseHudSelectRepository, wiseHudSubmit } from "../../services/wiseHud";
import { HudRuntimePicker } from "./HudRuntimePicker";
import { safeUnlisten } from "../../utils/safeTauriUnlisten";
import { HUD_SELECT_BUILTIN_PLACEMENTS, HUD_SELECT_POPUP_ALIGN, hudSelectPopupContainer } from "../../utils/hudSelectPopup";
import { buildWorkspaceRepositoryFlatSelectOptions } from "../../utils/workspaceRepositoryTreeSelect";
import {
  hudComposerSessionToClaudeSession,
  parseWiseHudActiveChanged,
  WISE_HUD_ACTIVE_EVENT,
  type WiseHudRunStatus,
  type WiseHudSessionSnapshot,
} from "../../utils/wiseHudSnapshot";
import type { ImageAttachmentPart, Repository } from "../../types";
import "./HudComposerBar.css";

export type HudOverlayMode = "none" | "images" | "menu";

export interface HudComposerBarProps {
  snapshot: WiseHudSessionSnapshot;
  onOverlayOpenChange?: (mode: HudOverlayMode) => void;
}

function toHudRepositories(snapshot: WiseHudSessionSnapshot): Repository[] {
  return snapshot.repositories.map((item) => ({
    id: item.id,
    name: item.name,
    path: item.path,
    repositoryType: "document",
    createdAt: "",
    updatedAt: "",
  }));
}

function IconHudExit() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 5H5v4M15 5h4v4M9 19H5v-4M15 19h4v-4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HudRunStatusChip({
  runningCount,
  runStatus,
}: {
  runningCount: number;
  runStatus: WiseHudRunStatus;
}) {
  const label =
    runStatus === "running"
      ? `${runningCount} 个任务运行中`
      : runStatus === "completed"
        ? "全部完成"
        : "暂无运行中的任务";
  return (
    <div
      className={`app-hud-run-chip app-hud-run-chip--${runStatus}`}
      role="status"
      title={label}
      aria-label={label}
    >
      <span className="app-hud-run-chip__indicator" aria-hidden>
        {runStatus === "completed" ? (
          <svg viewBox="0 0 16 16" className="app-hud-run-chip__check">
            <path
              d="M3.5 8.5 6.5 11.5 12.5 4.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
      </span>
      {runStatus === "running" ? (
        <span className="app-hud-run-chip__count">{runningCount}</span>
      ) : runStatus === "completed" ? (
        <span className="app-hud-run-chip__label">完成</span>
      ) : (
        <span className="app-hud-run-chip__label">就绪</span>
      )}
    </div>
  );
}

function IconHudNewSession() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 8v8M8 12h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function HudNewSessionButton({ disabled }: { disabled?: boolean }) {
  return (
    <button
      type="button"
      className="app-hud-new-session-btn"
      aria-label="新建会话"
      title={disabled ? "请先选择仓库" : "新建会话"}
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        void wiseHudNewSession();
      }}
    >
      <IconHudNewSession />
    </button>
  );
}

function HudExitButton() {
  return (
    <button
      type="button"
      className="app-hud-exit-btn"
      aria-label="退出 HUD"
      title="退出 HUD，回到主窗口（⌘⇧H）"
      onClick={() => void wiseHudExit()}
    >
      <IconHudExit />
    </button>
  );
}

function HudRepositorySelect({
  snapshot,
  onOpenChange,
}: {
  snapshot: WiseHudSessionSnapshot;
  onOpenChange?: (open: boolean) => void;
}) {
  const repositories = useMemo(() => toHudRepositories(snapshot), [snapshot]);
  const options = useMemo(
    () =>
      buildWorkspaceRepositoryFlatSelectOptions([], repositories).map((item) => ({
        value: item.value,
        label: item.label,
      })),
    [repositories],
  );
  const hudSelect = useHudOverlaySelectOpen(true);
  const valueKey =
    snapshot.activeRepositoryId != null ? `repo:${snapshot.activeRepositoryId}` : undefined;

  useEffect(() => {
    onOpenChange?.(hudSelect.overlayWanted);
  }, [hudSelect.overlayWanted, onOpenChange]);

  return (
    <div className="app-hud-repo-anchor" onMouseDown={hudSelect.prepareOverlay}>
      <Select
        size="small"
        variant="borderless"
        className="app-claude-dual-pane-repo-picker app-hud-repo-picker"
        classNames={{ popup: { root: "app-claude-dual-pane-repo-picker-dropdown app-hud-repo-picker-dropdown" } }}
        placement="topRight"
        builtinPlacements={HUD_SELECT_BUILTIN_PLACEMENTS}
        popupAlign={HUD_SELECT_POPUP_ALIGN}
        getPopupContainer={hudSelectPopupContainer}
        popupMatchSelectWidth={false}
        listHeight={240}
        showSearch
        optionFilterProp="label"
        title="切换仓库"
        aria-label="选择仓库"
        placeholder="选择仓库"
        open={hudSelect.open}
        value={valueKey}
        options={options}
        onOpenChange={hudSelect.onOpenChange}
        onChange={(value) => {
          const raw = String(value ?? "");
          if (raw.startsWith("repo:")) {
            void wiseHudSelectRepository(Number(raw.slice(5)));
          }
        }}
      />
    </div>
  );
}

export function HudComposerBar({ snapshot, onOverlayOpenChange }: HudComposerBarProps) {
  const session = useMemo(() => hudComposerSessionToClaudeSession(snapshot), [snapshot]);
  const repositories = useMemo(() => toHudRepositories(snapshot), [snapshot]);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [menuOverlay, setMenuOverlay] = useState(false);
  const [runtimeOverlay, setRuntimeOverlay] = useState(false);
  const [previewImage, setPreviewImage] = useState<ImageAttachmentPart | null>(null);

  useEffect(() => {
    setPreviewImage(null);
  }, [session?.id]);

  useEffect(() => {
    if (menuOverlay || runtimeOverlay) setPreviewImage(null);
  }, [menuOverlay, runtimeOverlay]);

  useEffect(() => {
    onOverlayOpenChange?.(
      menuOverlay || runtimeOverlay ? "menu" : previewImage ? "images" : "none",
    );
  }, [menuOverlay, runtimeOverlay, previewImage, onOverlayOpenChange]);

  useEffect(() => {
    if (!previewImage) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setPreviewImage(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [previewImage]);

  const handleHudImagePreviewChange = useCallback((image: ImageAttachmentPart | null) => {
    setPreviewImage((prev) => {
      if (image == null) return null;
      if (prev?.id === image.id) return null;
      return image;
    });
  }, []);

  const dualPaneRepositoryPicker = useMemo<DualPaneComposerRepositoryPickerProps | undefined>(() => {
    if (repositories.length === 0) return undefined;
    return {
      repositories,
      valueKey:
        snapshot.activeRepositoryId != null ? `repo:${snapshot.activeRepositoryId}` : "",
      onSelectRepositoryId: (repositoryId) => {
        void wiseHudSelectRepository(repositoryId);
      },
    };
  }, [repositories, snapshot.activeRepositoryId]);

  const handleExecute = useCallback((sessionId: string, prompt: string) => {
    const text = prompt.replace(/\u200B/g, "").trim();
    if (!text) return;
    void wiseHudSubmit(text, sessionId || snapshot.sessionId);
  }, [snapshot.sessionId]);

  const focusEditor = useCallback(() => {
    const editor = shellRef.current?.querySelector<HTMLElement>(
      ".app-claude-semi-chat-input-wrap .tiptap",
    );
    editor?.focus();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => focusEditor(), 80);
    return () => window.clearTimeout(timer);
  }, [focusEditor, session?.id]);

  useEffect(() => {
    let cancelled = false;
    let unlistenFocus: (() => void) | undefined;
    let unlistenActive: (() => void) | undefined;
    void (async () => {
      try {
        const win = getCurrentWindow();
        const u1 = await win.onFocusChanged(({ payload: focused }) => {
          if (focused) focusEditor();
        });
        const u2 = await listen<unknown>(WISE_HUD_ACTIVE_EVENT, (event) => {
          if (parseWiseHudActiveChanged(event.payload) === true) {
            focusEditor();
          }
        });
        if (cancelled) {
          safeUnlisten(u1);
          safeUnlisten(u2);
          return;
        }
        unlistenFocus = () => safeUnlisten(u1);
        unlistenActive = () => safeUnlisten(u2);
      } catch {
        /* 非 Tauri 预览 */
      }
    })();
    return () => {
      cancelled = true;
      unlistenFocus?.();
      unlistenActive?.();
    };
  }, [focusEditor]);

  return (
    <div className="app-hud-shell" ref={shellRef}>
      <div className="app-hud-drag-shell" data-tauri-drag-region aria-hidden />
      {previewImage ? (
        <button
          type="button"
          className="app-hud-image-float"
          aria-label="关闭图片预览"
          title="点击关闭预览"
          onClick={() => setPreviewImage(null)}
        >
          <img src={previewImage.dataUrl} alt={previewImage.filename} />
        </button>
      ) : null}
      <div className="app-hud-bar">
        <div className="app-hud-bar-drag" data-tauri-drag-region aria-hidden />
        <HudNewSessionButton disabled={snapshot.activeRepositoryId == null} />
        <HudRunStatusChip runningCount={snapshot.runningCount} runStatus={snapshot.runStatus} />
        <span className="app-hud-bar-divider" aria-hidden />
        {session ? (
          <div className="app-hud-composer">
            <ComposerRegion
              session={session}
              gitRepositoryPath={session.repositoryPath}
              onExecute={handleExecute}
              onSessionModelChange={() => undefined}
              onCancel={() => {
                void wiseHudCancel();
              }}
              todos={[]}
              questionRequest={null}
              permissionRequest={null}
              followupItems={[]}
              revertItems={[]}
              respondQuestionAt={() => undefined}
              dismissQuestionAt={() => undefined}
              onRespondToPermission={() => undefined}
              onSendFollowup={() => undefined}
              onRestoreRevert={() => undefined}
              sessionExecutionEngine={snapshot.engine}
              allowSendWhileBusy
              dualPaneRepositoryPicker={dualPaneRepositoryPicker}
              hudChrome
              hudLeadingActions={
                <HudRuntimePicker snapshot={snapshot} onOverlayWantedChange={setRuntimeOverlay} />
              }
              hudTrailingActions={<HudExitButton />}
              onHudOverlayChange={setMenuOverlay}
              onHudImagePreviewChange={handleHudImagePreviewChange}
              draftBucketKey={`hud:${session.id}`}
            />
          </div>
        ) : (
          <>
            <div className="app-hud-empty-hint">选择仓库后可新建会话</div>
            <HudRepositorySelect snapshot={snapshot} onOpenChange={setMenuOverlay} />
            <HudExitButton />
          </>
        )}
      </div>
    </div>
  );
}

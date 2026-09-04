import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { App, Input, Popover } from "antd";
import { useHudOverlaySelectOpen } from "../../hooks/useHudOverlaySelectOpen";
import { useAgentRegistryCodexAvailable } from "../../hooks/useAgentRegistryCodexAvailable";
import { useAgentRegistryCursorAvailable } from "../../hooks/useAgentRegistryCursorAvailable";
import { useAgentRegistryGeminiAvailable } from "../../hooks/useAgentRegistryGeminiAvailable";
import { useAgentRegistryOpencodeAvailable } from "../../hooks/useAgentRegistryOpencodeAvailable";
import { useAgentRegistryQoderAvailable } from "../../hooks/useAgentRegistryQoderAvailable";
import { getClaudeModelPickerOptions, type ClaudeModelPickerOptions } from "../../services/claude";
import {
  getCachedClaudeModelPickerOptions,
  getCachedCodexModels,
  getCachedCursorModels,
  getCachedOpencodeModels,
  getCachedQoderModels,
  loadExecutionEngineModelLists,
  saveCachedClaudeModelPickerOptions,
  saveCachedCodexModels,
  saveCachedCursorModels,
  saveCachedOpencodeModels,
  saveCachedQoderModels,
} from "../../services/executionEngineModelListCache";
import { listCodexModels, type CodexModelListItem } from "../../services/codex";
import { listCursorModels, type CursorModelListItem } from "../../services/cursorAgent";
import { listOpencodeModels, type OpencodeModelListItem } from "../../services/opencode";
import { listQoderModels, type QoderModelListItem } from "../../services/qoder";
import { getClaudeModelProfileStore } from "../../services/claudeModelProfiles";
import { getCachedModelProfileStore } from "../../stores/modelProfileStoreCache";
import type { ClaudeModelProfile } from "../../types/claudeModelProfile";
import { wiseHudSelectRepository, wiseHudSetEngine, wiseHudSetModel } from "../../services/wiseHud";
import {
  isSessionExecutionEngine,
  SESSION_EXECUTION_ENGINE_LABELS,
  SESSION_EXECUTION_ENGINES_OFFERED,
  type SessionExecutionEngine,
} from "../../constants/sessionExecutionEngine";
import { hudSelectPopupContainer, isInsideHudContextPicker } from "../../utils/hudSelectPopup";
import {
  ensureHudCurrentModelOption,
  filterHudPickerItems,
  HUD_CONTEXT_PICKER_TABS,
  hudContextPickerFilterPlaceholder,
  hudRuntimeBusyBlocksEngineSwitch,
  type HudContextPickerTab,
  type HudRuntimeModelOption,
} from "../../utils/hudRuntimeMenu";
import { buildClaudeModelPickerOptions } from "../../utils/claudeModel";
import { buildCodexModelPickerOptions } from "../../utils/codexModel";
import { buildCursorModelPickerOptions } from "../../utils/cursorModel";
import { buildOpencodeModelPickerOptions } from "../../utils/opencodeModel";
import { buildQoderModelPickerOptions } from "../../utils/qoderModel";
import { buildWorkspaceRepositoryFlatSelectOptions } from "../../utils/workspaceRepositoryTreeSelect";
import {
  OPEN_WORKSPACE_ERROR,
  openWorkspaceWithStoredPreference,
} from "../../services/openWorkspaceWithPreference";
import { tryOpenWorkspaceInDefaultTerminal } from "../../services/openWorkspaceWithTerminalPreference";
import { getKnownOpenAppIcon } from "../OpenAppMenu/openAppIcons";
import { repositoryEditorOpenMenuLabel, resolveEffectiveOpenAppId } from "../../utils/openAppScope";
import {
  repositoryTerminalOpenAppIcon,
  repositoryTerminalOpenMenuLabel,
  showRepositoryTerminalOpenMenuItem,
} from "../../utils/repositoryTerminalOpenMenu";
import type { Repository } from "../../types";
import type { WiseHudSessionSnapshot } from "../../utils/wiseHudSnapshot";
import "./HudComposerBar.css";

export interface HudContextPickerProps {
  snapshot: WiseHudSessionSnapshot;
  onOverlayWantedChange?: (wanted: boolean) => void;
}

function toHudRepositories(snapshot: WiseHudSessionSnapshot): Repository[] {
  return snapshot.repositories.map((item) => ({
    id: item.id,
    name: item.name,
    path: item.path,
    openAppId: item.openAppId ?? null,
    repositoryType: "document",
    createdAt: "",
    updatedAt: "",
  }));
}

function isEngineAvailable(
  key: SessionExecutionEngine,
  codexAvailable: boolean,
  cursorAvailable: boolean,
  geminiAvailable: boolean,
  opencodeAvailable: boolean,
  qoderAvailable: boolean,
): boolean {
  if (key === "codex" || key === "codex-rpc") return codexAvailable;
  if (key === "cursor") return cursorAvailable;
  if (key === "gemini") return geminiAvailable;
  if (key === "opencode") return opencodeAvailable;
  if (key === "qoder") return qoderAvailable;
  return true;
}

function IconHudStack() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3 3 8l9 5 9-5-9-5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M3 12.5 12 17.5 21 12.5M3 17l9 5 9-5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconHudChevron() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4 6.25 8 10.25 12 6.25"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface HudModelListSources {
  claudePicker: ClaudeModelPickerOptions | null;
  profiles: readonly ClaudeModelProfile[];
  codexModels: readonly CodexModelListItem[];
  cursorModels: readonly CursorModelListItem[];
  opencodeModels: readonly OpencodeModelListItem[];
  qoderModels: readonly QoderModelListItem[];
}

function collectHudModelOptions(
  engine: SessionExecutionEngine,
  sessionModel: string,
  sources: HudModelListSources,
): HudRuntimeModelOption[] {
  const current = sessionModel.trim();
  if (engine === "claude") {
    return ensureHudCurrentModelOption(
      buildClaudeModelPickerOptions({
        picker: sources.claudePicker,
        profiles: sources.profiles,
        sessionModel: current,
        currentModel: current,
      }),
      current,
    );
  }
  if (engine === "codex" || engine === "codex-rpc") {
    return ensureHudCurrentModelOption(
      buildCodexModelPickerOptions(sources.codexModels, sources.profiles),
      current,
    );
  }
  if (engine === "cursor") {
    return ensureHudCurrentModelOption(
      buildCursorModelPickerOptions(sources.cursorModels),
      current,
    );
  }
  if (engine === "opencode") {
    return ensureHudCurrentModelOption(
      buildOpencodeModelPickerOptions(sources.opencodeModels),
      current,
    );
  }
  if (engine === "qoder") {
    return ensureHudCurrentModelOption(
      buildQoderModelPickerOptions(sources.qoderModels),
      current,
    );
  }
  return ensureHudCurrentModelOption([], current);
}

function HudContextList({
  items,
  emptyText,
  onSelect,
  renderItemActions,
}: {
  items: Array<{
    key: string;
    label: string;
    selected?: boolean;
    disabled?: boolean;
  }>;
  emptyText: string;
  onSelect: (key: string) => void;
  renderItemActions?: (item: { key: string; label: string }) => ReactNode;
}) {
  if (items.length === 0) {
    return <div className="app-hud-context-empty">{emptyText}</div>;
  }
  return (
    <div className="app-hud-context-list" role="listbox">
      {items.map((item) => (
        <div
          key={item.key}
          className={`app-hud-context-item-row${item.selected ? " app-hud-context-item-row--active" : ""}`}
        >
          <button
            type="button"
            role="option"
            aria-selected={item.selected}
            className={`app-hud-context-item${item.selected ? " app-hud-context-item--active" : ""}`}
            disabled={item.disabled}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={() => onSelect(item.key)}
          >
            {item.label}
          </button>
          {renderItemActions?.(item)}
        </div>
      ))}
    </div>
  );
}

export function HudContextPicker({ snapshot, onOverlayWantedChange }: HudContextPickerProps) {
  const { message } = App.useApp();
  const sessionId = snapshot.sessionId;
  const hudSelect = useHudOverlaySelectOpen(true);
  const [tab, setTab] = useState<HudContextPickerTab>("repo");
  const [query, setQuery] = useState("");
  const [optimisticEngine, setOptimisticEngine] = useState<SessionExecutionEngine | null>(null);
  const [optimisticModel, setOptimisticModel] = useState<string | null>(null);
  const [claudePicker, setClaudePicker] = useState<ClaudeModelPickerOptions | null>(
    () => getCachedClaudeModelPickerOptions(),
  );
  const [profiles, setProfiles] = useState<readonly ClaudeModelProfile[]>(
    () => getCachedModelProfileStore()?.profiles ?? [],
  );
  const [codexModels, setCodexModels] = useState<readonly CodexModelListItem[]>(
    () => getCachedCodexModels() ?? [],
  );
  const [cursorModels, setCursorModels] = useState<readonly CursorModelListItem[]>(
    () => getCachedCursorModels() ?? [],
  );
  const [opencodeModels, setOpencodeModels] = useState<readonly OpencodeModelListItem[]>(
    () => getCachedOpencodeModels() ?? [],
  );
  const [qoderModels, setQoderModels] = useState<readonly QoderModelListItem[]>(
    () => getCachedQoderModels() ?? [],
  );
  const pointerDownTargetRef = useRef<EventTarget | null>(null);
  const engine = optimisticEngine ?? snapshot.engine;
  const sessionModel = optimisticModel ?? snapshot.composerSession?.model ?? "";
  const codexAvailable = useAgentRegistryCodexAvailable();
  const cursorAvailable = useAgentRegistryCursorAvailable();
  const geminiAvailable = useAgentRegistryGeminiAvailable();
  const opencodeAvailable = useAgentRegistryOpencodeAvailable();
  const qoderAvailable = useAgentRegistryQoderAvailable();
  const showTerminalOpen = showRepositoryTerminalOpenMenuItem();
  const terminalActionLabel = repositoryTerminalOpenMenuLabel();
  const terminalIconSrc = repositoryTerminalOpenAppIcon();

  const repositories = useMemo(() => toHudRepositories(snapshot), [snapshot]);
  const repoOptions = useMemo(
    () => buildWorkspaceRepositoryFlatSelectOptions([], repositories),
    [repositories],
  );
  const activeRepoLabel =
    repoOptions.find(
      (item) =>
        snapshot.activeRepositoryId != null && item.value === `repo:${snapshot.activeRepositoryId}`,
    )?.label ??
    snapshot.composerSession?.repositoryName?.trim() ??
    "选择仓库";

  useEffect(() => {
    if (optimisticEngine != null && snapshot.engine === optimisticEngine) {
      setOptimisticEngine(null);
    }
  }, [optimisticEngine, snapshot.engine]);

  useEffect(() => {
    const live = snapshot.composerSession?.model ?? "";
    if (optimisticModel != null && live === optimisticModel) {
      setOptimisticModel(null);
    }
  }, [optimisticModel, snapshot.composerSession?.model]);

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

  useEffect(() => {
    if (!hudSelect.open) {
      setQuery("");
      return;
    }
  }, [hudSelect.open]);

  useEffect(() => {
    if (!hudSelect.open || tab !== "model") return;
    let cancelled = false;
    const repositoryPath = snapshot.composerSession?.repositoryPath?.trim() || null;
    void (async () => {
      try {
        const [, store] = await Promise.all([
          loadExecutionEngineModelLists(),
          getClaudeModelProfileStore().catch(() => null),
        ]);
        if (cancelled) return;
        if (store) setProfiles(store.profiles);
        setClaudePicker(getCachedClaudeModelPickerOptions());
        setCodexModels(getCachedCodexModels() ?? []);
        setCursorModels(getCachedCursorModels() ?? []);
        setOpencodeModels(getCachedOpencodeModels() ?? []);
        setQoderModels(getCachedQoderModels() ?? []);

        if (engine === "claude") {
          const picker = await getClaudeModelPickerOptions(repositoryPath);
          if (cancelled) return;
          if (picker.defaultModel || picker.availableModels.length > 0) {
            void saveCachedClaudeModelPickerOptions(picker);
            setClaudePicker(picker);
          }
          return;
        }
        if (engine === "codex" || engine === "codex-rpc") {
          const models = await listCodexModels();
          if (cancelled) return;
          if (models.length > 0) {
            void saveCachedCodexModels(models);
            setCodexModels(models);
          }
          return;
        }
        if (engine === "cursor") {
          const models = await listCursorModels();
          if (cancelled) return;
          if (models.length > 0) {
            void saveCachedCursorModels(models);
            setCursorModels(models);
          }
          return;
        }
        if (engine === "opencode") {
          const models = await listOpencodeModels();
          if (cancelled) return;
          if (models.length > 0) {
            void saveCachedOpencodeModels(models);
            setOpencodeModels(models);
          }
          return;
        }
        if (engine === "qoder") {
          const models = await listQoderModels();
          if (cancelled) return;
          if (models.length > 0) {
            void saveCachedQoderModels(models);
            setQoderModels(models);
          }
        }
      } catch {
        /* 保留已hydrate的缓存列表 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [engine, hudSelect.open, snapshot.composerSession?.repositoryPath, tab]);

  const modelOptions = useMemo(
    () =>
      collectHudModelOptions(engine, sessionModel, {
        claudePicker,
        profiles,
        codexModels,
        cursorModels,
        opencodeModels,
        qoderModels,
      }),
    [
      claudePicker,
      codexModels,
      cursorModels,
      engine,
      opencodeModels,
      profiles,
      qoderModels,
      sessionModel,
    ],
  );

  const engineItems = useMemo(() => {
    return SESSION_EXECUTION_ENGINES_OFFERED.filter((key) => {
      if (key === "claude") return true;
      return isEngineAvailable(
        key,
        codexAvailable,
        cursorAvailable,
        geminiAvailable,
        opencodeAvailable,
        qoderAvailable,
      );
    }).map((key) => ({
      key,
      label: SESSION_EXECUTION_ENGINE_LABELS[key].title,
      selected: key === engine,
      disabled: !sessionId || hudRuntimeBusyBlocksEngineSwitch(engine, key, snapshot.busy),
    }));
  }, [
    engine,
    sessionId,
    snapshot.busy,
    codexAvailable,
    cursorAvailable,
    geminiAvailable,
    opencodeAvailable,
    qoderAvailable,
  ]);

  const repoItems = useMemo(
    () =>
      filterHudPickerItems(repoOptions, query).flatMap((item) => {
        if (!item.value.startsWith("repo:")) return [];
        const repositoryId = Number(item.value.slice(5));
        const repository = repositories.find((entry) => entry.id === repositoryId);
        return [
          {
            key: item.value,
            label: item.label,
            path: repository?.path?.trim() ?? "",
            openAppId: repository?.openAppId ?? null,
            selected:
              snapshot.activeRepositoryId != null &&
              item.value === `repo:${snapshot.activeRepositoryId}`,
          },
        ];
      }),
    [query, repoOptions, repositories, snapshot.activeRepositoryId],
  );

  const engineFiltered = useMemo(
    () => filterHudPickerItems(engineItems, query),
    [engineItems, query],
  );

  const modelFiltered = useMemo(
    () =>
      filterHudPickerItems(modelOptions, query).map((item) => ({
        key: item.value,
        label: item.label,
        selected: item.value === sessionModel.trim(),
        disabled: !sessionId,
      })),
    [modelOptions, query, sessionId, sessionModel],
  );

  const close = useCallback(() => {
    hudSelect.onOpenChange(false);
  }, [hudSelect]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        hudSelect.onOpenChange(true);
        return;
      }
      if (isInsideHudContextPicker(pointerDownTargetRef.current)) {
        return;
      }
      hudSelect.onOpenChange(false);
    },
    [hudSelect],
  );

  const handleAnchorMouseDown = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      if (!hudSelect.open) {
        hudSelect.onOpenChange(true);
      } else {
        hudSelect.prepareOverlay();
      }
    },
    [hudSelect],
  );

  const handleSelect = useCallback(
    (key: string) => {
      if (tab === "repo") {
        if (key.startsWith("repo:")) {
          void wiseHudSelectRepository(Number(key.slice(5)));
        }
        close();
        return;
      }
      if (tab === "engine") {
        if (!isSessionExecutionEngine(key) || !sessionId) return;
        if (hudRuntimeBusyBlocksEngineSwitch(engine, key, snapshot.busy)) return;
        if (key !== engine) {
          setOptimisticEngine(key);
          setOptimisticModel(null);
          void wiseHudSetEngine(key, sessionId);
        }
        close();
        return;
      }
      if (!sessionId || key === sessionModel.trim()) {
        close();
        return;
      }
      setOptimisticModel(key);
      void wiseHudSetModel(key, sessionId);
      close();
    },
    [close, engine, sessionId, sessionModel, snapshot.busy, tab],
  );

  const handleTabChange = useCallback((next: HudContextPickerTab) => {
    setTab(next);
    setQuery("");
  }, []);

  const retainPopupPointer = useCallback((event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const openRepositoryInPreferredEditor = useCallback(
    (path: string, openAppId: string | null | undefined) => {
      const trimmed = path.trim();
      if (!trimmed) {
        message.warning("仓库路径为空");
        return;
      }
      void openWorkspaceWithStoredPreference(trimmed, undefined, openAppId).catch((err: unknown) => {
        const code = err instanceof Error ? err.message : "";
        if (code === OPEN_WORKSPACE_ERROR.NOT_CONFIGURED) {
          message.warning("未配置可用的编辑器或命令，请在中栏顶部「打开方式」中选择");
        } else if (code === OPEN_WORKSPACE_ERROR.EMPTY_PATH) {
          message.warning("仓库路径为空");
        } else if (code === OPEN_WORKSPACE_ERROR.NO_TARGET) {
          message.warning("未找到可用的打开方式");
        } else {
          message.error("编辑器打开失败");
          console.error(err);
        }
      });
    },
    [message],
  );

  const openRepositoryInDefaultTerminal = useCallback(
    (path: string) => {
      const trimmed = path.trim();
      if (!trimmed) {
        message.warning("仓库路径为空");
        return;
      }
      void tryOpenWorkspaceInDefaultTerminal(trimmed).then((result) => {
        if (!result.ok) message.warning(result.message);
      });
    },
    [message],
  );

  const renderRepoItemActions = useCallback(
    (item: { key: string; label: string }) => {
      const repoItem = repoItems.find((entry) => entry.key === item.key);
      if (!repoItem?.path) return null;
      const editorActionLabel = repositoryEditorOpenMenuLabel(repoItem.openAppId);
      const editorIconSrc = getKnownOpenAppIcon(resolveEffectiveOpenAppId(repoItem.openAppId));
      return (
        <div className="app-hud-context-item-actions">
          <button
            type="button"
            className="app-hud-context-item-action app-hud-context-item-action--editor"
            title={`${editorActionLabel}：${item.label}`}
            aria-label={`${editorActionLabel}：${item.label}`}
            onMouseDown={retainPopupPointer}
            onClick={(event) => {
              event.stopPropagation();
              openRepositoryInPreferredEditor(repoItem.path, repoItem.openAppId);
            }}
          >
            {editorIconSrc ? (
              <img className="app-hud-context-item-action__icon" src={editorIconSrc} alt="" aria-hidden />
            ) : (
              <span className="app-hud-context-item-action__fallback" aria-hidden>
                IDE
              </span>
            )}
          </button>
          {showTerminalOpen ? (
            <button
              type="button"
              className="app-hud-context-item-action app-hud-context-item-action--terminal"
              title={`${terminalActionLabel}：${item.label}`}
              aria-label={`${terminalActionLabel}：${item.label}`}
              onMouseDown={retainPopupPointer}
              onClick={(event) => {
                event.stopPropagation();
                openRepositoryInDefaultTerminal(repoItem.path);
              }}
            >
              {terminalIconSrc ? (
                <img
                  className="app-hud-context-item-action__icon"
                  src={terminalIconSrc}
                  alt=""
                  aria-hidden
                />
              ) : (
                <span className="app-hud-context-item-action__fallback" aria-hidden>
                  T
                </span>
              )}
            </button>
          ) : null}
        </div>
      );
    },
    [
      openRepositoryInDefaultTerminal,
      openRepositoryInPreferredEditor,
      repoItems,
      retainPopupPointer,
      showTerminalOpen,
      terminalActionLabel,
      terminalIconSrc,
    ],
  );

  const list =
    tab === "repo" ? (
      <HudContextList
        items={repoItems}
        emptyText="没有匹配的仓库"
        onSelect={handleSelect}
        renderItemActions={renderRepoItemActions}
      />
    ) : tab === "engine" ? (
      <HudContextList
        items={engineFiltered}
        emptyText={sessionId ? "没有匹配的执行环境" : "请先新建会话"}
        onSelect={handleSelect}
      />
    ) : (
      <HudContextList
        items={modelFiltered}
        emptyText={sessionId ? "暂无模型列表" : "请先新建会话"}
        onSelect={handleSelect}
      />
    );

  const panel = (
    <div
      className="app-hud-context-panel"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="app-hud-context-tabs" role="tablist" aria-label="HUD 上下文">
        {HUD_CONTEXT_PICKER_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`app-hud-context-tab${tab === item.id ? " app-hud-context-tab--active" : ""}`}
            onMouseDown={retainPopupPointer}
            onClick={(event) => {
              event.stopPropagation();
              handleTabChange(item.id);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <Input
        size="small"
        allowClear
        value={query}
        placeholder={hudContextPickerFilterPlaceholder(tab)}
        className="app-hud-context-search"
        classNames={{ root: "app-hud-context-search" }}
        onChange={(event) => setQuery(event.target.value)}
      />
      {list}
    </div>
  );

  return (
    <div className="app-hud-context-anchor" onMouseDown={handleAnchorMouseDown}>
      <Popover
        trigger="click"
        placement="topRight"
        arrow={false}
        autoAdjustOverflow={false}
        open={hudSelect.open}
        onOpenChange={handleOpenChange}
        getPopupContainer={hudSelectPopupContainer}
        destroyOnHidden={false}
        classNames={{ root: "app-hud-context-popover" }}
        styles={{
          container: { padding: 0 },
          content: { padding: 0 },
        }}
        content={panel}
      >
        <button
          type="button"
          className={`app-hud-context-pill${hudSelect.open ? " app-hud-context-pill--open" : ""}`}
          aria-expanded={hudSelect.open}
          aria-label="切换仓库、执行环境和模型"
          title={`${activeRepoLabel} · ${SESSION_EXECUTION_ENGINE_LABELS[engine].title}`}
        >
          <span className="app-hud-context-pill__name">{activeRepoLabel}</span>
          <span className="app-hud-context-pill__stack" aria-hidden>
            <IconHudStack />
          </span>
          <span className="app-hud-context-pill__chevron" aria-hidden>
            <IconHudChevron />
          </span>
        </button>
      </Popover>
    </div>
  );
}

import { Dropdown, Input, Spin, type MenuProps } from "antd";
import { HoverHint } from "../shared/HoverHint";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { getClaudeModelPickerOptions } from "../../services/claude";
import { listCursorModels, type CursorModelListItem } from "../../services/cursorAgent";
import { listOpencodeModels, type OpencodeModelListItem } from "../../services/opencode";
import {
  getClaudeModelProfileStore,
  WISE_CLAUDE_USER_SETTINGS_CHANGED,
  WISE_OPEN_MODEL_PICKER,
  type ClaudeUserSettingsChangedDetail,
} from "../../services/claudeModelProfiles";
import { CURSOR_SDK_DEFAULT_MODEL } from "../../constants/cursorSdk";
import { useModelProfileSwitcher } from "../../hooks/useClaudeModelProfileStore";
import { getCachedModelProfileStore, seedModelProfileStoreCache } from "../../stores/modelProfileStoreCache";
import type { ClaudeSession } from "../../types";
import type { ClaudeModelProfile, ModelProfileEngine } from "../../types/claudeModelProfile";
import {
  normalizeModelProfileEngine,
  resolveActiveModelProfileId,
  resolveEffectiveModelForProfileEngine,
} from "../../types/claudeModelProfile";
import {
  formatModelProfileDropdownPartsTitle,
  resolveActiveModelProfileComposerBarLabel,
  resolveModelProfileDropdownParts,
  resolveModelProfileDropdownLabelByModelId,
} from "../../utils/modelProfileDisplay";
import {
  ComposerModelPickerBarLabel,
  ComposerModelPickerMenuLabel,
  splitFlatModelDropdownLabel,
} from "./ComposerModelPickerMenuLabel";
import {
  buildCursorModelPickerOptions,
  formatCursorModelLabel,
  isCursorSdkModelId,
} from "../../utils/cursorModel";
import {
  OPENCODE_DEFAULT_MODEL,
  buildOpencodeModelPickerOptions,
  formatOpencodeModelLabel,
  isOpencodeModelId,
  matchesOpencodeModelPickerFilter,
} from "../../utils/opencodeModel";
import {
  normalizeSessionExecutionEngine,
  type SessionExecutionEngine,
} from "../../constants/sessionExecutionEngine";
import { useComposerActiveProxyRoute } from "../../hooks/useComposerActiveProxyRoute";
import { ClaudeModelTopbarPanelLazy } from "../ClaudeSessions/ClaudeModelTopbarPanel.lazy";
import "../ClaudeSessions/ClaudeModelTopbarTrigger.css";
import "./ComposerModelPicker.css";

const claudeModelTopbarPanelChunk = import("../ClaudeSessions/ClaudeModelTopbarPanel");

function ModelPickerIcon() {
  return (
    <svg
      className="app-composer-model-picker__icon"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  );
}

function findProfileByModelId(
  engine: ModelProfileEngine | null,
  modelId: string,
  store: ReturnType<typeof getCachedModelProfileStore>,
): ClaudeModelProfile | undefined {
  if (!engine || !store) return undefined;
  const trimmed = modelId.trim();
  if (!trimmed) return undefined;
  return store.profiles.find(
    (p) =>
      normalizeModelProfileEngine(p.engine) === engine &&
      (p.modelId ?? "").trim() === trimmed,
  );
}

function stopSemiComposerPointerBubble(event: MouseEvent) {
  event.stopPropagation();
}

function ModelPickerTriggerButton({
  modelBarParts,
  modelBarTitle,
  expanded,
  disabled,
  iconOnly = false,
}: {
  modelBarParts: { company: string; modelName: string };
  modelBarTitle: string;
  expanded: boolean;
  disabled?: boolean;
  /** 右栏紧凑模式：只渲染图标，去掉模型名/厂商与 chevron。 */
  iconOnly?: boolean;
}) {
  return (
    <button
      type="button"
      className={
        "app-composer-model-picker__select" +
        (expanded ? " app-composer-model-picker__select--open" : "") +
        (iconOnly ? " app-composer-model-picker__select--icon-only" : "")
      }
      aria-haspopup="dialog"
      aria-label={`当前模型：${modelBarTitle}`}
      aria-expanded={expanded}
      disabled={disabled}
      onMouseDown={stopSemiComposerPointerBubble}
    >
      <ModelPickerIcon />
      {iconOnly ? null : (
        <>
          <ComposerModelPickerBarLabel
            company={modelBarParts.company}
            modelName={modelBarParts.modelName}
            title={modelBarTitle}
          />
          <svg
            className="app-composer-model-picker__chevron"
            width="8"
            height="8"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </>
      )}
    </button>
  );
}

interface Props {
  session: ClaudeSession;
  sessionExecutionEngine?: SessionExecutionEngine;
  model: string;
  onModelChange: (model: string) => void;
  disabled?: boolean;
  /** 右栏紧凑模式：触发按钮只渲染图标。 */
  iconOnly?: boolean;
}

export function ComposerModelPicker({
  session,
  sessionExecutionEngine: sessionExecutionEngineProp,
  model,
  onModelChange,
  disabled = false,
  iconOnly = false,
}: Props) {
  const sessionExecutionEngine = normalizeSessionExecutionEngine(
    sessionExecutionEngineProp ?? "claude",
  );
  const isCursorEngine = sessionExecutionEngine === "cursor";
  const isOpencodeEngine = sessionExecutionEngine === "opencode";
  /** Cursor / OpenCode：Composer 只选模型，不打开档案配置面板。 */
  const isSelectOnlyEngine = isCursorEngine || isOpencodeEngine;
  const profileEngine: ModelProfileEngine | null = isSelectOnlyEngine
    ? null
    : sessionExecutionEngine === "codex"
      ? "codex"
      : "claude";

  const [claudePicker, setClaudePicker] = useState<
    Awaited<ReturnType<typeof getClaudeModelPickerOptions>> | null
  >(null);
  const [cursorModels, setCursorModels] = useState<CursorModelListItem[] | null>(null);
  const [opencodeModels, setOpencodeModels] = useState<OpencodeModelListItem[] | null>(null);
  const [profileStoreRevision, setProfileStoreRevision] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelMounted, setPanelMounted] = useState(false);
  const [selectOnlyMenuOpen, setSelectOnlyMenuOpen] = useState(false);
  const [selectOnlyFilter, setSelectOnlyFilter] = useState("");
  const selectOnlyFilterInputRef = useRef<HTMLInputElement | null>(null);
  const modelRef = useRef(model);
  modelRef.current = model;

  const { store, setStore, loading: profileStoreLoading } = useModelProfileSwitcher(panelOpen);

  const syncModelIfNeeded = useCallback(
    (next: string) => {
      const trimmed = next.trim();
      if (!trimmed || trimmed === modelRef.current) return;
      onModelChange(trimmed);
    },
    [onModelChange],
  );

  const refreshClaudeModelPicker = useCallback(() => {
    if (isCursorEngine) {
      void listCursorModels().then(setCursorModels);
      return;
    }
    if (isOpencodeEngine) {
      void listOpencodeModels().then(setOpencodeModels);
      return;
    }
    void getClaudeModelPickerOptions(session.repositoryPath).then(setClaudePicker);
  }, [isCursorEngine, isOpencodeEngine, session.repositoryPath]);

  useEffect(() => {
    refreshClaudeModelPicker();
  }, [refreshClaudeModelPicker]);

  useEffect(() => {
    if (!isCursorEngine) return;
    const fromSession = session.model?.trim();
    const nextModel =
      fromSession && isCursorSdkModelId(fromSession, cursorModels ?? undefined)
        ? fromSession
        : CURSOR_SDK_DEFAULT_MODEL;
    syncModelIfNeeded(nextModel);
  }, [isCursorEngine, session.id, session.model, cursorModels, syncModelIfNeeded]);

  useEffect(() => {
    if (!isOpencodeEngine) return;
    const fromSession = session.model?.trim();
    const nextModel =
      fromSession && isOpencodeModelId(fromSession, opencodeModels ?? undefined)
        ? fromSession
        : OPENCODE_DEFAULT_MODEL;
    syncModelIfNeeded(nextModel);
  }, [isOpencodeEngine, session.id, session.model, opencodeModels, syncModelIfNeeded]);

  useEffect(() => {
    void getClaudeModelProfileStore()
      .then((nextStore) => {
        seedModelProfileStoreCache(nextStore);
        setProfileStoreRevision((n) => n + 1);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const onSettingsChanged = (event: Event) => {
      const detail = (event as CustomEvent<ClaudeUserSettingsChangedDetail>).detail;
      if (detail?.storeSnapshot) {
        seedModelProfileStoreCache(detail.storeSnapshot);
        setProfileStoreRevision((n) => n + 1);
      }
      if (!isSelectOnlyEngine) {
        const fromProfile = detail?.effectiveModel?.trim();
        if (fromProfile) {
          syncModelIfNeeded(fromProfile);
        }
      }
      if (detail?.skipComposerPickerRefresh !== true) {
        refreshClaudeModelPicker();
      }
    };
    window.addEventListener(WISE_CLAUDE_USER_SETTINGS_CHANGED, onSettingsChanged);
    return () => window.removeEventListener(WISE_CLAUDE_USER_SETTINGS_CHANGED, onSettingsChanged);
  }, [isSelectOnlyEngine, syncModelIfNeeded, refreshClaudeModelPicker]);

  useEffect(() => {
    const onOpenModelPicker = () => {
      if (isSelectOnlyEngine) {
        setSelectOnlyMenuOpen(true);
        return;
      }
      setPanelOpen(true);
      setPanelMounted(true);
      void claudeModelTopbarPanelChunk;
    };
    window.addEventListener(WISE_OPEN_MODEL_PICKER, onOpenModelPicker);
    return () => window.removeEventListener(WISE_OPEN_MODEL_PICKER, onOpenModelPicker);
  }, [isSelectOnlyEngine]);

  const claudeSettingsModel = claudePicker?.defaultModel?.trim() || null;

  useEffect(() => {
    if (isSelectOnlyEngine) return;
    const fromProfile = profileEngine
      ? resolveEffectiveModelForProfileEngine(
          profileEngine,
          getCachedModelProfileStore(),
        )?.trim()
      : null;
    const fromSession = session.model?.trim();
    const fromCfg = claudeSettingsModel;
    const next = fromProfile || fromSession || fromCfg || "sonnet";
    syncModelIfNeeded(next);
  }, [
    session.id,
    session.model,
    claudeSettingsModel,
    isSelectOnlyEngine,
    profileEngine,
    profileStoreRevision,
    syncModelIfNeeded,
  ]);

  const selectOnlyModelOptions = useMemo(() => {
    if (isCursorEngine) {
      const opts: { value: string; label: string }[] = [];
      const seen = new Set<string>();
      const push = (value: string, label?: string) => {
        const v = value.trim();
        if (!v || seen.has(v)) return;
        seen.add(v);
        opts.push({ value: v, label: label ?? formatCursorModelLabel(v) });
      };
      if (cursorModels && cursorModels.length > 0) {
        for (const item of buildCursorModelPickerOptions(cursorModels)) {
          push(item.value, item.label);
        }
      } else {
        push(CURSOR_SDK_DEFAULT_MODEL);
        push("composer-2.5");
      }
      const sessionModel = session.model?.trim();
      if (sessionModel && isCursorSdkModelId(sessionModel, cursorModels ?? undefined)) {
        push(sessionModel);
      }
      const currentModel = model.trim();
      if (currentModel && isCursorSdkModelId(currentModel, cursorModels ?? undefined)) {
        push(currentModel);
      }
      if (opts.length === 0) push(CURSOR_SDK_DEFAULT_MODEL);
      return opts;
    }
    if (isOpencodeEngine) {
      const opts = buildOpencodeModelPickerOptions(opencodeModels ?? []);
      const seen = new Set(opts.map((o) => o.value));
      const push = (value: string, displayName?: string | null) => {
        const v = value.trim();
        if (!v || seen.has(v)) return;
        seen.add(v);
        opts.push({ value: v, label: formatOpencodeModelLabel(v, displayName) });
      };
      const sessionModel = session.model?.trim();
      if (sessionModel && isOpencodeModelId(sessionModel, opencodeModels ?? undefined)) {
        const known = opencodeModels?.find((item) => item.id === sessionModel);
        push(sessionModel, known?.displayName);
      }
      const currentModel = model.trim();
      if (currentModel && isOpencodeModelId(currentModel, opencodeModels ?? undefined)) {
        const known = opencodeModels?.find((item) => item.id === currentModel);
        push(currentModel, known?.displayName);
      }
      return opts;
    }
    return [];
  }, [
    isCursorEngine,
    isOpencodeEngine,
    cursorModels,
    opencodeModels,
    session.model,
    model,
  ]);

  const selectOnlyMenuItems: MenuProps["items"] = useMemo(() => {
    const filtered = selectOnlyModelOptions.filter((option) =>
      matchesOpencodeModelPickerFilter(selectOnlyFilter, option),
    );
    if (filtered.length === 0) {
      return [
        {
          key: "__no_match__",
          disabled: true,
          label: (
            <ComposerModelPickerMenuLabel
              company=""
              modelName="无匹配模型"
              title="无匹配模型"
            />
          ),
        },
      ];
    }
    return filtered.map((option) => ({
      key: option.value,
      label: (
        <ComposerModelPickerMenuLabel
          company=""
          modelName={option.label}
          title={option.value === option.label ? option.label : `${option.label}（${option.value}）`}
        />
      ),
    }));
  }, [selectOnlyModelOptions, selectOnlyFilter]);

  const handleSelectOnlyMenuOpenChange = useCallback((open: boolean) => {
    setSelectOnlyMenuOpen(open);
    if (!open) {
      setSelectOnlyFilter("");
      return;
    }
    // 打开后聚焦搜索框，便于立刻过滤长列表。
    window.requestAnimationFrame(() => {
      selectOnlyFilterInputRef.current?.focus({ preventScroll: true });
    });
  }, []);

  const modelDisplayLabel = useMemo(() => {
    if (profileEngine) {
      const fromActive = resolveActiveModelProfileComposerBarLabel(
        profileEngine,
        getCachedModelProfileStore(),
      );
      if (fromActive) return fromActive;
    }
    if (isSelectOnlyEngine) {
      return selectOnlyModelOptions.find((o) => o.value === model)?.label ?? model;
    }
    return model;
  }, [selectOnlyModelOptions, model, profileEngine, profileStoreRevision, isSelectOnlyEngine]);

  const modelDisplayTitle = formatModelProfileDropdownPartsTitle(
    splitFlatModelDropdownLabel(modelDisplayLabel),
  );

  const activeProxyRoute = useComposerActiveProxyRoute(sessionExecutionEngine, {
    modelLabel: modelDisplayTitle,
  });

  const modelBarParts = useMemo(() => {
    if (activeProxyRoute) {
      return {
        company: "",
        modelName: activeProxyRoute.label,
      };
    }
    const profileStore = getCachedModelProfileStore();
    if (profileEngine && profileStore) {
      const activeId = resolveActiveModelProfileId(profileEngine, profileStore);
      if (activeId) {
        const activeProfile = profileStore.profiles.find(
          (p) =>
            p.id === activeId &&
            normalizeModelProfileEngine(p.engine) === profileEngine,
        );
        if (activeProfile) {
          return resolveModelProfileDropdownParts(activeProfile);
        }
      }
      const linked = findProfileByModelId(profileEngine, model, profileStore);
      if (linked) return resolveModelProfileDropdownParts(linked);
      const fromModelId = resolveModelProfileDropdownLabelByModelId(
        profileEngine,
        model,
        profileStore,
      );
      if (fromModelId) return splitFlatModelDropdownLabel(fromModelId);
    }
    return splitFlatModelDropdownLabel(modelDisplayLabel);
  }, [activeProxyRoute, modelDisplayLabel, model, profileEngine, profileStoreRevision, sessionExecutionEngine]);

  const modelBarTitle = activeProxyRoute?.tooltip ?? modelDisplayTitle;

  const handlePanelOpenChange = useCallback((next: boolean) => {
    setPanelOpen(next);
    if (next) {
      setPanelMounted(true);
      void claudeModelTopbarPanelChunk;
    }
  }, []);

  const handleSelectOnlyMenuClick = useCallback(
    ({ key }: { key: string }) => {
      if (typeof key !== "string" || key === "__no_match__") return;
      if (key !== model) {
        onModelChange(key);
      }
      setSelectOnlyMenuOpen(false);
      setSelectOnlyFilter("");
    },
    [model, onModelChange],
  );

  const trigger = (
    <ModelPickerTriggerButton
      modelBarParts={modelBarParts}
      modelBarTitle={modelBarTitle}
      expanded={isSelectOnlyEngine ? selectOnlyMenuOpen : panelOpen}
      disabled={disabled}
      iconOnly={iconOnly}
    />
  );

  if (isSelectOnlyEngine) {
    const hintTitle = isCursorEngine ? "切换 Cursor 模型" : "切换 OpenCode 模型";
    const filterPlaceholder = isCursorEngine ? "过滤 Cursor 模型…" : "过滤 OpenCode 模型…";
    return (
      <div className="app-composer-model-picker">
        <div className="app-composer-model-picker__row">
          <Dropdown
            classNames={{ root: "app-composer-model-picker-dropdown-overlay" }}
            popupRender={(menu) => (
              <div
                className="app-composer-model-picker-dropdown-container app-composer-model-picker-dropdown-container--filterable"
                onMouseDown={stopSemiComposerPointerBubble}
              >
                <div
                  className="app-composer-model-picker-dropdown-filter"
                  onMouseDown={stopSemiComposerPointerBubble}
                  onClick={stopSemiComposerPointerBubble}
                >
                  <Input
                    ref={(node) => {
                      selectOnlyFilterInputRef.current = node?.input ?? null;
                    }}
                    size="small"
                    allowClear
                    value={selectOnlyFilter}
                    placeholder={filterPlaceholder}
                    aria-label={filterPlaceholder}
                    onChange={(event) => setSelectOnlyFilter(event.target.value)}
                    onKeyDown={(event) => {
                      // 阻止上下键被外层 Semi 编辑器抢走；Enter 选中当前高亮项由菜单自身处理。
                      event.stopPropagation();
                      if (event.key === "Escape") {
                        event.preventDefault();
                        handleSelectOnlyMenuOpenChange(false);
                      }
                    }}
                  />
                </div>
                <div className="app-composer-model-picker-dropdown-menu-scroll">{menu}</div>
              </div>
            )}
            menu={{
              items: selectOnlyMenuItems,
              selectable: true,
              selectedKeys: [model],
              onClick: handleSelectOnlyMenuClick,
            }}
            trigger={["click"]}
            placement="topRight"
            disabled={disabled}
            open={selectOnlyMenuOpen}
            onOpenChange={handleSelectOnlyMenuOpenChange}
          >
            <HoverHint title={hintTitle} placement="top" open={selectOnlyMenuOpen ? false : undefined}>
              <span
                className="app-composer-model-picker__trigger-wrap"
                onMouseDown={stopSemiComposerPointerBubble}
              >
                {trigger}
              </span>
            </HoverHint>
          </Dropdown>
        </div>
      </div>
    );
  }

  const modelPanelOverlay = (
    <div
      className="app-composer-model-picker-panel-overlay app-claude-model-topbar-popover"
      onMouseDown={stopSemiComposerPointerBubble}
      onClick={stopSemiComposerPointerBubble}
    >
      {panelMounted ? (
        <Suspense
          fallback={
            <div className="app-claude-model-topbar-panel app-claude-model-topbar-panel--loading">
              <Spin />
            </div>
          }
        >
          <ClaudeModelTopbarPanelLazy
            store={store}
            setStore={setStore}
            loading={profileStoreLoading}
            preferredEngine={profileEngine ?? "claude"}
            onApplied={() => setPanelOpen(false)}
          />
        </Suspense>
      ) : (
        <div className="app-claude-model-topbar-panel app-claude-model-topbar-panel--loading">
          <Spin />
        </div>
      )}
    </div>
  );

  return (
    <div className="app-composer-model-picker">
      <div className="app-composer-model-picker__row">
        <Dropdown
          classNames={{
            root:
              "app-composer-model-picker-panel-dropdown app-claude-model-topbar-popover app-composer-model-picker-popover",
          }}
          trigger={["click"]}
          placement="topRight"
          disabled={disabled}
          open={panelOpen}
          onOpenChange={handlePanelOpenChange}
          destroyOnHidden={false}
          getPopupContainer={() => document.body}
          popupRender={() => modelPanelOverlay}
        >
          <HoverHint
            title={activeProxyRoute?.tooltip ?? "模型切换"}
            placement="top"
            open={panelOpen ? false : undefined}
          >
            <span
              className="app-composer-model-picker__trigger-wrap"
              onMouseDown={stopSemiComposerPointerBubble}
            >
              {trigger}
            </span>
          </HoverHint>
        </Dropdown>
      </div>
    </div>
  );
}

import { DeleteOutlined } from "@ant-design/icons";
import { Dropdown, Input, Modal, Spin, message, type MenuProps } from "antd";
import { HoverHint } from "../shared/HoverHint";
import { memo, Suspense, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { getClaudeModelPickerOptions } from "../../services/claude";
import { listCodexModels, type CodexModelListItem } from "../../services/codex";
import { listCursorModels, type CursorModelListItem } from "../../services/cursorAgent";
import { listOpencodeModels, type OpencodeModelListItem } from "../../services/opencode";
import { listQoderModels, type QoderModelListItem } from "../../services/qoder";
import {
  applyClaudeModelProfile,
  clearCodexUserSettings,
  dispatchClaudeUserSettingsChanged,
  dispatchModelProfileStoreChanged,
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
  type OpencodeModelPickerOption,
} from "../../utils/opencodeModel";
import {
  buildCodexModelPickerOptions,
  formatCodexModelLabel,
  isCodexModelId,
  matchesCodexModelPickerFilter,
  type CodexModelPickerOption,
} from "../../utils/codexModel";
import {
  QODER_DEFAULT_MODEL,
  buildQoderModelPickerOptions,
  formatQoderModelLabel,
  isQoderModelId,
  matchesQoderModelPickerFilter,
} from "../../utils/qoderModel";
import {
  buildClaudeModelPickerOptions,
  formatClaudeModelLabel,
  isKnownClaudePickerModel,
} from "../../utils/claudeModel";
import {
  normalizeSessionExecutionEngine,
  type SessionExecutionEngine,
} from "../../constants/sessionExecutionEngine";
import { useComposerActiveProxyRoute } from "../../hooks/useComposerActiveProxyRoute";
import { saveExecutionEngineDefaultModel } from "../../services/executionEngineModelDefaults";
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

function opencodeOptionProviderLabel(option: OpencodeModelPickerOption): string {
  const providerName = option.providerName?.trim();
  if (providerName) return providerName;
  return option.providerId?.trim() ?? "";
}

function matchesClaudeModelPickerFilter(
  query: string,
  option: { value: string; label: string },
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    option.value.toLowerCase().includes(q) ||
    option.label.toLowerCase().includes(q)
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

function ComposerModelPickerImpl({
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
  const isQoderEngine = sessionExecutionEngine === "qoder";
  const isCodexEngine = sessionExecutionEngine === "codex" || sessionExecutionEngine === "codex-rpc";
  const isClaudeEngine = sessionExecutionEngine === "claude";
  /** Cursor / OpenCode / Qoder / Codex / Claude：Composer 快速选择模型；Codex / Claude 另有「管理档案」入口。 */
  const isSelectOnlyEngine =
    isCursorEngine || isOpencodeEngine || isQoderEngine || isCodexEngine || isClaudeEngine;
  const profileEngine: ModelProfileEngine | null = isCodexEngine
    ? "codex"
    : isClaudeEngine
      ? "claude"
      : isSelectOnlyEngine
        ? null
        : "claude";

  const [claudePicker, setClaudePicker] = useState<
    Awaited<ReturnType<typeof getClaudeModelPickerOptions>> | null
  >(null);
  const [codexModels, setCodexModels] = useState<CodexModelListItem[] | null>(null);
  const [cursorModels, setCursorModels] = useState<CursorModelListItem[] | null>(null);
  const [opencodeModels, setOpencodeModels] = useState<OpencodeModelListItem[] | null>(null);
  const [qoderModels, setQoderModels] = useState<QoderModelListItem[] | null>(null);
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
    if (isCodexEngine) {
      void listCodexModels().then(setCodexModels);
      return;
    }
    if (isCursorEngine) {
      void listCursorModels().then(setCursorModels);
      return;
    }
    if (isOpencodeEngine) {
      void listOpencodeModels().then(setOpencodeModels);
      return;
    }
    if (isQoderEngine) {
      void listQoderModels().then(setQoderModels);
      return;
    }
    void getClaudeModelPickerOptions(session.repositoryPath).then(setClaudePicker);
  }, [isCodexEngine, isCursorEngine, isOpencodeEngine, isQoderEngine, session.repositoryPath]);

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
    if (!isQoderEngine) return;
    const fromSession = session.model?.trim();
    const nextModel =
      fromSession && isQoderModelId(fromSession, qoderModels ?? undefined)
        ? fromSession
        : QODER_DEFAULT_MODEL;
    syncModelIfNeeded(nextModel);
  }, [isQoderEngine, session.id, session.model, qoderModels, syncModelIfNeeded]);

  useEffect(() => {
    if (!isCodexEngine) return;
    const fromProfile =
      resolveEffectiveModelForProfileEngine("codex", getCachedModelProfileStore())?.trim() || null;
    const fromSession = session.model?.trim();
    // 会话模型为已知 Codex 模型且与档案不同：视为 Composer 显式切换（运行态模型），不覆盖。
    if (
      fromSession &&
      isCodexModelId(fromSession, codexModels ?? undefined) &&
      fromProfile &&
      fromSession !== fromProfile
    ) {
      return;
    }
    // 档案生效模型优先（与执行解析一致）；无档案时保留会话模型。
    const nextModel = fromProfile || fromSession;
    if (nextModel) syncModelIfNeeded(nextModel);
  }, [isCodexEngine, session.id, session.model, codexModels, syncModelIfNeeded]);

  useEffect(() => {
    if (!isClaudeEngine) return;
    const fromProfile =
      resolveEffectiveModelForProfileEngine("claude", getCachedModelProfileStore())?.trim() || null;
    const fromSession = session.model?.trim();
    // 与 Codex 一致：会话模型为已知 Claude 模型且与档案不同，视为 Composer 显式切换，不覆盖。
    if (
      fromSession &&
      isKnownClaudePickerModel(fromSession, claudePicker) &&
      fromProfile &&
      fromSession !== fromProfile
    ) {
      return;
    }
    // 档案生效模型优先（与执行解析一致）；无档案时保留会话模型/配置默认。
    const nextModel = fromProfile || fromSession || claudePicker?.defaultModel?.trim();
    if (nextModel) syncModelIfNeeded(nextModel);
  }, [isClaudeEngine, session.id, session.model, claudePicker, profileStoreRevision, syncModelIfNeeded]);

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
      if (isCodexEngine) {
        const fromProfile = resolveEffectiveModelForProfileEngine(
          "codex",
          detail?.storeSnapshot ?? getCachedModelProfileStore(),
        )?.trim();
        if (fromProfile) {
          syncModelIfNeeded(fromProfile);
        }
      } else if (isClaudeEngine) {
        // 与 Codex 一致：全局档案切换后同步会话模型（显式切换会被下一次档案事件覆盖）。
        const fromProfile = detail?.effectiveModel?.trim();
        if (fromProfile) {
          syncModelIfNeeded(fromProfile);
        }
      } else if (!isSelectOnlyEngine) {
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
  }, [
    isCodexEngine,
    isClaudeEngine,
    isSelectOnlyEngine,
    syncModelIfNeeded,
    refreshClaudeModelPicker,
  ]);

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
      const push = (
        value: string,
        displayName?: string | null,
        providerId?: string | null,
        providerName?: string | null,
      ) => {
        const v = value.trim();
        if (!v || seen.has(v)) return;
        seen.add(v);
        const option: OpencodeModelPickerOption = {
          value: v,
          label: formatOpencodeModelLabel(v, displayName),
        };
        const providerIdTrimmed = providerId?.trim();
        if (providerIdTrimmed) option.providerId = providerIdTrimmed;
        const providerNameTrimmed = providerName?.trim();
        if (providerNameTrimmed) option.providerName = providerNameTrimmed;
        opts.push(option);
      };
      const sessionModel = session.model?.trim();
      if (sessionModel && isOpencodeModelId(sessionModel, opencodeModels ?? undefined)) {
        const known = opencodeModels?.find((item) => item.id === sessionModel);
        push(sessionModel, known?.displayName, known?.providerId, known?.providerName);
      }
      const currentModel = model.trim();
      if (currentModel && isOpencodeModelId(currentModel, opencodeModels ?? undefined)) {
        const known = opencodeModels?.find((item) => item.id === currentModel);
        push(currentModel, known?.displayName, known?.providerId, known?.providerName);
      }
      return opts;
    }
    if (isQoderEngine) {
      const opts = buildQoderModelPickerOptions(qoderModels ?? []);
      const seen = new Set(opts.map((o) => o.value));
      const push = (value: string, displayName?: string | null) => {
        const v = value.trim();
        if (!v || seen.has(v)) return;
        seen.add(v);
        opts.push({ value: v, label: formatQoderModelLabel(v, displayName) });
      };
      const sessionModel = session.model?.trim();
      if (sessionModel && isQoderModelId(sessionModel, qoderModels ?? undefined)) {
        const known = qoderModels?.find((item) => item.id === sessionModel);
        push(sessionModel, known?.displayName);
      }
      const currentModel = model.trim();
      if (currentModel && isQoderModelId(currentModel, qoderModels ?? undefined)) {
        const known = qoderModels?.find((item) => item.id === currentModel);
        push(currentModel, known?.displayName);
      }
      return opts;
    }
    if (isClaudeEngine) {
      // settings.json 配置模型为权威列表；命中配置模型的档案标注公司并携带 profileId。
      return buildClaudeModelPickerOptions({
        picker: claudePicker,
        profiles: getCachedModelProfileStore()?.profiles ?? [],
        sessionModel: session.model,
        currentModel: model,
      });
    }
    if (isCodexEngine) {
      const codexProfiles = getCachedModelProfileStore()?.profiles ?? [];
      const opts = buildCodexModelPickerOptions(codexModels ?? [], codexProfiles);
      const seen = new Set(opts.map((o) => o.value));
      const push = (value: string, displayName?: string | null, provider?: string | null) => {
        const v = value.trim();
        if (!v || seen.has(v)) return;
        seen.add(v);
        opts.push({
          value: v,
          label: formatCodexModelLabel(v, displayName),
          ...(provider?.trim() ? { providerId: provider.trim() } : {}),
        });
      };
      const sessionModel = session.model?.trim();
      if (sessionModel && isCodexModelId(sessionModel, codexModels ?? undefined)) {
        const known = codexModels?.find((item) => item.id === sessionModel);
        push(sessionModel, known?.displayName, known?.provider);
      }
      const currentModel = model.trim();
      if (currentModel && isCodexModelId(currentModel, codexModels ?? undefined)) {
        const known = codexModels?.find((item) => item.id === currentModel);
        push(currentModel, known?.displayName, known?.provider);
      }
      return opts;
    }
    return [];
  }, [
    isCursorEngine,
    isOpencodeEngine,
    isQoderEngine,
    isCodexEngine,
    isClaudeEngine,
    cursorModels,
    opencodeModels,
    qoderModels,
    codexModels,
    claudePicker,
    profileStoreRevision,
    session.model,
    model,
  ]);

  const selectOnlyMenuItems: MenuProps["items"] = useMemo(() => {
    const filterFn = isQoderEngine
      ? matchesQoderModelPickerFilter
      : isCodexEngine
        ? matchesCodexModelPickerFilter
        : isClaudeEngine
          ? matchesClaudeModelPickerFilter
          : matchesOpencodeModelPickerFilter;
    const filtered = selectOnlyModelOptions.filter((option) =>
      filterFn(selectOnlyFilter, option),
    );
    const items: MenuProps["items"] =
      filtered.length === 0
        ? [
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
          ]
        : filtered.map((option) => ({
            key: option.value,
            label: (
              <ComposerModelPickerMenuLabel
                company={
                  isOpencodeEngine || isCodexEngine
                    ? opencodeOptionProviderLabel(option)
                    : isClaudeEngine
                      ? (option as { company?: string }).company?.trim() ?? ""
                      : ""
                }
                modelName={option.label}
                title={
                  isOpencodeEngine || isCodexEngine || isClaudeEngine
                    ? option.value
                    : option.value === option.label
                      ? option.label
                      : `${option.label}（${option.value}）`
                }
              />
            ),
          }));
    return items;
  }, [
    selectOnlyModelOptions,
    selectOnlyFilter,
    isQoderEngine,
    isCodexEngine,
    isClaudeEngine,
    isOpencodeEngine,
  ]);

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
      const store = getCachedModelProfileStore();
      const fromActive = resolveActiveModelProfileComposerBarLabel(profileEngine, store);
      if (fromActive) {
        if (!isCodexEngine && !isClaudeEngine) return fromActive;
        // Codex / Claude：会话显式切换模型后（与档案不一致），展示所选模型而非档案名。
        const effective = resolveEffectiveModelForProfileEngine(profileEngine, store)?.trim();
        if (effective && model.trim() === effective) return fromActive;
      }
    }
    if (isSelectOnlyEngine) {
      const matched = selectOnlyModelOptions.find((o) => o.value === model);
      if (matched) return matched.label;
      if (isCodexEngine) {
        // 无显式会话模型：回退生效档案/配置模型，仍无则展示「默认」（由 codex 自身决定）。
        const store = getCachedModelProfileStore();
        const fromActive = resolveActiveModelProfileComposerBarLabel("codex", store);
        if (fromActive) return fromActive;
        const effective = resolveEffectiveModelForProfileEngine("codex", store)?.trim();
        if (effective) return formatCodexModelLabel(effective);
        return "默认";
      }
      if (isClaudeEngine) return formatClaudeModelLabel(model);
      return model;
    }
    return model;
  }, [
    selectOnlyModelOptions,
    model,
    profileEngine,
    profileStoreRevision,
    isSelectOnlyEngine,
    isCodexEngine,
    isClaudeEngine,
  ]);

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
          if (!isCodexEngine && !isClaudeEngine) {
            return resolveModelProfileDropdownParts(activeProfile);
          }
          // Codex / Claude：会话显式切换后展示所选模型；仅与会话模型一致时才展示档案。
          const effective = resolveEffectiveModelForProfileEngine(
            profileEngine,
            profileStore,
          )?.trim();
          if (effective && model.trim() === effective) {
            return resolveModelProfileDropdownParts(activeProfile);
          }
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
  }, [
    activeProxyRoute,
    modelDisplayLabel,
    model,
    profileEngine,
    profileStoreRevision,
    sessionExecutionEngine,
    isClaudeEngine,
  ]);

  const modelBarTitle = activeProxyRoute?.tooltip ?? modelDisplayTitle;

  const handlePanelOpenChange = useCallback((next: boolean) => {
    setPanelOpen(next);
    if (next) {
      setPanelMounted(true);
      void claudeModelTopbarPanelChunk;
    }
  }, []);

  const openManageProfilesPanel = useCallback(() => {
    setSelectOnlyMenuOpen(false);
    setSelectOnlyFilter("");
    setPanelOpen(true);
    setPanelMounted(true);
    void claudeModelTopbarPanelChunk;
  }, []);


  const confirmClearCodexSettings = useCallback(() => {
    setSelectOnlyMenuOpen(false);
    Modal.confirm({
      title: "清空 Codex 配置？",
      content: "将同时清空当前用户的 auth.json 与 config.toml，此操作不可恢复。",
      okText: "一键清空",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        await clearCodexUserSettings("all");
        dispatchClaudeUserSettingsChanged({ engine: "codex", effectiveModel: null });
        message.success("auth.json 与 config.toml 已清空");
      },
    });
  }, []);

  const handleSelectOnlyMenuClick = useCallback(
    ({ key }: { key: string }) => {
      if (typeof key !== "string" || key === "__no_match__") return;
      if (isCodexEngine) {
        // 命中已配置档案：应用档案（写入 codex 配置并广播，Composer 同步会话模型）。
        const option = selectOnlyModelOptions.find(
          (o) => o.value === key,
        ) as CodexModelPickerOption | undefined;
        if (option?.profileId) {
          const profileId = option.profileId;
          setSelectOnlyMenuOpen(false);
          setSelectOnlyFilter("");
          void applyClaudeModelProfile(profileId)
            .then((next) => {
              seedModelProfileStoreCache(next);
              setProfileStoreRevision((n) => n + 1);
              dispatchModelProfileStoreChanged(next, { engine: "codex" });
            })
            .catch(() => undefined);
          return;
        }
      }
      if (isClaudeEngine) {
        // 命中 Claude 档案：应用档案（写 settings 并广播，触发流式会话按新模型重连）。
        const option = selectOnlyModelOptions.find(
          (o) => o.value === key,
        ) as { value: string; label: string; company?: string; profileId?: string } | undefined;
        if (option?.profileId) {
          const profileId = option.profileId;
          setSelectOnlyMenuOpen(false);
          setSelectOnlyFilter("");
          void applyClaudeModelProfile(profileId)
            .then((next) => {
              seedModelProfileStoreCache(next);
              setProfileStoreRevision((n) => n + 1);
              dispatchModelProfileStoreChanged(next, {
                engine: "claude",
                sessionReconnect: true,
              });
            })
            .catch(() => undefined);
          return;
        }
      }
      if (key !== model) {
        onModelChange(key);
        // 直接在 Composer 选择的模型应成为此执行环境之后新会话的默认值。
        // 档案模型走上方 applyClaudeModelProfile 路径，自身已有持久化逻辑。
        void saveExecutionEngineDefaultModel(sessionExecutionEngine, key).catch(() => undefined);
        if (isClaudeEngine) {
          // 与 Codex 一致：直接切换会话模型；派发 settings 事件触发流式会话按新模型重连。
          dispatchClaudeUserSettingsChanged({
            engine: "claude",
            effectiveModel: key,
            sessionReconnect: true,
          });
        }
      }
      setSelectOnlyMenuOpen(false);
      setSelectOnlyFilter("");
    },
    [
      model,
      onModelChange,
      isCodexEngine,
      isClaudeEngine,
      selectOnlyModelOptions,
      sessionExecutionEngine,
    ],
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

  if (isSelectOnlyEngine) {
    const hintTitle = isCursorEngine
      ? "切换 Cursor 模型"
      : isQoderEngine
        ? "切换 Qoder 模型"
        : isCodexEngine
          ? "切换 Codex 模型"
          : isClaudeEngine
            ? "切换 Claude 模型"
            : "切换 OpenCode 模型";
    const filterPlaceholder = isCursorEngine
      ? "过滤 Cursor 模型…"
      : isQoderEngine
        ? "过滤 Qoder 模型…"
        : isCodexEngine
          ? "过滤 Codex 模型…"
          : isClaudeEngine
            ? "过滤 Claude 模型…"
            : "过滤 OpenCode 模型…";
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
                {isCodexEngine || isClaudeEngine ? (
                  <div
                    className="app-composer-model-picker-dropdown-footer"
                    onMouseDown={stopSemiComposerPointerBubble}
                    onClick={stopSemiComposerPointerBubble}
                  >
                    <button
                      type="button"
                      className="app-composer-model-picker-dropdown-footer__btn"
                      onClick={openManageProfilesPanel}
                    >
                      {isCodexEngine ? "管理 Codex 档案…" : "管理 Claude 档案…"}
                    </button>
                    {isCodexEngine ? (
                      <button
                        type="button"
                        className="app-composer-model-picker-dropdown-footer__clear-btn"
                        aria-label="一键清空 Codex 配置"
                        title="一键清空 auth.json 与 config.toml"
                        onClick={confirmClearCodexSettings}
                      >
                        <DeleteOutlined />
                      </button>
                    ) : null}
                  </div>
                ) : null}
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
          {isCodexEngine || isClaudeEngine ? (
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
              <span className="app-composer-model-picker-panel-anchor" aria-hidden />
            </Dropdown>
          ) : null}
        </div>
      </div>
    );
  }

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
// React.memo：Semi AIChatInput 每 transaction setState 会重渲染整棵子树；props 引用稳定时叶子 bail out，避免底栏组件每键 reconcile。
const MemoizedComposerModelPicker = memo(ComposerModelPickerImpl);
MemoizedComposerModelPicker.displayName = "ComposerModelPicker";
export const ComposerModelPicker = MemoizedComposerModelPicker;

import { useCallback, useEffect, useMemo, useState } from "react";
import { Dropdown, type MenuProps } from "antd";
import { buildSessionExecutionEngineMenuItems } from "../ClaudeChatInput/SessionExecutionEngineChip";
import { useHudOverlaySelectOpen } from "../../hooks/useHudOverlaySelectOpen";
import { useAgentRegistryCodexAvailable } from "../../hooks/useAgentRegistryCodexAvailable";
import { useAgentRegistryCursorAvailable } from "../../hooks/useAgentRegistryCursorAvailable";
import { useAgentRegistryGeminiAvailable } from "../../hooks/useAgentRegistryGeminiAvailable";
import { useAgentRegistryOpencodeAvailable } from "../../hooks/useAgentRegistryOpencodeAvailable";
import { useAgentRegistryQoderAvailable } from "../../hooks/useAgentRegistryQoderAvailable";
import { getClaudeModelPickerOptions } from "../../services/claude";
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
import { listCodexModels } from "../../services/codex";
import { listCursorModels } from "../../services/cursorAgent";
import { listOpencodeModels } from "../../services/opencode";
import { listQoderModels } from "../../services/qoder";
import { getCachedModelProfileStore } from "../../stores/modelProfileStoreCache";
import { wiseHudSetEngine, wiseHudSetModel } from "../../services/wiseHud";
import {
  isSessionExecutionEngine,
  SESSION_EXECUTION_ENGINE_LABELS,
  type SessionExecutionEngine,
} from "../../constants/sessionExecutionEngine";
import { hudSelectPopupContainer } from "../../utils/hudSelectPopup";
import {
  capHudRuntimeModelOptions,
  hudModelMenuKey,
  hudRuntimeBusyBlocksEngineSwitch,
  parseHudModelMenuKey,
  type HudRuntimeModelOption,
} from "../../utils/hudRuntimeMenu";
import { buildClaudeModelPickerOptions } from "../../utils/claudeModel";
import { buildCodexModelPickerOptions } from "../../utils/codexModel";
import { buildCursorModelPickerOptions } from "../../utils/cursorModel";
import { buildOpencodeModelPickerOptions } from "../../utils/opencodeModel";
import { buildQoderModelPickerOptions } from "../../utils/qoderModel";
import type { WiseHudSessionSnapshot } from "../../utils/wiseHudSnapshot";

export interface HudRuntimePickerProps {
  snapshot: WiseHudSessionSnapshot;
  onOverlayWantedChange?: (wanted: boolean) => void;
}

function IconHudRuntime() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2 2 7l10 5 10-5-10-5z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M2 12l10 5 10-5M2 17l10 5 10-5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function collectHudModelOptions(
  engine: SessionExecutionEngine,
  sessionModel: string,
): HudRuntimeModelOption[] {
  const current = sessionModel.trim();
  if (engine === "claude") {
    return capHudRuntimeModelOptions(
      buildClaudeModelPickerOptions({
        picker: getCachedClaudeModelPickerOptions(),
        profiles: getCachedModelProfileStore()?.profiles ?? [],
        sessionModel: current,
        currentModel: current,
      }),
      current,
    );
  }
  if (engine === "codex" || engine === "codex-rpc") {
    return capHudRuntimeModelOptions(
      buildCodexModelPickerOptions(
        getCachedCodexModels() ?? [],
        getCachedModelProfileStore()?.profiles ?? [],
      ),
      current,
    );
  }
  if (engine === "cursor") {
    return capHudRuntimeModelOptions(
      buildCursorModelPickerOptions(getCachedCursorModels() ?? []),
      current,
    );
  }
  if (engine === "opencode") {
    return capHudRuntimeModelOptions(
      buildOpencodeModelPickerOptions(getCachedOpencodeModels() ?? []),
      current,
    );
  }
  if (engine === "qoder") {
    return capHudRuntimeModelOptions(
      buildQoderModelPickerOptions(getCachedQoderModels() ?? []),
      current,
    );
  }
  return capHudRuntimeModelOptions([], current);
}

export function HudRuntimePicker({ snapshot, onOverlayWantedChange }: HudRuntimePickerProps) {
  const sessionId = snapshot.sessionId;
  const disabled = !sessionId || snapshot.busy;
  const hudSelect = useHudOverlaySelectOpen(true);
  const [optimisticEngine, setOptimisticEngine] = useState<SessionExecutionEngine | null>(null);
  const [optimisticModel, setOptimisticModel] = useState<string | null>(null);
  const [modelTick, setModelTick] = useState(0);
  const engine = optimisticEngine ?? snapshot.engine;
  const sessionModel = optimisticModel ?? snapshot.composerSession?.model ?? "";
  const codexAvailable = useAgentRegistryCodexAvailable();
  const cursorAvailable = useAgentRegistryCursorAvailable();
  const geminiAvailable = useAgentRegistryGeminiAvailable();
  const opencodeAvailable = useAgentRegistryOpencodeAvailable();
  const qoderAvailable = useAgentRegistryQoderAvailable();

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
    if (!hudSelect.open) return;
    let cancelled = false;
    void (async () => {
      try {
        await loadExecutionEngineModelLists();
        if (!cancelled) setModelTick((n) => n + 1);
        if (engine === "claude") {
          const picker = await getClaudeModelPickerOptions();
          if (cancelled) return;
          await saveCachedClaudeModelPickerOptions(picker);
        } else if (engine === "codex" || engine === "codex-rpc") {
          const models = await listCodexModels();
          if (cancelled) return;
          await saveCachedCodexModels(models);
        } else if (engine === "cursor") {
          const models = await listCursorModels();
          if (cancelled) return;
          await saveCachedCursorModels(models);
        } else if (engine === "opencode") {
          const models = await listOpencodeModels();
          if (cancelled) return;
          await saveCachedOpencodeModels(models);
        } else if (engine === "qoder") {
          const models = await listQoderModels();
          if (cancelled) return;
          await saveCachedQoderModels(models);
        }
        if (!cancelled) setModelTick((n) => n + 1);
      } catch {
        if (!cancelled) setModelTick((n) => n + 1);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [engine, hudSelect.open]);

  const modelOptions = useMemo(
    () => collectHudModelOptions(engine, sessionModel),
    [engine, sessionModel, modelTick],
  );

  const tooltip = `${SESSION_EXECUTION_ENGINE_LABELS[engine].title} · ${
    snapshot.modelLabel || sessionModel || "默认模型"
  }`;

  const menuItems = useMemo((): MenuProps["items"] => {
    const engineItems = buildSessionExecutionEngineMenuItems({
      engine,
      codexAvailable,
      cursorAvailable,
      geminiAvailable,
      opencodeAvailable,
      qoderAvailable,
    });
    const modelItems: NonNullable<MenuProps["items"]> =
      modelOptions.length > 0
        ? modelOptions.map((option) => ({
            key: hudModelMenuKey(option.value),
            label: option.label,
          }))
        : [
            {
              key: "hud-model-empty",
              disabled: true,
              label: "暂无模型列表",
            },
          ];
    return [
      { type: "group", label: "执行环境", children: engineItems ?? [] },
      { type: "divider" },
      { type: "group", label: "模型", children: modelItems },
    ];
  }, [
    engine,
    modelOptions,
    codexAvailable,
    cursorAvailable,
    geminiAvailable,
    opencodeAvailable,
    qoderAvailable,
  ]);

  const selectedKeys = useMemo(() => {
    const keys = [engine];
    if (sessionModel.trim()) keys.push(hudModelMenuKey(sessionModel.trim()));
    return keys;
  }, [engine, sessionModel]);

  const onMenuClick = useCallback<NonNullable<MenuProps["onClick"]>>(
    ({ key }) => {
      if (typeof key !== "string" || !sessionId) return;
      const modelId = parseHudModelMenuKey(key);
      if (modelId) {
        if (modelId === sessionModel.trim()) return;
        setOptimisticModel(modelId);
        void wiseHudSetModel(modelId, sessionId);
        return;
      }
      if (!isSessionExecutionEngine(key)) return;
      if (hudRuntimeBusyBlocksEngineSwitch(engine, key, snapshot.busy)) return;
      if (key === engine) return;
      setOptimisticEngine(key);
      setOptimisticModel(null);
      void wiseHudSetEngine(key, sessionId);
    },
    [engine, sessionId, sessionModel, snapshot.busy],
  );

  return (
    <div className="app-hud-runtime-anchor" onMouseDown={hudSelect.prepareOverlay}>
      <Dropdown
        trigger={["click"]}
        placement="topRight"
        getPopupContainer={hudSelectPopupContainer}
        disabled={disabled}
        open={hudSelect.open}
        onOpenChange={hudSelect.onOpenChange}
        classNames={{ root: "app-hud-runtime-dropdown" }}
        menu={{
          items: menuItems,
          selectable: true,
          selectedKeys,
          onClick: onMenuClick,
        }}
      >
        <button
          type="button"
          className="app-hud-runtime-btn"
          aria-label="切换执行环境和模型"
          title={disabled ? (snapshot.busy ? "会话运行中，结束后再切换" : "请先新建会话") : tooltip}
          disabled={disabled}
        >
          <IconHudRuntime />
        </button>
      </Dropdown>
    </div>
  );
}

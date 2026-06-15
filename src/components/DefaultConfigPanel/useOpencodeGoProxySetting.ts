import { message } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getClaudeLlmProxyStatus, type ClaudeLlmProxyStatus } from "../../services/claudeLlmProxy";
import {
  getFreeClaudeCodeStatus,
  type FreeClaudeCodeStatus,
} from "../../services/freeClaudeCode";
import {
  applyOpencodeGoProxyClientSettings,
  applyOpencodeGoProxyClaudeSettings,
  applyOpencodeGoProxyCodexSettings,
  getOpencodeGoProxyStatus,
  listOpencodeGoProxyModels,
  OPENCODE_GO_PROXY_DEFAULT_PORT,
  saveOpencodeGoProxyPrefs,
  setOpencodeGoProxyConfig,
  switchOpencodeGoProxyModel,
  type OpencodeGoModelOverride,
  type OpencodeGoProxyPrefsInput,
  type OpencodeGoProxyStatus,
} from "../../services/opencodeGoProxy";
import {
  anthropicProxyConflictMessage,
  resolveAnthropicProxyConflict,
} from "../../utils/anthropicProxyConflict";
import {
  buildOpencodeGoModelChain,
  buildOpencodeGoModelSelectOptions,
  fallbackModelsEqual,
  normalizeFallbackModels,
} from "../../utils/opencodeGoModelChain";
import { validateOpencodeGoProxyConfig } from "../../services/opencodeGoProxyTraces";
import { resolveOpencodeGoModelPresets } from "../../utils/opencodeGoModelPresets";

function serializeModelOverrides(
  overrides: Record<string, OpencodeGoModelOverride> | undefined,
): string {
  if (!overrides || Object.keys(overrides).length === 0) {
    return "";
  }
  return JSON.stringify(overrides, null, 2);
}

function parseModelOverridesDraft(
  draft: string,
): Record<string, OpencodeGoModelOverride> | null {
  const trimmed = draft.trim();
  if (!trimmed) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const out: Record<string, OpencodeGoModelOverride> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const row = value as Record<string, unknown>;
    const modelId = typeof row.modelId === "string" ? row.modelId.trim() : "";
    if (!modelId) {
      return null;
    }
    const provider =
      typeof row.provider === "string" && row.provider.trim()
        ? row.provider.trim()
        : undefined;
    out[key.trim()] = { modelId, ...(provider ? { provider } : {}) };
  }
  return out;
}

function modelOverridesDraftEqualsSaved(
  draft: string,
  saved: Record<string, OpencodeGoModelOverride> | undefined,
): boolean {
  const parsed = parseModelOverridesDraft(draft);
  if (parsed === null) {
    return false;
  }
  return JSON.stringify(parsed) === JSON.stringify(saved ?? {});
}

function isHotReloadDirty(
  st: OpencodeGoProxyStatus,
  fallbackModelsDraft: string[],
  modelOverridesDraft: string,
  upstreamUrlDraft: string,
  debugDraft: boolean,
): boolean {
  if (!fallbackModelsEqual(fallbackModelsDraft, st.fallbackModels)) {
    return true;
  }
  if (!modelOverridesDraftEqualsSaved(modelOverridesDraft, st.modelOverrides)) {
    return true;
  }
  if (upstreamUrlDraft.trim() !== (st.customUpstreamUrl ?? "").trim()) {
    return true;
  }
  if (debugDraft !== Boolean(st.debug)) {
    return true;
  }
  return false;
}

function isPrefsDirty(
  st: OpencodeGoProxyStatus,
  apiKeyDraft: string,
  defaultModelDraft: string,
  portDraft: number,
  providerDraft: string,
  fallbackModelsDraft: string[],
  modelOverridesDraft: string,
  upstreamUrlDraft: string,
  debugDraft: boolean,
  options?: { includeApiKey?: boolean },
): boolean {
  if (options?.includeApiKey !== false && apiKeyDraft.trim().length > 0) {
    return true;
  }
  const port = portDraft > 0 ? portDraft : OPENCODE_GO_PROXY_DEFAULT_PORT;
  const savedPort = st.port > 0 ? st.port : OPENCODE_GO_PROXY_DEFAULT_PORT;
  if (port !== savedPort) return true;
  if (defaultModelDraft.trim() !== st.defaultModel.trim()) return true;
  if (providerDraft !== (st.provider || "opencode-go")) return true;
  if (isHotReloadDirty(st, fallbackModelsDraft, modelOverridesDraft, upstreamUrlDraft, debugDraft)) {
    return true;
  }
  return false;
}

export type OpencodeGoProxySettingController = ReturnType<typeof useOpencodeGoProxySetting>;

export function useOpencodeGoProxySetting() {
  const [status, setStatus] = useState<OpencodeGoProxyStatus | null>(null);
  const [llmProxyStatus, setLlmProxyStatus] = useState<ClaudeLlmProxyStatus | null>(null);
  const [fccStatus, setFccStatus] = useState<FreeClaudeCodeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [defaultModelDraft, setDefaultModelDraft] = useState("kimi-k2.6");
  const [portDraft, setPortDraft] = useState(OPENCODE_GO_PROXY_DEFAULT_PORT);
  const [providerDraft, setProviderDraft] = useState("opencode-go");
  const [fallbackModelsDraft, setFallbackModelsDraft] = useState<string[]>([]);
  const [modelOverridesDraft, setModelOverridesDraft] = useState("");
  const [upstreamUrlDraft, setUpstreamUrlDraft] = useState("");
  const [debugDraft, setDebugDraft] = useState(false);
  const [remoteModels, setRemoteModels] = useState<string[]>([]);
  const [remoteModelsLoading, setRemoteModelsLoading] = useState(false);
  const hydratedRef = useRef(false);
  const reconcileInFlightRef = useRef(false);

  const applyDraftFromStatus = useCallback(
    (st: OpencodeGoProxyStatus, options?: { clearApiKeyDraft?: boolean }) => {
      setDefaultModelDraft(st.defaultModel);
      setPortDraft(st.port > 0 ? st.port : OPENCODE_GO_PROXY_DEFAULT_PORT);
      setProviderDraft(st.provider || "opencode-go");
      setFallbackModelsDraft(normalizeFallbackModels(st.fallbackModels ?? []));
      setModelOverridesDraft(serializeModelOverrides(st.modelOverrides));
      setUpstreamUrlDraft(st.customUpstreamUrl ?? "");
      setDebugDraft(Boolean(st.debug));
      if (options?.clearApiKeyDraft) {
        setApiKeyDraft("");
      }
    },
    [],
  );

  const fetchRemoteModels = useCallback(
    async (
      provider?: string,
      apiKey?: string,
      options?: { assumeSavedKey?: boolean },
    ) => {
      const key = apiKey?.trim() || apiKeyDraft.trim();
      if (!key && !options?.assumeSavedKey && !status?.hasApiKey) {
        setRemoteModels([]);
        return;
      }
      setRemoteModelsLoading(true);
      try {
        const models = await listOpencodeGoProxyModels({
          provider: provider ?? providerDraft,
          apiKey: key || undefined,
        });
        setRemoteModels(models);
        if (models.length === 0) {
          message.warning("未获取到可用模型，请检查 API Key 与上游类型");
        }
      } catch (err) {
        setRemoteModels([]);
        message.error(
          `拉取模型列表失败：${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        setRemoteModelsLoading(false);
      }
    },
    [apiKeyDraft, providerDraft, status?.hasApiKey],
  );

  const reconcileClientAlignment = useCallback(
    async (st: OpencodeGoProxyStatus): Promise<OpencodeGoProxyStatus> => {
      if (
        !st.running ||
        (st.claudeSettingsAligned && st.codexSettingsAligned)
      ) {
        return st;
      }
      if (reconcileInFlightRef.current) {
        return st;
      }
      reconcileInFlightRef.current = true;
      try {
        await applyOpencodeGoProxyClientSettings();
        return await getOpencodeGoProxyStatus();
      } catch {
        // 自动对齐失败时静默跳过，避免重复弹窗；用户可手动点「同步全部」。
        return st;
      } finally {
        reconcileInFlightRef.current = false;
      }
    },
    [],
  );

  const refresh = useCallback(async () => {
    try {
      const [stRaw, llm, fcc] = await Promise.all([
        getOpencodeGoProxyStatus(),
        getClaudeLlmProxyStatus(),
        getFreeClaudeCodeStatus(),
      ]);
      const st = await reconcileClientAlignment(stRaw);
      setStatus(st);
      setLlmProxyStatus(llm);
      setFccStatus(fcc);
      applyDraftFromStatus(st);
      hydratedRef.current = true;
      if (st.hasApiKey) {
        void fetchRemoteModels(st.provider || "opencode-go", undefined, {
          assumeSavedKey: true,
        });
      }
    } catch (err) {
      message.error(
        `读取 OpenCode Go 代理状态失败：${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setLoading(false);
    }
  }, [applyDraftFromStatus, fetchRemoteModels, reconcileClientAlignment]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const buildPrefsInput = useCallback(
    (options?: { includeApiKey?: boolean }): OpencodeGoProxyPrefsInput | null => {
      const modelOverrides = parseModelOverridesDraft(modelOverridesDraft);
      if (modelOverrides === null) {
        return null;
      }
      const includeApiKey = options?.includeApiKey !== false;
      return {
        apiKey:
          includeApiKey && apiKeyDraft.trim().length > 0
            ? apiKeyDraft.trim()
            : undefined,
        port: portDraft > 0 ? portDraft : OPENCODE_GO_PROXY_DEFAULT_PORT,
        defaultModel: defaultModelDraft.trim() || undefined,
        provider: providerDraft,
        fallbackModels: normalizeFallbackModels(fallbackModelsDraft),
        modelOverrides,
        upstreamUrl: upstreamUrlDraft.trim(),
        debug: debugDraft,
      };
    },
    [
      apiKeyDraft,
      defaultModelDraft,
      portDraft,
      providerDraft,
      fallbackModelsDraft,
      modelOverridesDraft,
      upstreamUrlDraft,
      debugDraft,
    ],
  );

  const buildHotReloadInput = useCallback((): OpencodeGoProxyPrefsInput | null => {
    const modelOverrides = parseModelOverridesDraft(modelOverridesDraft);
    if (modelOverrides === null) {
      return null;
    }
    return {
      fallbackModels: normalizeFallbackModels(fallbackModelsDraft),
      modelOverrides,
      upstreamUrl: upstreamUrlDraft.trim(),
      debug: debugDraft,
    };
  }, [fallbackModelsDraft, modelOverridesDraft, upstreamUrlDraft, debugDraft]);

  const persistPrefs = useCallback(
    async (options?: { silent?: boolean; includeApiKey?: boolean }) => {
      const silent = options?.silent ?? true;
      const includeApiKey = options?.includeApiKey === true;
      const running = status?.running === true;
      const input = running ? buildHotReloadInput() : buildPrefsInput({ includeApiKey });
      if (!input) {
        if (!silent) {
          message.error("模型覆盖 JSON 格式无效");
        }
        return false;
      }
      if (status) {
        const dirty = running
          ? isHotReloadDirty(
              status,
              fallbackModelsDraft,
              modelOverridesDraft,
              upstreamUrlDraft,
              debugDraft,
            )
          : isPrefsDirty(
              status,
              apiKeyDraft,
              defaultModelDraft,
              portDraft,
              providerDraft,
              fallbackModelsDraft,
              modelOverridesDraft,
              upstreamUrlDraft,
              debugDraft,
              { includeApiKey },
            );
        if (!dirty) {
          return true;
        }
      }
      try {
        const st = await saveOpencodeGoProxyPrefs(input);
        setStatus(st);
        applyDraftFromStatus(st, {
          clearApiKeyDraft: !running && includeApiKey && Boolean(input.apiKey),
        });
        if (!silent) {
          message.success(running ? "运行中配置已热更新" : "配置已保存");
        }
        return true;
      } catch (err) {
        if (!silent) {
          message.error(
            `保存配置失败：${err instanceof Error ? err.message : String(err)}`,
          );
        }
        return false;
      }
    },
    [
      status,
      buildPrefsInput,
      buildHotReloadInput,
      apiKeyDraft,
      defaultModelDraft,
      portDraft,
      providerDraft,
      fallbackModelsDraft,
      modelOverridesDraft,
      upstreamUrlDraft,
      debugDraft,
      applyDraftFromStatus,
    ],
  );

  useEffect(() => {
    if (!hydratedRef.current || loading || busy || !status) {
      return;
    }
    if (parseModelOverridesDraft(modelOverridesDraft) === null) {
      return;
    }
    const dirty = status.running
      ? isHotReloadDirty(
          status,
          fallbackModelsDraft,
          modelOverridesDraft,
          upstreamUrlDraft,
          debugDraft,
        )
      : isPrefsDirty(
          status,
          apiKeyDraft,
          defaultModelDraft,
          portDraft,
          providerDraft,
          fallbackModelsDraft,
          modelOverridesDraft,
          upstreamUrlDraft,
          debugDraft,
          { includeApiKey: false },
        );
    if (!dirty) {
      return;
    }
    const timer = window.setTimeout(() => {
      void persistPrefs({ silent: true, includeApiKey: false });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [
    apiKeyDraft,
    defaultModelDraft,
    portDraft,
    providerDraft,
    fallbackModelsDraft,
    modelOverridesDraft,
    upstreamUrlDraft,
    debugDraft,
    loading,
    busy,
    status,
    persistPrefs,
  ]);

  const runAction = useCallback(
    async (label: string, fn: () => Promise<OpencodeGoProxyStatus | boolean>) => {
      setBusy(true);
      try {
        await fn();
        await refresh();
        if (label) {
          message.success(label);
        }
      } catch (err) {
        message.error(`${label || "操作"}失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const proxyConflict = useMemo(
    () => resolveAnthropicProxyConflict(status, llmProxyStatus, fccStatus),
    [status, llmProxyStatus, fccStatus],
  );

  const modelOverridesValid = useMemo(
    () => parseModelOverridesDraft(modelOverridesDraft) !== null,
    [modelOverridesDraft],
  );

  const fallbackModels = useMemo(
    () => normalizeFallbackModels(fallbackModelsDraft),
    [fallbackModelsDraft],
  );

  const modelPresets = useMemo(
    () => resolveOpencodeGoModelPresets(providerDraft),
    [providerDraft],
  );

  const modelChain = useMemo(
    () => buildOpencodeGoModelChain(defaultModelDraft, fallbackModels),
    [defaultModelDraft, fallbackModels],
  );

  const defaultModelOptions = useMemo(
    () =>
      buildOpencodeGoModelSelectOptions(
        modelChain,
        [...remoteModels, ...modelPresets, ...fallbackModels],
      ),
    [modelChain, modelPresets, remoteModels, fallbackModels],
  );

  const fallbackModelOptions = useMemo(() => {
    const defaultId = defaultModelDraft.trim();
    const pool = [...remoteModels, ...modelPresets, ...fallbackModels];
    return buildOpencodeGoModelSelectOptions([], pool).filter(
      (opt) => opt.value !== defaultId,
    );
  }, [defaultModelDraft, remoteModels, modelPresets, fallbackModels]);

  const updateFallbackModelsDraft = useCallback(
    (models: string[]) => {
      const defaultId = defaultModelDraft.trim();
      setFallbackModelsDraft(
        normalizeFallbackModels(models).filter((m) => m !== defaultId),
      );
    },
    [defaultModelDraft],
  );

  useEffect(() => {
    const defaultId = defaultModelDraft.trim();
    if (!defaultId) {
      return;
    }
    setFallbackModelsDraft((prev) => {
      const next = prev.filter((m) => m !== defaultId);
      return next.length === prev.length ? prev : next;
    });
  }, [defaultModelDraft]);

  const saveConfig = useCallback(async () => {
    if (status?.running) {
      message.info("代理运行中无法修改配置，请先停止");
      return;
    }
    const input = buildPrefsInput({ includeApiKey: true });
    if (!input) {
      message.error("模型覆盖 JSON 格式无效");
      return;
    }
    setBusy(true);
    try {
      const st = await saveOpencodeGoProxyPrefs(input);
      setStatus(st);
      applyDraftFromStatus(st, { clearApiKeyDraft: Boolean(input.apiKey) });
      message.success("配置已保存");
    } catch (err) {
      message.error(
        `保存配置失败：${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setBusy(false);
    }
  }, [status?.running, buildPrefsInput, applyDraftFromStatus]);

  const switchDefaultModel = useCallback(
    async (model: string) => {
      const trimmed = model.trim();
      if (!trimmed) {
        return;
      }
      setDefaultModelDraft(trimmed);
      if (!status?.running || trimmed === status.defaultModel.trim()) {
        return;
      }
      setBusy(true);
      try {
        let st = await switchOpencodeGoProxyModel(trimmed);
        st = await reconcileClientAlignment(st);
        setStatus(st);
        applyDraftFromStatus(st);
        message.success(`已切换上游模型：${trimmed}`);
      } catch (err) {
        message.error(
          `切换模型失败：${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        setBusy(false);
      }
    },
    [status, applyDraftFromStatus, reconcileClientAlignment],
  );

  const commitDefaultModelIfRunning = useCallback(() => {
    void switchDefaultModel(defaultModelDraft);
  }, [switchDefaultModel, defaultModelDraft]);

  const saveAndStart = useCallback(
    () =>
      runAction("已启动 OpenCode Go 代理（已同步 Claude / Codex）", async () => {
        const [llm, fcc] = await Promise.all([
          getClaudeLlmProxyStatus(),
          getFreeClaudeCodeStatus(),
        ]);
        const conflict = resolveAnthropicProxyConflict(status, llm, fcc);
        const conflictMessage = anthropicProxyConflictMessage(conflict);
        if (conflictMessage) {
          message.warning(conflictMessage);
        }
        const modelOverrides = parseModelOverridesDraft(modelOverridesDraft);
        if (modelOverrides === null) {
          throw new Error("模型覆盖 JSON 格式无效");
        }
        const hadKeyDraft = apiKeyDraft.trim().length > 0;
        const result = await setOpencodeGoProxyConfig({
          enabled: true,
          apiKey: apiKeyDraft.trim() || undefined,
          port: portDraft > 0 ? portDraft : OPENCODE_GO_PROXY_DEFAULT_PORT,
          defaultModel: defaultModelDraft.trim() || undefined,
          provider: providerDraft,
          fallbackModels: normalizeFallbackModels(fallbackModelsDraft),
          modelOverrides,
          upstreamUrl: upstreamUrlDraft.trim() || undefined,
          debug: debugDraft,
        });
        if (hadKeyDraft) {
          setApiKeyDraft("");
        }
        void fetchRemoteModels(providerDraft, apiKeyDraft.trim() || undefined);
        return reconcileClientAlignment(result);
      }),
    [
      apiKeyDraft,
      defaultModelDraft,
      portDraft,
      providerDraft,
      fallbackModelsDraft,
      modelOverridesDraft,
      upstreamUrlDraft,
      debugDraft,
      runAction,
      status,
      fetchRemoteModels,
      reconcileClientAlignment,
    ],
  );

  const validateConfig = useCallback(async () => {
    setBusy(true);
    try {
      const result = await validateOpencodeGoProxyConfig();
      if (result.ok) {
        message.success(result.messages.join("；"));
      } else {
        message.warning(result.messages.join("；"));
      }
      await refresh();
    } catch (err) {
      message.error(`校验失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const stop = useCallback(
    () =>
      runAction("已停止 OpenCode Go 代理", async () =>
        setOpencodeGoProxyConfig({ enabled: false }),
      ),
    [runAction],
  );

  const applyClientSettings = useCallback(
    () =>
      runAction("已同步 Claude settings 与 Codex config", applyOpencodeGoProxyClientSettings),
    [runAction],
  );

  const applyClaudeSettings = useCallback(
    () => runAction("已同步 Claude settings.json", applyOpencodeGoProxyClaudeSettings),
    [runAction],
  );

  const applyCodexSettings = useCallback(
    () => runAction("已同步 Codex config.toml", applyOpencodeGoProxyCodexSettings),
    [runAction],
  );

  return {
    status,
    llmProxyStatus,
    fccStatus,
    proxyConflict,
    proxyConflictMessage: anthropicProxyConflictMessage(proxyConflict),
    loading,
    busy,
    apiKeyDraft,
    setApiKeyDraft,
    defaultModelDraft,
    setDefaultModelDraft,
    switchDefaultModel,
    commitDefaultModelIfRunning,
    portDraft,
    setPortDraft,
    providerDraft,
    setProviderDraft,
    fallbackModelsDraft,
    setFallbackModelsDraft: updateFallbackModelsDraft,
    fallbackModelOptions,
    modelOverridesDraft,
    setModelOverridesDraft,
    upstreamUrlDraft,
    setUpstreamUrlDraft,
    debugDraft,
    setDebugDraft,
    modelOverridesValid,
    validateConfig,
    defaultModelOptions,
    remoteModelsLoading,
    fetchRemoteModels,
    refresh,
    persistPrefs,
    saveConfig,
    saveAndStart,
    stop,
    applyClientSettings,
    applyClaudeSettings,
    applyCodexSettings,
  };
}

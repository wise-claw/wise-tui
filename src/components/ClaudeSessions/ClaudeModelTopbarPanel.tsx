import { CheckOutlined, CloudSyncOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Collapse, Empty, Input, Modal, Segmented, Space, Switch, Typography, message } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyClaudeModelProfile,
  createClaudeModelProfile,
  deleteClaudeModelProfile,
  getClaudeUserSettingsJson,
  getCodexUserSettingsJson,
  getOpencodeUserSettingsJson,
  upsertClaudeModelProfile,
  syncClaudeModelProfilesFromCcSwitch,
  dispatchModelProfileStoreChanged,
  setClaudeModelProfileAutoFailover,
  reorderClaudeModelProfiles,
} from "../../services/claudeModelProfiles";
import type { ClaudeModelProfile, ClaudeModelProfileStoreView } from "../../types/claudeModelProfile";
import {
  normalizeModelProfileEngine,
  resolveActiveModelProfileId,
  resolveEffectiveModelForProfileEngine,
  modelProfileEngineLabel,
  buildOptimisticApplyStoreView,
  isModelProfileAutoFailoverEnabled,
  type ModelProfileEngine,
} from "../../types/claudeModelProfile";
import { resolveActiveModelProfileDisplayLabel } from "../../utils/modelProfileDisplay";
import {
  normalizeModelProfileLabelInput,
  validateModelProfileLabel,
} from "../../utils/modelProfileLabel";
import {
  normalizeModelProfileOfficialWebsite,
  normalizeModelProfileOfficialWebsiteInput,
  validateModelProfileOfficialWebsite,
} from "../../utils/modelProfileOfficialWebsite";
import {
  EMPTY_CODEX_AUTH_JSON,
  EMPTY_CODEX_CONFIG_TOML,
  parseCodexProfileEnvelopeJson,
  serializeCodexProfileEnvelope,
  validateCodexProfileDraft,
} from "../../utils/codexProfileEnvelope";
import {
  extractClaudeQuickConfig,
  extractCodexQuickConfig,
  extractOpencodeQuickConfig,
  tryMergeClaudeQuickConfig,
  tryMergeCodexQuickConfig,
  tryMergeOpencodeQuickConfig,
  type ModelProfileQuickConfig,
} from "../../utils/modelProfileQuickConfig";
import { ClaudeSettingsJsonEditor } from "./ClaudeSettingsJsonEditor";
import { CodexProfileSettingsEditor } from "./CodexProfileSettingsEditor";
import {
  EMPTY_MODEL_PROFILE_QUICK_CONFIG,
  ModelProfileQuickConfigFields,
} from "./ModelProfileQuickConfigFields";
import { ModelProfileSortableList } from "./ModelProfileSortableList";
import { OpencodeSettingsEditor } from "./OpencodeSettingsEditor";
import {
  OPENCODE_PROFILE_TEMPLATES,
  findOpencodeProfileTemplate,
} from "../../utils/opencodeProfileTemplates";
import "./ClaudeModelTopbarTrigger.css";

/** 高于模型切换 Popover/Dropdown（1200），保证编辑/新增 Modal 叠在其上 */
const MODEL_PROFILE_MODAL_Z_INDEX = 1300;
const MODEL_PROFILE_JSON_EDITOR_HEIGHT = 220;
const MODEL_PROFILE_MODAL_PROPS = {
  centered: false as const,
  rootClassName: "app-claude-model-topbar-modal-root",
};

interface Props {
  store: ClaudeModelProfileStoreView | null;
  setStore: React.Dispatch<React.SetStateAction<ClaudeModelProfileStoreView | null>>;
  loading: boolean;
  /** Composer 等入口打开时，优先展示与会话一致的引擎 Tab */
  preferredEngine?: ModelProfileEngine;
  onApplied?: () => void;
}

/** 从 opencode JSON 中提取所有 `provider/model` 选项供快捷选择。 */
function extractOpencodeModelOptions(
  settingsJson: string,
): { label: string; value: string }[] {
  try {
    const trimmed = settingsJson.trim();
    if (!trimmed) return [];
    const root = JSON.parse(trimmed) as Record<string, unknown>;
    const provider = root.provider;
    if (!provider || typeof provider !== "object" || Array.isArray(provider)) {
      return [];
    }
    const result: { label: string; value: string }[] = [];
    for (const [id, entry] of Object.entries(provider as Record<string, unknown>)) {
      const e = entry as Record<string, unknown>;
      const models = e.models;
      if (models && typeof models === "object" && !Array.isArray(models)) {
        for (const modelName of Object.keys(models as Record<string, unknown>)) {
          const path = `${id}/${modelName}`;
          result.push({ label: path, value: path });
        }
      }
    }
    return result;
  } catch {
    return [];
  }
}

function validateSettingsJson(text: string, engine: ModelProfileEngine): string | null {
  const trimmed = text.trim();
  if (!trimmed) return "配置 JSON 不能为空";
  try {
    const v = JSON.parse(trimmed) as unknown;
    if (v === null || typeof v !== "object" || Array.isArray(v)) {
      return "配置 JSON 顶层必须是对象";
    }
    if (engine === "codex") {
      const obj = v as Record<string, unknown>;
      if (!("auth" in obj) && !("config" in obj)) {
        return "Codex 配置需包含 auth 与 config 字段（与 CC Switch 一致）";
      }
    }
    if (engine === "opencode") {
      const obj = v as Record<string, unknown>;
      if (!("model" in obj) && !("provider" in obj)) {
        return "OpenCode 配置建议包含 model（provider/model）或 provider 字段";
      }
    }
    return null;
  } catch (e) {
    return e instanceof Error ? `JSON 解析失败：${e.message}` : "JSON 解析失败";
  }
}

export function ClaudeModelTopbarPanel({
  store,
  setStore,
  loading,
  preferredEngine,
  onApplied,
}: Props) {
  const [panelEngine, setPanelEngine] = useState<ModelProfileEngine>(
    preferredEngine ?? "claude",
  );
  const engineInitializedRef = useRef(false);

  useEffect(() => {
    if (preferredEngine) {
      setPanelEngine(preferredEngine);
      engineInitializedRef.current = true;
    }
  }, [preferredEngine]);

  useEffect(() => {
    if (engineInitializedRef.current || !store) return;
    const engines: ModelProfileEngine[] = ["claude", "codex", "opencode"];
    for (const engine of engines) {
      if (resolveActiveModelProfileId(engine, store)) {
        setPanelEngine(engine);
        break;
      }
    }
    engineInitializedRef.current = true;
  }, [store]);

  const [addOpen, setAddOpen] = useState(false);
  const [addCompany, setAddCompany] = useState("");
  const [addName, setAddName] = useState("");
  const [addOfficialWebsite, setAddOfficialWebsite] = useState("");
  const [addSettingsJson, setAddSettingsJson] = useState("{\n}\n");
  const [addCodexAuthJson, setAddCodexAuthJson] = useState(EMPTY_CODEX_AUTH_JSON);
  const [addCodexConfigToml, setAddCodexConfigToml] = useState(EMPTY_CODEX_CONFIG_TOML);
  const [addLoadingJson, setAddLoadingJson] = useState(false);
  const [addAppliedTemplate, setAddAppliedTemplate] = useState<string | null>(null);
  const [addSaving, setAddSaving] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [configProfile, setConfigProfile] = useState<ClaudeModelProfile | null>(null);
  const [configCompany, setConfigCompany] = useState("");
  const [configName, setConfigName] = useState("");
  const [configOfficialWebsite, setConfigOfficialWebsite] = useState("");
  const [settingsDraft, setSettingsDraft] = useState("");
  const [configCodexAuthJson, setConfigCodexAuthJson] = useState(EMPTY_CODEX_AUTH_JSON);
  const [configCodexConfigToml, setConfigCodexConfigToml] = useState(EMPTY_CODEX_CONFIG_TOML);
  const [savingConfig, setSavingConfig] = useState(false);
  const [syncingCcSwitch, setSyncingCcSwitch] = useState(false);
  const [applyingProfileId, setApplyingProfileId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  const [autoFailoverSaving, setAutoFailoverSaving] = useState(false);

  const addQuickConfigSource = useMemo((): ModelProfileQuickConfig => {
    if (panelEngine === "codex") {
      return extractCodexQuickConfig(addCodexAuthJson, addCodexConfigToml);
    }
    if (panelEngine === "opencode") {
      return extractOpencodeQuickConfig(addSettingsJson);
    }
    if (panelEngine === "claude") {
      return extractClaudeQuickConfig(addSettingsJson);
    }
    return EMPTY_MODEL_PROFILE_QUICK_CONFIG;
  }, [addCodexAuthJson, addCodexConfigToml, addSettingsJson, panelEngine]);

  const addModelOptions = useMemo(
    () => (panelEngine === "opencode" ? extractOpencodeModelOptions(addSettingsJson) : undefined),
    [addSettingsJson, panelEngine],
  );
  const configModelOptions = useMemo(
    () => {
      if (!configProfile || normalizeModelProfileEngine(configProfile.engine) !== "opencode") return undefined;
      return extractOpencodeModelOptions(settingsDraft);
    },
    [configProfile, settingsDraft],
  );

  const configQuickConfigSource = useMemo((): ModelProfileQuickConfig => {
    if (!configProfile) return EMPTY_MODEL_PROFILE_QUICK_CONFIG;
    const engine = normalizeModelProfileEngine(configProfile.engine);
    if (engine === "codex") {
      return extractCodexQuickConfig(configCodexAuthJson, configCodexConfigToml);
    }
    if (engine === "opencode") {
      return extractOpencodeQuickConfig(settingsDraft);
    }
    if (engine === "claude") {
      return extractClaudeQuickConfig(settingsDraft);
    }
    return EMPTY_MODEL_PROFILE_QUICK_CONFIG;
  }, [configCodexAuthJson, configCodexConfigToml, configProfile, settingsDraft]);

  const applyAddQuickConfig = useCallback(
    (patch: ModelProfileQuickConfig): boolean => {
      const model = patch.model.trim();
      if (panelEngine === "codex") {
        const merged = tryMergeCodexQuickConfig(addCodexAuthJson, addCodexConfigToml, patch);
        if (!merged.ok) {
          message.warning(merged.error);
          return false;
        }
        setAddCodexAuthJson(merged.value.authJson);
        setAddCodexConfigToml(merged.value.configToml);
      } else if (panelEngine === "claude") {
        const merged = tryMergeClaudeQuickConfig(addSettingsJson, patch);
        if (!merged.ok) {
          message.warning(merged.error);
          return false;
        }
        setAddSettingsJson(merged.value);
      } else if (panelEngine === "opencode") {
        const merged = tryMergeOpencodeQuickConfig(addSettingsJson, patch);
        if (!merged.ok) {
          message.warning(merged.error);
          return false;
        }
        setAddSettingsJson(merged.value);
      } else {
        return false;
      }
      if (model && !addName.trim()) {
        setAddName(model);
      }
      message.success("快捷配置已写入", 1.2);
      return true;
    },
    [addCodexAuthJson, addCodexConfigToml, addName, addSettingsJson, panelEngine],
  );

  const applyConfigQuickConfig = useCallback(
    (patch: ModelProfileQuickConfig): boolean => {
      if (!configProfile) return false;
      const model = patch.model.trim();
      const engine = normalizeModelProfileEngine(configProfile.engine);
      if (engine === "codex") {
        const merged = tryMergeCodexQuickConfig(configCodexAuthJson, configCodexConfigToml, patch);
        if (!merged.ok) {
          message.warning(merged.error);
          return false;
        }
        setConfigCodexAuthJson(merged.value.authJson);
        setConfigCodexConfigToml(merged.value.configToml);
      } else if (engine === "claude") {
        const merged = tryMergeClaudeQuickConfig(settingsDraft, patch);
        if (!merged.ok) {
          message.warning(merged.error);
          return false;
        }
        setSettingsDraft(merged.value);
      } else if (engine === "opencode") {
        const merged = tryMergeOpencodeQuickConfig(settingsDraft, patch);
        if (!merged.ok) {
          message.warning(merged.error);
          return false;
        }
        setSettingsDraft(merged.value);
      } else {
        return false;
      }
      if (model && !configName.trim()) {
        setConfigName(model);
      }
      message.success("快捷配置已写入", 1.2);
      return true;
    },
    [configCodexAuthJson, configCodexConfigToml, configName, configProfile, settingsDraft],
  );

  const loadGlobalSettingsIntoAdd = useCallback(async () => {
    setAddLoadingJson(true);
    try {
      if (panelEngine === "codex") {
        const text = await getCodexUserSettingsJson();
        const draft = parseCodexProfileEnvelopeJson(text);
        setAddCodexAuthJson(draft.authJson);
        setAddCodexConfigToml(draft.configToml);
      } else if (panelEngine === "opencode") {
        const text = await getOpencodeUserSettingsJson();
        setAddSettingsJson(text);
      } else {
        const text = await getClaudeUserSettingsJson();
        setAddSettingsJson(text);
      }
    } catch (e) {
      message.error(typeof e === "string" ? e : "读取全局配置失败");
    } finally {
      setAddLoadingJson(false);
    }
  }, [panelEngine]);

  const applyTemplate = useCallback(
    (templateId: string) => {
      const template = findOpencodeProfileTemplate(templateId);
      if (!template) return;
      setAddSettingsJson(template.generate());
      setAddAppliedTemplate(templateId);
      if (!addName.trim()) {
        setAddName(template.label);
      }
    },
    [addName],
  );

  const openAddModal = useCallback(() => {
    setAddCompany("");
    setAddName("");
    setAddOfficialWebsite("");
    setAddSettingsJson("{\n}\n");
    setAddCodexAuthJson(EMPTY_CODEX_AUTH_JSON);
    setAddCodexConfigToml(EMPTY_CODEX_CONFIG_TOML);
    setAddAppliedTemplate(null);
    setAddOpen(true);
    void loadGlobalSettingsIntoAdd();
  }, [loadGlobalSettingsIntoAdd]);

  const handleApply = useCallback(
    async (profileId: string) => {
      if (!store) return;
      const profile = store.profiles.find((p) => p.id === profileId);
      const appliedEngine = profile ? normalizeModelProfileEngine(profile.engine) : panelEngine;
      const previous = store;
      const optimistic = buildOptimisticApplyStoreView(store, profileId);
      if (optimistic) {
        setStore(optimistic);
        const optimisticEffective =
          resolveEffectiveModelForProfileEngine(appliedEngine, optimistic)?.trim() || null;
        dispatchModelProfileStoreChanged(optimistic, {
          engine: appliedEngine,
          effectiveModel: optimisticEffective,
          optimistic: true,
        });
        setApplyingProfileId(profileId);
      }
      try {
        const next = await applyClaudeModelProfile(profileId);
        setStore(next);
        setPanelEngine(appliedEngine);
        const effective =
          resolveEffectiveModelForProfileEngine(appliedEngine, next)?.trim() || null;
        dispatchModelProfileStoreChanged(next, {
          engine: appliedEngine,
          effectiveModel: effective,
          sessionReconnect: appliedEngine === "claude" || appliedEngine === "opencode",
        });
        onApplied?.();
      } catch (e) {
        setStore(previous);
        const rollbackEffective =
          resolveEffectiveModelForProfileEngine(appliedEngine, previous)?.trim() || null;
        dispatchModelProfileStoreChanged(previous, {
          engine: appliedEngine,
          effectiveModel: rollbackEffective,
          optimistic: true,
        });
        message.error(typeof e === "string" ? e : "切换失败");
      } finally {
        setApplyingProfileId(null);
      }
    },
    [onApplied, panelEngine, setStore, store],
  );

  const handleApplyById = useCallback(
    (profileId: string) => {
      void handleApply(profileId);
    },
    [handleApply],
  );

  const handleAdd = useCallback(async () => {
    const companyErr = validateModelProfileLabel(addCompany, { field: "公司" });
    if (companyErr) {
      message.warning(companyErr);
      return;
    }
    const nameErr = validateModelProfileLabel(addName, { field: "名称", required: true });
    if (nameErr) {
      message.warning(nameErr);
      return;
    }
    const websiteErr = validateModelProfileOfficialWebsite(addOfficialWebsite);
    if (websiteErr) {
      message.warning(websiteErr);
      return;
    }
    const officialWebsiteUrl =
      normalizeModelProfileOfficialWebsite(addOfficialWebsite) ?? undefined;
    const name = addName.trim();
    let settingsPayload = addSettingsJson;
    if (panelEngine === "codex") {
      const codexErr = validateCodexProfileDraft({
        authJson: addCodexAuthJson,
        configToml: addCodexConfigToml,
      });
      if (codexErr) {
        message.warning(codexErr);
        return;
      }
      try {
        settingsPayload = serializeCodexProfileEnvelope({
          authJson: addCodexAuthJson,
          configToml: addCodexConfigToml,
        });
      } catch (e) {
        message.warning(e instanceof Error ? e.message : "Codex 配置合并失败");
        return;
      }
    } else {
      const jsonErr = validateSettingsJson(addSettingsJson, panelEngine);
      if (jsonErr) {
        message.warning(jsonErr);
        return;
      }
    }
    setAddSaving(true);
    try {
      const next = await createClaudeModelProfile(
        addCompany,
        name,
        settingsPayload,
        panelEngine,
        officialWebsiteUrl,
      );
      setStore(next);
      dispatchModelProfileStoreChanged(next, {
        engine: panelEngine,
        skipComposerPickerRefresh: true,
      });
      setAddOpen(false);
      setAddCompany("");
      setAddName("");
      setAddOfficialWebsite("");
    } catch (e) {
      message.error(typeof e === "string" ? e : "新增失败");
    } finally {
      setAddSaving(false);
    }
  }, [addCompany, addName, addOfficialWebsite, addSettingsJson, addCodexAuthJson, addCodexConfigToml, panelEngine]);

  const openConfig = useCallback((profile: ClaudeModelProfile) => {
    setConfigProfile(profile);
    setConfigCompany(profile.company?.trim() || profile.name?.trim() || "");
    setConfigName(profile.name || "");
    setConfigOfficialWebsite(profile.officialWebsiteUrl?.trim() || "");
    if (normalizeModelProfileEngine(profile.engine) === "codex") {
      try {
        const draft = parseCodexProfileEnvelopeJson(profile.settingsJson);
        setConfigCodexAuthJson(draft.authJson);
        setConfigCodexConfigToml(draft.configToml);
      } catch {
        setConfigCodexAuthJson(EMPTY_CODEX_AUTH_JSON);
        setConfigCodexConfigToml(EMPTY_CODEX_CONFIG_TOML);
      }
      setSettingsDraft("");
    } else {
      setSettingsDraft(profile.settingsJson);
      setConfigCodexAuthJson(EMPTY_CODEX_AUTH_JSON);
      setConfigCodexConfigToml(EMPTY_CODEX_CONFIG_TOML);
    }
    setConfigOpen(true);
    setSavingConfig(false);
  }, []);

  const handleSaveConfig = useCallback(async () => {
    if (!configProfile) return;
    const companyErr = validateModelProfileLabel(configCompany, { field: "公司" });
    if (companyErr) {
      message.warning(companyErr);
      return;
    }
    const nameErr = validateModelProfileLabel(configName, { field: "名称", required: true });
    if (nameErr) {
      message.warning(nameErr);
      return;
    }
    const websiteErr = validateModelProfileOfficialWebsite(configOfficialWebsite);
    if (websiteErr) {
      message.warning(websiteErr);
      return;
    }
    const officialWebsiteUrl =
      normalizeModelProfileOfficialWebsite(configOfficialWebsite) ?? "";
    const name = configName.trim();
    const profileEngine = normalizeModelProfileEngine(configProfile.engine);
    let settingsJson = settingsDraft;
    if (profileEngine === "codex") {
      const codexErr = validateCodexProfileDraft({
        authJson: configCodexAuthJson,
        configToml: configCodexConfigToml,
      });
      if (codexErr) {
        message.warning(codexErr);
        return;
      }
      try {
        settingsJson = serializeCodexProfileEnvelope({
          authJson: configCodexAuthJson,
          configToml: configCodexConfigToml,
        });
      } catch (e) {
        message.warning(e instanceof Error ? e.message : "Codex 配置合并失败");
        return;
      }
    } else {
      const jsonErr = validateSettingsJson(settingsDraft, profileEngine);
      if (jsonErr) {
        message.warning(jsonErr);
        return;
      }
    }
    setSavingConfig(true);
    try {
      const updatedProfile: ClaudeModelProfile = {
        ...configProfile,
        company: configCompany.trim(),
        name,
        officialWebsiteUrl,
        settingsJson,
        engine: profileEngine,
        updatedAtMs: Date.now(),
      };
      const next = await upsertClaudeModelProfile(updatedProfile);
      setStore(next);
      dispatchModelProfileStoreChanged(next, { engine: profileEngine });
      setConfigOpen(false);
      setConfigProfile(null);
      onApplied?.();
    } catch (e) {
      message.error(typeof e === "string" ? e : "保存失败");
    } finally {
      setSavingConfig(false);
    }
  }, [configProfile, configCompany, configName, configOfficialWebsite, settingsDraft, configCodexAuthJson, configCodexConfigToml, onApplied]);

  const handleSyncFromCcSwitch = useCallback(async () => {
    setSyncingCcSwitch(true);
    try {
      const result = await syncClaudeModelProfilesFromCcSwitch();
      setStore(result.store);
      dispatchModelProfileStoreChanged(result.store, {
        engine: panelEngine,
        skipComposerPickerRefresh: true,
      });
    } catch (e) {
      message.error(typeof e === "string" ? e : "同步 CC Switch 配置失败");
    } finally {
      setSyncingCcSwitch(false);
    }
  }, [panelEngine, setStore]);

  const handleDelete = useCallback(async (profileId: string) => {
    try {
      const next = await deleteClaudeModelProfile(profileId);
      setStore(next);
      dispatchModelProfileStoreChanged(next, {
        engine: panelEngine,
        skipComposerPickerRefresh: true,
      });
    } catch (e) {
      message.error(typeof e === "string" ? e : "删除失败");
    }
  }, [panelEngine, setStore]);

  const handleDeleteById = useCallback(
    (profileId: string) => {
      void handleDelete(profileId);
    },
    [handleDelete],
  );

  const profiles = useMemo(
    () =>
      (store?.profiles ?? []).filter(
        (item) => normalizeModelProfileEngine(item.engine) === panelEngine,
      ),
    [panelEngine, store?.profiles],
  );

  const handleAutoFailoverChange = useCallback(
    async (enabled: boolean) => {
      if (!store) return;
      const previous = store;
      setStore({ ...store, autoFailoverEnabled: enabled });
      setAutoFailoverSaving(true);
      try {
        const next = await setClaudeModelProfileAutoFailover(enabled);
        setStore(next);
        dispatchModelProfileStoreChanged(next, { skipComposerPickerRefresh: true });
      } catch (e) {
        setStore(previous);
        message.error(typeof e === "string" ? e : "保存失败");
      } finally {
        setAutoFailoverSaving(false);
      }
    },
    [setStore, store],
  );

  const handleReorderProfiles = useCallback(
    async (fromIndex: number, toIndex: number) => {
      if (!store || reordering || fromIndex === toIndex) return;
      if (fromIndex < 0 || toIndex < 0 || fromIndex >= profiles.length || toIndex >= profiles.length) {
        return;
      }
      const reordered = [...profiles];
      const [moved] = reordered.splice(fromIndex, 1);
      reordered.splice(toIndex, 0, moved);
      setReordering(true);
      try {
        const next = await reorderClaudeModelProfiles(
          panelEngine,
          reordered.map((profile) => profile.id),
        );
        setStore(next);
        dispatchModelProfileStoreChanged(next, { skipComposerPickerRefresh: true });
      } catch (e) {
        message.error(typeof e === "string" ? e : "调整顺序失败");
      } finally {
        setReordering(false);
      }
    },
    [panelEngine, profiles, reordering, setStore, store],
  );

  const sortableProfiles =
    profiles.length >= 2 && isModelProfileAutoFailoverEnabled(store);

  const activeProfileId = resolveActiveModelProfileId(panelEngine, store);
  const currentDisplayLabel = resolveActiveModelProfileDisplayLabel(panelEngine, store);
  const engineLabel = modelProfileEngineLabel(panelEngine);
  const editingCodexProfile =
    configProfile != null && normalizeModelProfileEngine(configProfile.engine) === "codex";

  return (
    <div className="app-claude-model-topbar-panel">
      <header className="app-claude-model-topbar-panel__head">
        <div className="app-claude-model-topbar-panel__head-row">
          <Typography.Text className="app-claude-model-topbar-panel__title">模型切换</Typography.Text>
          <Button
            type="link"
            size="small"
            className="app-claude-model-topbar-panel__sync"
            icon={<CloudSyncOutlined />}
            loading={syncingCcSwitch}
            onClick={() => void handleSyncFromCcSwitch()}
          >
            从 CC Switch 同步
          </Button>
        </div>
        <Typography.Text type="secondary" className="app-claude-model-topbar-panel__effective">
          当前：{currentDisplayLabel}
        </Typography.Text>
        <Segmented
          size="small"
          className="app-claude-model-topbar-panel__engine-tabs"
          value={panelEngine}
          options={[
            { label: "Claude", value: "claude" },
            { label: "Codex", value: "codex" },
            { label: "OpenCode", value: "opencode" },
          ]}
          onChange={(value) => setPanelEngine(value as ModelProfileEngine)}
        />
        <div className="app-claude-model-topbar-panel__failover-row">
          <Switch
            size="small"
            checked={isModelProfileAutoFailoverEnabled(store)}
            loading={autoFailoverSaving}
            onChange={(checked) => void handleAutoFailoverChange(checked)}
          />
          <Typography.Text type="secondary" className="app-claude-model-topbar-panel__failover-label">
            限流时自动切换备用
          </Typography.Text>
        </div>
        {sortableProfiles ? (
          <Typography.Text type="secondary" className="app-claude-model-topbar-panel__failover-hint">
            拖拽左侧手柄调整自动切换优先级（越靠上越优先）
          </Typography.Text>
        ) : null}
      </header>

      {profiles.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={`暂无已保存的 ${engineLabel} 模型配置`}
          className="app-claude-model-topbar-panel__empty"
        />
      ) : (
        <ModelProfileSortableList
          profiles={profiles}
          activeProfileId={activeProfileId}
          applyingProfileId={applyingProfileId}
          sortable={sortableProfiles}
          reordering={reordering}
          loading={loading}
          onApply={handleApplyById}
          onConfigure={openConfig}
          onDelete={handleDeleteById}
          onReorder={(fromIndex, toIndex) => void handleReorderProfiles(fromIndex, toIndex)}
        />
      )}

      <footer className="app-claude-model-topbar-panel__foot">
        <Button
          type="dashed"
          block
          size="small"
          icon={<PlusOutlined />}
          onClick={openAddModal}
        >
          新增模型配置
        </Button>
      </footer>

      <Modal
        title="新增模型配置"
        open={addOpen}
        width={modalWidth()}
        zIndex={MODEL_PROFILE_MODAL_Z_INDEX}
        className="app-claude-model-topbar-modal"
        {...MODEL_PROFILE_MODAL_PROPS}
        onCancel={() => setAddOpen(false)}
        onOk={() => void handleAdd()}
        okText="保存"
        cancelText="取消"
        confirmLoading={addSaving}
        destroyOnHidden
      >
        <div className="app-claude-model-topbar-panel__form app-claude-model-topbar-panel__form--modal">
          <div className="app-claude-model-topbar-panel__form-row app-claude-model-topbar-panel__form-row--meta">
            <div className="app-claude-model-topbar-panel__form-field">
              <label className="app-claude-model-topbar-panel__label">公司</label>
              <Input
                size="small"
                value={addCompany}
                onChange={(e) =>
                  setAddCompany(normalizeModelProfileLabelInput(e.target.value))
                }
                placeholder="百炼"
                maxLength={80}
              />
            </div>
            <div className="app-claude-model-topbar-panel__form-field">
              <label className="app-claude-model-topbar-panel__label">名称</label>
              <Input
                size="small"
                value={addName}
                onChange={(e) => setAddName(normalizeModelProfileLabelInput(e.target.value))}
                placeholder="glm-5.1"
                maxLength={80}
              />
            </div>
            <div className="app-claude-model-topbar-panel__form-field">
              <label className="app-claude-model-topbar-panel__label">官网</label>
              <Input
                size="small"
                value={addOfficialWebsite}
                onChange={(e) =>
                  setAddOfficialWebsite(normalizeModelProfileOfficialWebsiteInput(e.target.value))
                }
                placeholder="可选"
                maxLength={512}
              />
            </div>
          </div>
          {panelEngine === "claude" || panelEngine === "codex" || panelEngine === "opencode" ? (
            <ModelProfileQuickConfigFields
              sourceValue={addQuickConfigSource}
              onApply={applyAddQuickConfig}
              modelPlaceholder={panelEngine === "opencode" ? "provider/model" : "model id"}
              engine={panelEngine}
              modelOptions={panelEngine === "opencode" ? addModelOptions : undefined}
            />
          ) : null}
          <div className="app-claude-model-topbar-panel__json-head">
            <div className="app-claude-model-topbar-panel__json-head-text">
              <label className="app-claude-model-topbar-panel__label">
                {panelEngine === "codex" ? "Codex 配置" : "配置 JSON"}
              </label>
              <Typography.Text
                type="secondary"
                className="app-claude-model-topbar-panel__hint app-claude-model-topbar-panel__hint--subtitle"
              >
                {panelEngine === "codex" ? (
                  <>
                    选择 Provider 后自动填充 URL 与模型；在下方"高级配置"中可编辑{" "}
                    <Typography.Text code>auth.json</Typography.Text> 与{" "}
                    <Typography.Text code>config.toml</Typography.Text>（与 CC Switch 相同）。
                  </>
                ) : panelEngine === "opencode" ? (
                  <>
                    完整 OpenCode 用户级 <Typography.Text code>opencode.json</Typography.Text>
                    ；切换时合并 <Typography.Text code>provider</Typography.Text> /{" "}
                    <Typography.Text code>model</Typography.Text>，保留 MCP 与插件配置。
                  </>
                ) : (
                  <>
                    完整 Claude Code 用户级 <Typography.Text code>settings.json</Typography.Text>
                    ；切换配置时将整体替换全局文件（与 cc-switch 相同）。
                  </>
                )}
              </Typography.Text>
            </div>
            <Button
              type="link"
              size="small"
              className="app-claude-model-topbar-panel__json-load"
              loading={addLoadingJson}
              onClick={() => void loadGlobalSettingsIntoAdd()}
            >
              载入当前全局配置
            </Button>
          </div>
          {panelEngine === "codex" ? (
            <Collapse
              ghost
              size="small"
              className="app-claude-model-topbar-panel__codex-editor-collapse"
              defaultActiveKey={[]}
              items={[
                {
                  key: "advanced",
                  label: "高级配置（auth.json / config.toml）",
                  children: (
                    <CodexProfileSettingsEditor
                      compact
                      authJson={addCodexAuthJson}
                      configToml={addCodexConfigToml}
                      onAuthJsonChange={setAddCodexAuthJson}
                      onConfigTomlChange={setAddCodexConfigToml}
                    />
                  ),
                },
              ]}
            />
          ) : panelEngine === "opencode" ? (
            <>
              <div className="app-claude-model-topbar-panel__template-row">
                <Typography.Text className="app-claude-model-topbar-panel__label">
                  模板
                </Typography.Text>
                <Space wrap size={4}>
                  {OPENCODE_PROFILE_TEMPLATES.map((t) => (
                    <Button
                      key={t.id}
                      size="small"
                      icon={addAppliedTemplate === t.id ? <CheckOutlined /> : undefined}
                      type={addAppliedTemplate === t.id ? "primary" : "default"}
                      onClick={() => applyTemplate(t.id)}
                    >
                      {t.label}
                    </Button>
                  ))}
                </Space>
              </div>
              <OpencodeSettingsEditor
                value={addSettingsJson}
                onChange={setAddSettingsJson}
                height={MODEL_PROFILE_JSON_EDITOR_HEIGHT}
              />
            </>
          ) : (
            <ClaudeSettingsJsonEditor
              value={addSettingsJson}
              onChange={setAddSettingsJson}
              height={MODEL_PROFILE_JSON_EDITOR_HEIGHT}
            />
          )}
        </div>
      </Modal>

      <Modal
        title={configProfile ? `全局配置 · ${configProfile.name}` : "全局配置"}
        open={configOpen}
        width={modalWidth()}
        zIndex={MODEL_PROFILE_MODAL_Z_INDEX}
        className="app-claude-model-topbar-modal"
        {...MODEL_PROFILE_MODAL_PROPS}
        onCancel={() => {
          setConfigOpen(false);
          setConfigProfile(null);
        }}
        onOk={() => void handleSaveConfig()}
        okText="保存并应用全局"
        cancelText="取消"
        confirmLoading={savingConfig}
        destroyOnHidden
      >
        <div className="app-claude-model-topbar-panel__form app-claude-model-topbar-panel__form--modal">
          <div className="app-claude-model-topbar-panel__form-row app-claude-model-topbar-panel__form-row--meta">
            <div className="app-claude-model-topbar-panel__form-field">
              <label className="app-claude-model-topbar-panel__label">公司</label>
              <Input
                size="small"
                value={configCompany}
                onChange={(e) =>
                  setConfigCompany(normalizeModelProfileLabelInput(e.target.value))
                }
                placeholder="百炼"
                maxLength={80}
              />
            </div>
            <div className="app-claude-model-topbar-panel__form-field">
              <label className="app-claude-model-topbar-panel__label">名称</label>
              <Input
                size="small"
                value={configName}
                onChange={(e) =>
                  setConfigName(normalizeModelProfileLabelInput(e.target.value))
                }
                placeholder="glm-5.1"
                maxLength={80}
              />
            </div>
            <div className="app-claude-model-topbar-panel__form-field">
              <label className="app-claude-model-topbar-panel__label">官网</label>
              <Input
                size="small"
                value={configOfficialWebsite}
                onChange={(e) =>
                  setConfigOfficialWebsite(
                    normalizeModelProfileOfficialWebsiteInput(e.target.value),
                  )
                }
                placeholder="可选"
                maxLength={512}
              />
            </div>
          </div>
          {configProfile &&
          (normalizeModelProfileEngine(configProfile.engine) === "claude" ||
            normalizeModelProfileEngine(configProfile.engine) === "codex" ||
            normalizeModelProfileEngine(configProfile.engine) === "opencode") ? (
            <ModelProfileQuickConfigFields
              sourceValue={configQuickConfigSource}
              onApply={applyConfigQuickConfig}
              modelPlaceholder={
                normalizeModelProfileEngine(configProfile.engine) === "opencode"
                  ? "provider/model"
                  : "model id"
              }
              engine={normalizeModelProfileEngine(configProfile.engine)}
              modelOptions={configModelOptions}
            />
          ) : null}
          <div className="app-claude-model-topbar-panel__json-head">
            <div className="app-claude-model-topbar-panel__json-head-text">
              <label className="app-claude-model-topbar-panel__label">
                {editingCodexProfile ? "Codex 配置" : "配置 JSON"}
              </label>
              <Typography.Paragraph type="secondary" className="app-claude-model-topbar-panel__hint">
                {editingCodexProfile ? (
                  <>
                    使用快捷配置选择 Provider 可快速填充；如需精细控制，展开高级编辑{" "}
                    <Typography.Text code>auth.json</Typography.Text> 与{" "}
                    <Typography.Text code>config.toml</Typography.Text>。
                  </>
                ) : normalizeModelProfileEngine(configProfile?.engine) === "opencode" ? (
                  <>
                    编辑后将合并写入用户级 OpenCode{" "}
                    <Typography.Text code>~/.config/opencode/opencode.json</Typography.Text>
                    ，并更新该档案。
                  </>
                ) : (
                  <>
                    编辑后将写入用户级 Claude Code <Typography.Text code>settings.json</Typography.Text>
                    ，并更新该档案。
                  </>
                )}
              </Typography.Paragraph>
            </div>
          </div>
          {editingCodexProfile ? (
            <Collapse
              ghost
              size="small"
              className="app-claude-model-topbar-panel__codex-editor-collapse"
              defaultActiveKey={[]}
              items={[
                {
                  key: "advanced",
                  label: "高级配置（auth.json / config.toml）",
                  children: (
                    <CodexProfileSettingsEditor
                      compact
                      authJson={configCodexAuthJson}
                      configToml={configCodexConfigToml}
                      onAuthJsonChange={setConfigCodexAuthJson}
                      onConfigTomlChange={setConfigCodexConfigToml}
                    />
                  ),
                },
              ]}
            />
          ) : configProfile && normalizeModelProfileEngine(configProfile.engine) === "opencode" ? (
            <OpencodeSettingsEditor
              value={settingsDraft}
              onChange={setSettingsDraft}
              height={MODEL_PROFILE_JSON_EDITOR_HEIGHT}
            />
          ) : (
            <ClaudeSettingsJsonEditor
              value={settingsDraft}
              onChange={setSettingsDraft}
              height={MODEL_PROFILE_JSON_EDITOR_HEIGHT}
            />
          )}
        </div>
      </Modal>
    </div>
  );
}

function modalWidth(): number {
  return Math.min(820, typeof window !== "undefined" ? window.innerWidth * 0.92 : 820);
}

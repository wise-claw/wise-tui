import { CloudSyncOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Empty, Input, List, Modal, Segmented, Typography, message } from "antd";
import { useCallback, useMemo, useState } from "react";
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
} from "../../services/claudeModelProfiles";
import type { ClaudeModelProfile, ClaudeModelProfileStoreView } from "../../types/claudeModelProfile";
import {
  normalizeModelProfileEngine,
  resolveActiveModelProfileId,
  resolveEffectiveModelForProfileEngine,
  modelProfileEngineLabel,
  buildOptimisticApplyStoreView,
  type ModelProfileEngine,
} from "../../types/claudeModelProfile";
import { formatClaudeModelLabel } from "../../utils/claudeModel";
import {
  normalizeModelProfileLabelInput,
  validateModelProfileLabel,
} from "../../utils/modelProfileLabel";
import {
  EMPTY_CODEX_AUTH_JSON,
  EMPTY_CODEX_CONFIG_TOML,
  parseCodexProfileEnvelopeJson,
  serializeCodexProfileEnvelope,
  validateCodexProfileDraft,
} from "../../utils/codexProfileEnvelope";
import { ClaudeSettingsJsonEditor } from "./ClaudeSettingsJsonEditor";
import { CodexProfileSettingsEditor } from "./CodexProfileSettingsEditor";
import { ModelProfileListRow } from "./ModelProfileListRow";
import "./ClaudeModelTopbarTrigger.css";

interface Props {
  store: ClaudeModelProfileStoreView | null;
  setStore: React.Dispatch<React.SetStateAction<ClaudeModelProfileStoreView | null>>;
  loading: boolean;
  onApplied?: () => void;
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

export function ClaudeModelTopbarPanel({ store, setStore, loading, onApplied }: Props) {
  const [panelEngine, setPanelEngine] = useState<ModelProfileEngine>("claude");
  const [addOpen, setAddOpen] = useState(false);
  const [addCompany, setAddCompany] = useState("");
  const [addName, setAddName] = useState("");
  const [addSettingsJson, setAddSettingsJson] = useState("{\n}\n");
  const [addCodexAuthJson, setAddCodexAuthJson] = useState(EMPTY_CODEX_AUTH_JSON);
  const [addCodexConfigToml, setAddCodexConfigToml] = useState(EMPTY_CODEX_CONFIG_TOML);
  const [addLoadingJson, setAddLoadingJson] = useState(false);
  const [addSaving, setAddSaving] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [configProfile, setConfigProfile] = useState<ClaudeModelProfile | null>(null);
  const [configCompany, setConfigCompany] = useState("");
  const [configName, setConfigName] = useState("");
  const [settingsDraft, setSettingsDraft] = useState("");
  const [configCodexAuthJson, setConfigCodexAuthJson] = useState(EMPTY_CODEX_AUTH_JSON);
  const [configCodexConfigToml, setConfigCodexConfigToml] = useState(EMPTY_CODEX_CONFIG_TOML);
  const [savingConfig, setSavingConfig] = useState(false);
  const [syncingCcSwitch, setSyncingCcSwitch] = useState(false);
  const [applyingProfileId, setApplyingProfileId] = useState<string | null>(null);

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

  const openAddModal = useCallback(() => {
    setAddCompany("");
    setAddName("");
    setAddSettingsJson("{\n}\n");
    setAddCodexAuthJson(EMPTY_CODEX_AUTH_JSON);
    setAddCodexConfigToml(EMPTY_CODEX_CONFIG_TOML);
    setAddOpen(true);
    void loadGlobalSettingsIntoAdd();
  }, [loadGlobalSettingsIntoAdd]);

  const handleApply = useCallback(
    async (profileId: string) => {
      if (!store) return;
      const previous = store;
      const optimistic = buildOptimisticApplyStoreView(store, profileId);
      if (optimistic) {
        setStore(optimistic);
        setApplyingProfileId(profileId);
      }
      try {
        const next = await applyClaudeModelProfile(profileId);
        setStore(next);
        const effective =
          resolveEffectiveModelForProfileEngine(panelEngine, next)?.trim() || null;
        message.success(
          effective
            ? `已切换模型配置，当前模型：${formatClaudeModelLabel(effective)}`
            : panelEngine === "codex"
              ? "已切换并写入 Codex 全局 auth.json / config.toml"
              : panelEngine === "opencode"
                ? "已切换并写入 OpenCode 全局 opencode.json"
                : "已切换并替换 Claude Code 全局 settings.json",
        );
        dispatchModelProfileStoreChanged(next, { engine: panelEngine, effectiveModel: effective });
        onApplied?.();
      } catch (e) {
        setStore(previous);
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
      const next = await createClaudeModelProfile(addCompany, name, settingsPayload, panelEngine);
      setStore(next);
      dispatchModelProfileStoreChanged(next, {
        engine: panelEngine,
        skipComposerPickerRefresh: true,
      });
      setAddOpen(false);
      setAddCompany("");
      setAddName("");
      message.success("已保存模型配置");
    } catch (e) {
      message.error(typeof e === "string" ? e : "新增失败");
    } finally {
      setAddSaving(false);
    }
  }, [addCompany, addName, addSettingsJson, addCodexAuthJson, addCodexConfigToml, panelEngine]);

  const openConfig = useCallback((profile: ClaudeModelProfile) => {
    setConfigProfile(profile);
    setConfigCompany(profile.company?.trim() || profile.name?.trim() || "");
    setConfigName(profile.name || "");
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
        settingsJson,
        engine: profileEngine,
        updatedAtMs: Date.now(),
      };
      const next = await upsertClaudeModelProfile(updatedProfile);
      setStore(next);
      message.success(
        resolveEffectiveModelForProfileEngine(profileEngine, next)?.trim()
          ? `已保存全局配置，当前模型：${formatClaudeModelLabel(
              resolveEffectiveModelForProfileEngine(profileEngine, next)!.trim(),
            )}`
          : profileEngine === "codex"
            ? "已保存 Codex 档案"
            : profileEngine === "opencode"
              ? "已保存 OpenCode 档案"
              : "已保存到数据库并写入 Claude Code 全局 settings.json",
      );
      dispatchModelProfileStoreChanged(next, { engine: profileEngine });
      setConfigOpen(false);
      setConfigProfile(null);
      onApplied?.();
    } catch (e) {
      message.error(typeof e === "string" ? e : "保存失败");
    } finally {
      setSavingConfig(false);
    }
  }, [configProfile, configCompany, configName, settingsDraft, configCodexAuthJson, configCodexConfigToml, onApplied]);

  const handleSyncFromCcSwitch = useCallback(async () => {
    setSyncingCcSwitch(true);
    try {
      const result = await syncClaudeModelProfilesFromCcSwitch();
      setStore(result.store);
      dispatchModelProfileStoreChanged(result.store, {
        engine: panelEngine,
        skipComposerPickerRefresh: true,
      });
      message.success(result.message);
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
      message.success("已删除");
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
  const activeProfileId = resolveActiveModelProfileId(panelEngine, store);
  const effective = resolveEffectiveModelForProfileEngine(panelEngine, store)?.trim() || "—";
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
          当前：{formatClaudeModelLabel(effective)}
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
      </header>

      {profiles.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={`暂无已保存的 ${engineLabel} 模型配置`}
          className="app-claude-model-topbar-panel__empty"
        />
      ) : (
        <List
          size="small"
          className="app-claude-model-topbar-panel__list"
          dataSource={profiles}
          loading={loading}
          rowKey="id"
          renderItem={(item) => (
            <ModelProfileListRow
              item={item}
              active={activeProfileId === item.id}
              applying={applyingProfileId === item.id}
              onApply={handleApplyById}
              onConfigure={openConfig}
              onDelete={handleDeleteById}
            />
          )}
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
        classNames={
          panelEngine === "codex" ? { body: "app-claude-model-topbar-modal__body--codex" } : undefined
        }
        onCancel={() => setAddOpen(false)}
        onOk={() => void handleAdd()}
        okText="保存"
        cancelText="取消"
        confirmLoading={addSaving}
        destroyOnHidden
      >
        <div className="app-claude-model-topbar-panel__form">
          <div className="app-claude-model-topbar-panel__form-row">
            <div className="app-claude-model-topbar-panel__form-field">
              <label className="app-claude-model-topbar-panel__label">公司</label>
              <Input
                value={addCompany}
                onChange={(e) =>
                  setAddCompany(normalizeModelProfileLabelInput(e.target.value))
                }
                placeholder="例如：百炼 / Bailian-v2.0"
                maxLength={80}
              />
            </div>
            <div className="app-claude-model-topbar-panel__form-field">
              <label className="app-claude-model-topbar-panel__label">名称</label>
              <Input
                value={addName}
                onChange={(e) => setAddName(normalizeModelProfileLabelInput(e.target.value))}
                placeholder="例如：Qwen-3.6 / glm-5.1"
                maxLength={80}
              />
            </div>
          </div>
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
                    分别编辑 <Typography.Text code>auth.json</Typography.Text> 与{" "}
                    <Typography.Text code>config.toml</Typography.Text>；保存后写入{" "}
                    <Typography.Text code>~/.codex/</Typography.Text>（与 CC Switch 相同）。
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
            <CodexProfileSettingsEditor
              authJson={addCodexAuthJson}
              configToml={addCodexConfigToml}
              onAuthJsonChange={setAddCodexAuthJson}
              onConfigTomlChange={setAddCodexConfigToml}
            />
          ) : (
            <ClaudeSettingsJsonEditor
              value={addSettingsJson}
              onChange={setAddSettingsJson}
              height={360}
            />
          )}
        </div>
      </Modal>

      <Modal
        title={configProfile ? `全局配置 · ${configProfile.name}` : "全局配置"}
        open={configOpen}
        width={modalWidth()}
        classNames={
          editingCodexProfile ? { body: "app-claude-model-topbar-modal__body--codex" } : undefined
        }
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
        <div className="app-claude-model-topbar-panel__form">
          <div className="app-claude-model-topbar-panel__form-row">
            <div className="app-claude-model-topbar-panel__form-field">
              <label className="app-claude-model-topbar-panel__label">公司</label>
              <Input
                value={configCompany}
                onChange={(e) =>
                  setConfigCompany(normalizeModelProfileLabelInput(e.target.value))
                }
                placeholder="例如：百炼 / Bailian-v2.0"
                maxLength={80}
              />
            </div>
            <div className="app-claude-model-topbar-panel__form-field">
              <label className="app-claude-model-topbar-panel__label">名称</label>
              <Input
                value={configName}
                onChange={(e) =>
                  setConfigName(normalizeModelProfileLabelInput(e.target.value))
                }
                placeholder="例如：Qwen-3.6 / glm-5.1"
                maxLength={80}
              />
            </div>
          </div>
          <div className="app-claude-model-topbar-panel__json-head">
            <div className="app-claude-model-topbar-panel__json-head-text">
              <label className="app-claude-model-topbar-panel__label">
                {editingCodexProfile ? "Codex 配置" : "配置 JSON"}
              </label>
              <Typography.Paragraph type="secondary" className="app-claude-model-topbar-panel__hint">
                {editingCodexProfile ? (
                  <>
                    分别编辑 <Typography.Text code>auth.json</Typography.Text> 与{" "}
                    <Typography.Text code>config.toml</Typography.Text>，保存后更新档案。
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
            <CodexProfileSettingsEditor
              authJson={configCodexAuthJson}
              configToml={configCodexConfigToml}
              onAuthJsonChange={setConfigCodexAuthJson}
              onConfigTomlChange={setConfigCodexConfigToml}
            />
          ) : (
            <ClaudeSettingsJsonEditor
              value={settingsDraft}
              onChange={setSettingsDraft}
              height={360}
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

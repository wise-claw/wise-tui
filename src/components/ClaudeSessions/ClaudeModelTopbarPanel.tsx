import { DeleteOutlined, PlusOutlined, SettingOutlined } from "@ant-design/icons";
import { Button, Empty, Input, List, Modal, Typography, message } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  applyClaudeModelProfile,
  createClaudeModelProfile,
  deleteClaudeModelProfile,
  getClaudeModelProfileStore,
  getClaudeUserSettingsJson,
  saveClaudeUserSettingsJson,
  WISE_CLAUDE_USER_SETTINGS_CHANGED,
} from "../../services/claudeModelProfiles";
import type { ClaudeModelProfile, ClaudeModelProfileStoreView } from "../../types/claudeModelProfile";
import { formatClaudeModelLabel } from "../../utils/claudeModel";
import { ClaudeSettingsJsonEditor } from "./ClaudeSettingsJsonEditor";

interface Props {
  onApplied?: () => void;
}

function validateSettingsJson(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return "配置 JSON 不能为空";
  try {
    const v = JSON.parse(trimmed) as unknown;
    if (v === null || typeof v !== "object" || Array.isArray(v)) {
      return "配置 JSON 顶层必须是对象";
    }
    return null;
  } catch (e) {
    return e instanceof Error ? `JSON 解析失败：${e.message}` : "JSON 解析失败";
  }
}

export function ClaudeModelTopbarPanel({ onApplied }: Props) {
  const [store, setStore] = useState<ClaudeModelProfileStoreView | null>(null);
  const [loading, setLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addSettingsJson, setAddSettingsJson] = useState("{\n}\n");
  const [addLoadingJson, setAddLoadingJson] = useState(false);
  const [addSaving, setAddSaving] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [configProfile, setConfigProfile] = useState<ClaudeModelProfile | null>(null);
  const [settingsDraft, setSettingsDraft] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getClaudeModelProfileStore();
      setStore(next);
    } catch (e) {
      message.error(typeof e === "string" ? e : "加载模型配置失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadGlobalSettingsIntoAdd = useCallback(async () => {
    setAddLoadingJson(true);
    try {
      const text = await getClaudeUserSettingsJson();
      setAddSettingsJson(text);
    } catch (e) {
      message.error(typeof e === "string" ? e : "读取全局配置失败");
    } finally {
      setAddLoadingJson(false);
    }
  }, []);

  const openAddModal = useCallback(() => {
    setAddName("");
    setAddSettingsJson("{\n}\n");
    setAddOpen(true);
    void loadGlobalSettingsIntoAdd();
  }, [loadGlobalSettingsIntoAdd]);

  const handleApply = useCallback(
    async (profileId: string) => {
      try {
        const next = await applyClaudeModelProfile(profileId);
        setStore(next);
        message.success("已切换并替换 Claude Code 全局 settings.json");
        window.dispatchEvent(new CustomEvent(WISE_CLAUDE_USER_SETTINGS_CHANGED));
        onApplied?.();
      } catch (e) {
        message.error(typeof e === "string" ? e : "切换失败");
      }
    },
    [onApplied],
  );

  const handleAdd = useCallback(async () => {
    const name = addName.trim();
    if (!name) {
      message.warning("请输入配置名称");
      return;
    }
    const jsonErr = validateSettingsJson(addSettingsJson);
    if (jsonErr) {
      message.warning(jsonErr);
      return;
    }
    setAddSaving(true);
    try {
      const next = await createClaudeModelProfile(name, addSettingsJson);
      setStore(next);
      setAddOpen(false);
      setAddName("");
      message.success("已保存模型配置");
    } catch (e) {
      message.error(typeof e === "string" ? e : "新增失败");
    } finally {
      setAddSaving(false);
    }
  }, [addName, addSettingsJson]);

  const openConfig = useCallback((profile: ClaudeModelProfile) => {
    setConfigProfile(profile);
    setSettingsDraft(profile.settingsJson);
    setConfigOpen(true);
    setSavingConfig(false);
  }, []);

  const handleSaveConfig = useCallback(async () => {
    if (!configProfile) return;
    const jsonErr = validateSettingsJson(settingsDraft);
    if (jsonErr) {
      message.warning(jsonErr);
      return;
    }
    setSavingConfig(true);
    try {
      const next = await saveClaudeUserSettingsJson(settingsDraft, configProfile.id);
      setStore(next);
      message.success("已保存到数据库并写入 Claude Code 全局 settings.json");
      window.dispatchEvent(new CustomEvent(WISE_CLAUDE_USER_SETTINGS_CHANGED));
      setConfigOpen(false);
      setConfigProfile(null);
      onApplied?.();
    } catch (e) {
      message.error(typeof e === "string" ? e : "保存失败");
    } finally {
      setSavingConfig(false);
    }
  }, [configProfile, settingsDraft, onApplied]);

  const handleDelete = useCallback(async (profileId: string) => {
    try {
      const next = await deleteClaudeModelProfile(profileId);
      setStore(next);
      message.success("已删除");
    } catch (e) {
      message.error(typeof e === "string" ? e : "删除失败");
    }
  }, []);

  const effective = store?.effectiveModel?.trim() || "—";
  const profiles = store?.profiles ?? [];

  return (
    <div className="app-claude-model-topbar-panel">
      <header className="app-claude-model-topbar-panel__head">
        <Typography.Text className="app-claude-model-topbar-panel__title">模型切换</Typography.Text>
        <Typography.Text type="secondary" className="app-claude-model-topbar-panel__effective">
          当前：{formatClaudeModelLabel(effective)}
        </Typography.Text>
      </header>

      {profiles.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="暂无已保存的模型配置"
          className="app-claude-model-topbar-panel__empty"
        />
      ) : (
        <List
          size="small"
          className="app-claude-model-topbar-panel__list"
          dataSource={profiles}
          loading={loading}
          renderItem={(item) => {
            const active = store?.activeProfileId === item.id;
            return (
              <List.Item
                className={
                  "app-claude-model-topbar-panel__item" +
                  (active ? " app-claude-model-topbar-panel__item--active" : "")
                }
                actions={[
                  <Button
                    key="cfg"
                    type="text"
                    size="small"
                    icon={<SettingOutlined />}
                    aria-label={`配置 ${item.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      openConfig(item);
                    }}
                  />,
                  <Button
                    key="del"
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    aria-label={`删除 ${item.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDelete(item.id);
                    }}
                  />,
                ]}
              >
                <button
                  type="button"
                  className="app-claude-model-topbar-panel__item-main"
                  onClick={() => void handleApply(item.id)}
                >
                  <span className="app-claude-model-topbar-panel__item-name">{item.name}</span>
                  <span className="app-claude-model-topbar-panel__item-model">
                    {formatClaudeModelLabel(item.modelId)}
                  </span>
                </button>
              </List.Item>
            );
          }}
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
        onCancel={() => setAddOpen(false)}
        onOk={() => void handleAdd()}
        okText="保存"
        cancelText="取消"
        confirmLoading={addSaving}
        destroyOnHidden
      >
        <div className="app-claude-model-topbar-panel__form">
          <label className="app-claude-model-topbar-panel__label">名称</label>
          <Input
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            placeholder="例如：百炼 Qwen"
          />
          <div className="app-claude-model-topbar-panel__json-head">
            <label className="app-claude-model-topbar-panel__label">配置 JSON</label>
            <Button
              type="link"
              size="small"
              loading={addLoadingJson}
              onClick={() => void loadGlobalSettingsIntoAdd()}
            >
              载入当前全局配置
            </Button>
          </div>
          <Typography.Paragraph type="secondary" className="app-claude-model-topbar-panel__hint">
            完整 Claude Code 用户级 <Typography.Text code>settings.json</Typography.Text>
            ；切换配置时将整体替换全局文件（与 cc-switch 相同）。
          </Typography.Paragraph>
          <ClaudeSettingsJsonEditor
            value={addSettingsJson}
            onChange={setAddSettingsJson}
            height={360}
          />
        </div>
      </Modal>

      <Modal
        title={configProfile ? `全局配置 · ${configProfile.name}` : "全局配置"}
        open={configOpen}
        width={modalWidth()}
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
        <Typography.Paragraph type="secondary" className="app-claude-model-topbar-panel__hint">
          编辑后将写入用户级 Claude Code <Typography.Text code>settings.json</Typography.Text>
          ，并更新该档案。
        </Typography.Paragraph>
        <ClaudeSettingsJsonEditor
          value={settingsDraft}
          onChange={setSettingsDraft}
          height={420}
        />
      </Modal>
    </div>
  );
}

function modalWidth(): number {
  return Math.min(820, typeof window !== "undefined" ? window.innerWidth * 0.92 : 820);
}

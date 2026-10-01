import { DeleteOutlined, InfoCircleOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Input, InputNumber, Modal, Spin, Tag, message } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  getDeepseekHarnessConfig,
  saveDeepseekHarnessConfig,
  type DeepseekHarnessConfig,
  type DeepseekHarnessModelConfig,
} from "../../services/deepseek";
import "./DeepseekHarnessSettingsModal.css";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: (config: DeepseekHarnessConfig) => void | Promise<void>;
}

const DEFAULT_BASE_URL = "https://api.deepseek.com";

function blankModel(): DeepseekHarnessModelConfig {
  return { id: "", name: "", description: "", contextWindow: null, maxTokens: null };
}

function hasAdvancedModelConfig(model: DeepseekHarnessModelConfig) {
  return Boolean(model.description || model.contextWindow || model.maxTokens);
}

export function DeepseekHarnessSettingsModal({ open, onClose, onSaved }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [models, setModels] = useState<DeepseekHarnessModelConfig[]>([]);
  const [expandedModels, setExpandedModels] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const config = await getDeepseekHarnessConfig();
      setApiKeyConfigured(config.apiKeyConfigured);
      setApiKey("");
      setClearApiKey(false);
      setBaseUrl(config.baseUrl || DEFAULT_BASE_URL);
      const nextModels = config.models.length > 0 ? config.models : [blankModel()];
      setModels(nextModels);
      setExpandedModels(
        new Set(
          nextModels.flatMap((model, index) =>
            hasAdvancedModelConfig(model) ? [index] : [],
          ),
        ),
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const updateModel = useCallback(
    (index: number, patch: Partial<DeepseekHarnessModelConfig>) => {
      setModels((current) =>
        current.map((model, modelIndex) =>
          modelIndex === index ? { ...model, ...patch } : model,
        ),
      );
    },
    [],
  );

  const addModel = useCallback(() => {
    setModels((current) => [...current, blankModel()]);
  }, []);

  const removeModel = useCallback((index: number) => {
    setModels((current) => current.filter((_, itemIndex) => itemIndex !== index));
    setExpandedModels((current) => {
      const next = new Set<number>();
      current.forEach((itemIndex) => {
        if (itemIndex < index) next.add(itemIndex);
        if (itemIndex > index) next.add(itemIndex - 1);
      });
      return next;
    });
  }, []);

  const handleSave = useCallback(async () => {
    const normalizedModels = models.map((model) => ({
      ...model,
      id: model.id.trim(),
      name: model.name?.trim() || null,
      description: model.description?.trim() || null,
      contextWindow: model.contextWindow || null,
      maxTokens: model.maxTokens || null,
    }));
    if (!baseUrl.trim()) {
      message.warning("请输入接口地址");
      return;
    }
    if (normalizedModels.length === 0 || normalizedModels.some((model) => !model.id)) {
      message.warning("至少保留一个模型，并填写每个模型的 ID");
      return;
    }
    if (new Set(normalizedModels.map((model) => model.id)).size !== normalizedModels.length) {
      message.warning("模型 ID 不能重复");
      return;
    }
    setSaving(true);
    try {
      const saved = await saveDeepseekHarnessConfig({
        apiKey: apiKey.trim() || null,
        clearApiKey,
        baseUrl: baseUrl.trim(),
        models: normalizedModels,
      });
      setApiKey("");
      setClearApiKey(false);
      setApiKeyConfigured(saved.apiKeyConfigured);
      await onSaved(saved);
      message.success("DeepSeek Harness 配置已保存");
      onClose();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }, [apiKey, baseUrl, clearApiKey, models, onClose, onSaved]);

  return (
    <Modal
      open={open}
      title="DeepSeek Harness 配置"
      width={720}
      className="app-deepseek-settings-modal"
      okText="保存并刷新模型"
      cancelText="取消"
      confirmLoading={saving}
      onOk={() => void handleSave()}
      onCancel={onClose}
      destroyOnHidden
    >
      {loading ? (
        <div className="app-deepseek-settings__loading">
          <Spin />
        </div>
      ) : (
        <div className="app-deepseek-settings">
          <div className="app-deepseek-settings__hint">
            <InfoCircleOutlined />
            <span>API Key 只写入本机 DSH 凭据；保存后会刷新可用模型。</span>
          </div>

          <section className="app-deepseek-settings__connection">
            <div className="app-deepseek-settings__field">
              <div className="app-deepseek-settings__label-row">
                <label htmlFor="deepseek-api-key">API Key</label>
                {apiKeyConfigured && !clearApiKey ? <Tag color="success">已配置</Tag> : null}
                {clearApiKey ? <Tag color="warning">将清除</Tag> : null}
              </div>
              <div className="app-deepseek-settings__key-row">
                <Input.Password
                  id="deepseek-api-key"
                  value={apiKey}
                  autoComplete="new-password"
                  placeholder={apiKeyConfigured ? "留空保留现有 Key" : "输入 API Key"}
                  onChange={(event) => {
                    setApiKey(event.target.value);
                    if (event.target.value) setClearApiKey(false);
                  }}
                />
                {apiKeyConfigured ? (
                  <Button
                    danger={clearApiKey}
                    onClick={() => {
                      setClearApiKey((value) => !value);
                      setApiKey("");
                    }}
                  >
                    {clearApiKey ? "撤销" : "清除"}
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="app-deepseek-settings__field">
              <label htmlFor="deepseek-base-url">接口地址</label>
              <Input
                id="deepseek-base-url"
                value={baseUrl}
                placeholder={DEFAULT_BASE_URL}
                onChange={(event) => setBaseUrl(event.target.value)}
              />
            </div>
          </section>

          <section className="app-deepseek-settings__section">
            <div className="app-deepseek-settings__models-title">
              <div>
                <strong>模型</strong>
                <span>ID 用于请求，名称用于界面显示</span>
              </div>
              <Button
                icon={<PlusOutlined />}
                onClick={addModel}
              >
                添加模型
              </Button>
            </div>
            <div className="app-deepseek-settings__models">
              {models.map((model, index) => (
                <div className="app-deepseek-settings__model" key={index}>
                  <div className="app-deepseek-settings__model-main">
                    <Input
                      value={model.id}
                      placeholder="模型 ID，例如 deepseek-chat"
                      aria-label={`模型 ${index + 1} ID`}
                      onChange={(event) => updateModel(index, { id: event.target.value })}
                    />
                    <Input
                      value={model.name ?? ""}
                      placeholder="显示名称（可选）"
                      aria-label={`模型 ${index + 1} 显示名称`}
                      onChange={(event) => updateModel(index, { name: event.target.value })}
                    />
                    <Button
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      aria-label={`删除模型 ${index + 1}`}
                      disabled={models.length <= 1}
                      onClick={() => removeModel(index)}
                    />
                  </div>
                  <details
                    className="app-deepseek-settings__advanced"
                    open={expandedModels.has(index)}
                    onToggle={(event) => {
                      const expanded = event.currentTarget.open;
                      setExpandedModels((current) => {
                        const next = new Set(current);
                        if (expanded) next.add(index);
                        else next.delete(index);
                        return next;
                      });
                    }}
                  >
                    <summary>
                      高级参数
                      {hasAdvancedModelConfig(model) ? <span>已设置</span> : null}
                    </summary>
                    <div className="app-deepseek-settings__model-details">
                      <Input
                        value={model.description ?? ""}
                        placeholder="模型说明（可选）"
                        aria-label={`模型 ${index + 1} 说明`}
                        onChange={(event) => updateModel(index, { description: event.target.value })}
                      />
                      <InputNumber
                        min={1}
                        precision={0}
                        value={model.contextWindow ?? null}
                        placeholder="上下文窗口"
                        aria-label={`模型 ${index + 1} 上下文窗口`}
                        onChange={(value) => updateModel(index, { contextWindow: value })}
                      />
                      <InputNumber
                        min={1}
                        precision={0}
                        value={model.maxTokens ?? null}
                        placeholder="最大输出 Token"
                        aria-label={`模型 ${index + 1} 最大输出 Token`}
                        onChange={(value) => updateModel(index, { maxTokens: value })}
                      />
                    </div>
                  </details>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </Modal>
  );
}

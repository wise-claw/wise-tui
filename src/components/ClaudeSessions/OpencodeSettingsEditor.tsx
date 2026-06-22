import {
  DeleteOutlined,
  PlusOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
} from "@ant-design/icons";
import {
  Button,
  Collapse,
  Input,
  Tag,
  Typography,
  Space,
  Modal,
  message,
} from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClaudeSettingsJsonEditor } from "./ClaudeSettingsJsonEditor";
import "./OpencodeSettingsEditor.css";

// ── 类型 ────────────────────────────────────────────────────────────────────

interface ProviderEntry {
  id: string;
  name: string;
  npm: string;
  baseURL: string;
  apiKey: string;
  models: string[];
}

// ── 解析 / 序列化 ────────────────────────────────────────────────────────────

function parseOpencodeJson(value: string): {
  root: Record<string, unknown>;
  entries: ProviderEntry[];
} {
  let root: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(value || "{}");
    root = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    root = {};
  }
  const provider = root.provider;
  const providerMap =
    provider && typeof provider === "object" && !Array.isArray(provider)
      ? (provider as Record<string, unknown>)
      : {};
  const entries: ProviderEntry[] = Object.entries(providerMap).map(
    ([id, entry]) => {
      const e =
        entry && typeof entry === "object" && !Array.isArray(entry)
          ? (entry as Record<string, unknown>)
          : {};
      const opts =
        e.options && typeof e.options === "object" && !Array.isArray(e.options)
          ? (e.options as Record<string, unknown>)
          : {};
      const models =
        e.models && typeof e.models === "object" && !Array.isArray(e.models)
          ? Object.keys(e.models as Record<string, unknown>)
          : [];
      return {
        id,
        name: typeof e.name === "string" ? e.name : id,
        npm: typeof e.npm === "string" ? e.npm : "",
        baseURL: typeof opts.baseURL === "string" ? opts.baseURL : "",
        apiKey: typeof opts.apiKey === "string" ? opts.apiKey : "",
        models,
      };
    },
  );
  return { root, entries };
}

function serializeOpencodeJson(
  root: Record<string, unknown>,
  entries: ProviderEntry[],
): string {
  const provider: Record<string, unknown> = {};
  for (const entry of entries) {
    const p: Record<string, unknown> = {};
    p.name = entry.name || entry.id;
    if (entry.npm) p.npm = entry.npm;
    const opts: Record<string, unknown> = {};
    if (entry.baseURL) opts.baseURL = entry.baseURL;
    if (entry.apiKey) opts.apiKey = entry.apiKey;
    if (Object.keys(opts).length > 0) p.options = opts;
    if (entry.models.length > 0) {
      p.models = Object.fromEntries(
        entry.models.map((m) => [m, { name: m }]),
      );
    }
    provider[entry.id] = p;
  }
  root.provider = provider;

  delete root.disabled_providers;
  delete root.enabled_providers;

  return `${JSON.stringify(root, null, 2)}\n`;
}

// ── 组件 ────────────────────────────────────────────────────────────────────

interface Props {
  value: string;
  onChange: (value: string) => void;
  height?: number;
}

export function OpencodeSettingsEditor({
  value,
  onChange,
  height = 320,
}: Props) {
  const [showRaw, setShowRaw] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newProviderId, setNewProviderId] = useState("");

  const { root, entries } = useMemo(() => parseOpencodeJson(value), [value]);
  const [localEntries, setLocalEntries] = useState<ProviderEntry[]>(entries);
  const syncingRef = useRef(false);

  useEffect(() => {
    if (syncingRef.current) return;
    setLocalEntries(entries);
  }, [entries]);

  const commit = useCallback(
    (next: ProviderEntry[]) => {
      syncingRef.current = true;
      setLocalEntries(next);
      const serialized = serializeOpencodeJson({ ...root }, next);
      onChange(serialized);
      syncingRef.current = false;
    },
    [onChange, root],
  );

  const updateEntry = useCallback(
    (index: number, patch: Partial<ProviderEntry>) => {
      const next = localEntries.map((e, i) =>
        i === index ? { ...e, ...patch } : e,
      );
      commit(next);
    },
    [commit, localEntries],
  );

  const removeEntry = useCallback(
    (index: number) => {
      const next = localEntries.filter((_, i) => i !== index);
      commit(next);
    },
    [commit, localEntries],
  );

  const handleAddProvider = useCallback(() => {
    const id = newProviderId.trim();
    if (!id) {
      message.warning("请输入 Provider ID");
      return;
    }
    if (localEntries.some((e) => e.id === id)) {
      message.warning(`Provider "${id}" 已存在`);
      return;
    }
    const next: ProviderEntry[] = [
      ...localEntries,
      {
        id,
        name: id,
        npm: "@ai-sdk/openai-compatible",
        baseURL: "",
        apiKey: "",
        models: [],
      },
    ];
    commit(next);
    setAddModalOpen(false);
    setNewProviderId("");
    message.success(`已添加 Provider "${id}"`);
  }, [commit, localEntries, newProviderId]);

  const addModelToEntry = useCallback(
    (index: number) => {
      const current = localEntries[index];
      if (!current) return;
      Modal.confirm({
        title: "添加模型",
        content: (
          <Input
            id="opencode-add-model-input"
            placeholder="模型名称（如 deepseek-chat）"
            onPressEnter={(e) => {
              const val = (e.target as HTMLInputElement).value.trim();
              if (!val) return;
              if (current.models.includes(val)) {
                message.warning(`模型 "${val}" 已存在`);
                return;
              }
              updateEntry(index, { models: [...current.models, val] });
              Modal.destroyAll();
            }}
          />
        ),
        onOk: () => {
          const input = document.getElementById(
            "opencode-add-model-input",
          ) as HTMLInputElement;
          const val = input?.value?.trim();
          if (!val) {
            message.warning("请输入模型名称");
            return false;
          }
          if (current.models.includes(val)) {
            message.warning(`模型 "${val}" 已存在`);
            return false;
          }
          updateEntry(index, { models: [...current.models, val] });
          return true;
        },
      });
    },
    [localEntries, updateEntry],
  );

  const removeModelFromEntry = useCallback(
    (entryIndex: number, modelIndex: number) => {
      const current = localEntries[entryIndex];
      if (!current) return;
      const nextModels = current.models.filter((_, i) => i !== modelIndex);
      updateEntry(entryIndex, { models: nextModels });
    },
    [localEntries, updateEntry],
  );

  const providerItems = useMemo(
    () =>
      localEntries.map((entry, index) => ({
        key: entry.id,
        label: (
          <span className="app-opencode-settings-editor__provider-label">
            <Tag
              color="blue"
              className="app-opencode-settings-editor__provider-tag"
            >
              {entry.id}
            </Tag>
            <span className="app-opencode-settings-editor__provider-name-text">
              {entry.name || entry.id}
            </span>
          </span>
        ),
        extra: (
          <Button
            type="text"
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              removeEntry(index);
            }}
            aria-label={`删除 Provider ${entry.id}`}
          />
        ),
        children: (
          <div className="app-opencode-settings-editor__provider-fields">
            <div className="app-opencode-settings-editor__field-row">
              <div className="app-opencode-settings-editor__field">
                <label className="app-opencode-settings-editor__field-label">
                  ID
                </label>
                <Input
                  size="small"
                  value={entry.id}
                  disabled
                  className="app-opencode-settings-editor__field-input"
                />
              </div>
              <div className="app-opencode-settings-editor__field">
                <label className="app-opencode-settings-editor__field-label">
                  名称
                </label>
                <Input
                  size="small"
                  value={entry.name}
                  onChange={(e) => updateEntry(index, { name: e.target.value })}
                  placeholder={entry.id}
                  maxLength={80}
                  className="app-opencode-settings-editor__field-input"
                />
              </div>
            </div>
            <div className="app-opencode-settings-editor__field-row">
              <div className="app-opencode-settings-editor__field">
                <label className="app-opencode-settings-editor__field-label">
                  NPM
                </label>
                <Input
                  size="small"
                  value={entry.npm}
                  onChange={(e) => updateEntry(index, { npm: e.target.value })}
                  placeholder="@ai-sdk/openai-compatible"
                  maxLength={120}
                  className="app-opencode-settings-editor__field-input"
                />
              </div>
            </div>
            <div className="app-opencode-settings-editor__field-row">
              <div className="app-opencode-settings-editor__field">
                <label className="app-opencode-settings-editor__field-label">
                  Base URL
                </label>
                <Input
                  size="small"
                  value={entry.baseURL}
                  onChange={(e) =>
                    updateEntry(index, { baseURL: e.target.value })
                  }
                  placeholder="https://api.openai.com/v1"
                  maxLength={512}
                  className="app-opencode-settings-editor__field-input"
                />
              </div>
              <div className="app-opencode-settings-editor__field">
                <label className="app-opencode-settings-editor__field-label">
                  API Key
                </label>
                <Input.Password
                  size="small"
                  value={entry.apiKey}
                  onChange={(e) =>
                    updateEntry(index, { apiKey: e.target.value })
                  }
                  placeholder="sk-..."
                  maxLength={512}
                  visibilityToggle
                  className="app-opencode-settings-editor__field-input"
                />
              </div>
            </div>
            <div className="app-opencode-settings-editor__models-section">
              <label className="app-opencode-settings-editor__field-label">
                模型列表
              </label>
              <div className="app-opencode-settings-editor__models-list">
                {entry.models.length === 0 ? (
                  <Typography.Text
                    type="secondary"
                    className="app-opencode-settings-editor__models-empty"
                  >
                    暂无模型定义（可通过快捷配置或 JSON 手动添加）
                  </Typography.Text>
                ) : (
                  entry.models.map((model, mi) => (
                    <Tag
                      key={model}
                      closable
                      onClose={() => removeModelFromEntry(index, mi)}
                      className="app-opencode-settings-editor__model-tag"
                    >
                      {model}
                    </Tag>
                  ))
                )}
                <Button
                  type="dashed"
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() => addModelToEntry(index)}
                  className="app-opencode-settings-editor__add-model-btn"
                >
                  添加
                </Button>
              </div>
            </div>
          </div>
        ),
      })),
    [
      localEntries,
      removeEntry,
      updateEntry,
      addModelToEntry,
      removeModelFromEntry,
    ],
  );

  return (
    <div
      className="app-opencode-settings-editor"
      style={{ minHeight: height }}
    >
      {/* Provider 列表 */}
      {localEntries.length > 0 && (
        <Collapse
          size="small"
          items={providerItems}
          className="app-opencode-settings-editor__collapse"
          defaultActiveKey={localEntries.slice(0, 1).map((e) => e.id)}
        />
      )}

      {localEntries.length === 0 ? (
        <div className="app-opencode-settings-editor__empty">
          <Typography.Text type="secondary">
            暂无 Provider，请添加或使用快捷配置 / JSON 手动编辑
          </Typography.Text>
        </div>
      ) : null}

      {/* 添加 Provider */}
      <div className="app-opencode-settings-editor__add-provider-row">
        <Button
          type="dashed"
          size="small"
          icon={<PlusOutlined />}
          onClick={() => setAddModalOpen(true)}
        >
          添加 Provider
        </Button>
      </div>

      {/* Add Provider 弹窗 */}
      <Modal
        title="添加 Provider"
        open={addModalOpen}
        onOk={handleAddProvider}
        onCancel={() => {
          setAddModalOpen(false);
          setNewProviderId("");
        }}
        okText="添加"
        cancelText="取消"
        destroyOnHidden
        width={400}
      >
        <div style={{ margin: "12px 0" }}>
          <label className="app-opencode-settings-editor__field-label">
            Provider ID
          </label>
          <Input
            size="small"
            value={newProviderId}
            onChange={(e) => setNewProviderId(e.target.value.trim())}
            onPressEnter={handleAddProvider}
            placeholder="wise / openai / anthropic"
            maxLength={60}
          />
          <Typography.Text
            type="secondary"
            style={{ fontSize: 11, marginTop: 4, display: "block" }}
          >
            此 ID 将用于 model 路径（如 "wise/deepseek-chat"），添加后不可修改。
          </Typography.Text>
        </div>
      </Modal>

      {/* 原始 JSON 切换 */}
      <div className="app-opencode-settings-editor__raw-toggle">
        <Button
          type="link"
          size="small"
          icon={showRaw ? <EyeInvisibleOutlined /> : <EyeOutlined />}
          onClick={() => setShowRaw(!showRaw)}
        >
          {showRaw ? "隐藏原始 JSON" : "查看原始 JSON"}
        </Button>
      </div>

      {showRaw ? (
        <div className="app-opencode-settings-editor__raw-preview">
          <ClaudeSettingsJsonEditor
            value={value}
            onChange={onChange}
            height={Math.max(160, Math.min(height, 400))}
          />
        </div>
      ) : null}
    </div>
  );
}

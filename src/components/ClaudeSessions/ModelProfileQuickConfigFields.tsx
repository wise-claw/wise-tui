import { ThunderboltOutlined, CheckCircleFilled, WarningFilled } from "@ant-design/icons";
import { Button, Input, Select, Typography, Tooltip } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ModelProfileEngine } from "../../types/claudeModelProfile";
import {
  canApplyModelProfileQuickConfig,
  EMPTY_MODEL_PROFILE_QUICK_CONFIG,
  isModelProfileQuickConfigDirty,
  normalizeModelProfileQuickConfig,
  type ModelProfileQuickConfig,
} from "../../utils/modelProfileQuickConfig";
import {
  CODEX_PROVIDER_PRESETS,
  findCodexProviderPreset,
} from "../../utils/codexProviderPresets";

interface Props {
  sourceValue: ModelProfileQuickConfig;
  onApply: (value: ModelProfileQuickConfig) => boolean;
  /** 模型输入框占位文本；OpenCode 用 `provider/model`，其余默认 `model id`。 */
  modelPlaceholder?: string;
  /** 当前编辑的引擎，用于引擎特有行为（如 model 格式校验）。 */
  engine?: ModelProfileEngine;
  /** 可用模型选项列表（快捷选取）。 */
  modelOptions?: { label: string; value: string }[];
}

/** 校验 model 是否为 `provider/model` 格式。 */
function validateModelFormat(
  model: string,
  engine?: ModelProfileEngine,
): { valid: boolean; hint: string } | null {
  if (!model || engine !== "opencode") return null;
  const hasSlash = model.includes("/");
  if (!hasSlash) {
    return {
      valid: false,
      hint: "OpenCode 模型格式应为 provider/model，如 wise/deepseek-chat",
    };
  }
  const [providerId] = model.split("/", 2);
  if (!providerId) {
    return {
      valid: false,
      hint: 'Provider ID 不能为空，格式应为 provider/model（如 wise/deepseek-chat）',
    };
  }
  return { valid: true, hint: `Provider: ${providerId}` };
}

export function ModelProfileQuickConfigFields({
  sourceValue,
  onApply,
  modelPlaceholder,
  engine,
  modelOptions,
}: Props) {
  const [draft, setDraft] = useState(sourceValue);
  const [dirty, setDirty] = useState(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  // Codex provider 选择状态（仅 engine === "codex" 时使用）
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const providerAppliedRef = useRef(false);

  useEffect(() => {
    if (!dirty) {
      setDraft(sourceValue);
      // 外部值同步时重置 provider 选择标记
      providerAppliedRef.current = false;
    }
  }, [dirty, sourceValue]);

  /** 选择 Codex provider 时自动填充 URL 与 Model。 */
  const handleProviderChange = useCallback(
    (providerId: string) => {
      setSelectedProvider(providerId);
      const preset = findCodexProviderPreset(providerId);
      if (!preset) return;
      setDirty(true);
      providerAppliedRef.current = true;
      setDraft((prev) => ({
        ...prev,
        url: preset.defaultBaseUrl,
        model: prev.model || preset.defaultModel,
      }));
    },
    [],
  );

  const applyDraft = useCallback(() => {
    const normalized = normalizeModelProfileQuickConfig(draftRef.current);
    if (!canApplyModelProfileQuickConfig(normalized)) return;
    const applied = onApply(normalized);
    if (!applied) return;
    setDirty(false);
    setDraft(normalized);
  }, [onApply]);

  const updateField = useCallback((field: keyof ModelProfileQuickConfig, nextValue: string) => {
    setDirty(true);
    setDraft((prev) => ({ ...prev, [field]: nextValue }));
  }, []);

  const handleFieldBlur = useCallback(() => {
    const normalized = normalizeModelProfileQuickConfig(draftRef.current);
    if (!canApplyModelProfileQuickConfig(normalized)) return;
    if (!isModelProfileQuickConfigDirty(normalized, sourceValue)) return;
    applyDraft();
  }, [applyDraft, sourceValue]);

  const handleEnter = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      applyDraft();
    },
    [applyDraft],
  );

  const normalizedDraft = normalizeModelProfileQuickConfig(draft);
  const canApply =
    canApplyModelProfileQuickConfig(normalizedDraft) &&
    isModelProfileQuickConfigDirty(normalizedDraft, sourceValue);

  const modelValidation = useMemo(
    () => validateModelFormat(normalizedDraft.model, engine),
    [normalizedDraft.model, engine],
  );

  const showModelSelect =
    engine === "opencode" && modelOptions && modelOptions.length > 0;

  return (
    <section className="app-claude-model-topbar-panel__quick-config">
      <div className="app-claude-model-topbar-panel__quick-config-head">
        <Typography.Text className="app-claude-model-topbar-panel__label">快捷配置</Typography.Text>
        <Button
          type={canApply ? "link" : "text"}
          size="small"
          icon={<ThunderboltOutlined />}
          disabled={!canApply}
          onClick={applyDraft}
          className="app-claude-model-topbar-panel__quick-config-apply"
        >
          应用
        </Button>
      </div>
      {engine === "codex" ? (
        <div className="app-claude-model-topbar-panel__form-field app-claude-model-topbar-panel__provider-select">
          <label className="app-claude-model-topbar-panel__label">Provider</label>
          <Select
            size="small"
            value={selectedProvider}
            placeholder="选择第三方 API 服务商…"
            allowClear
            showSearch
            optionFilterProp="label"
            onChange={(val) => {
              if (val) {
                handleProviderChange(String(val));
              } else {
                setSelectedProvider(null);
              }
            }}
            options={CODEX_PROVIDER_PRESETS.map((p) => ({
              value: p.id,
              label: p.label,
            }))}
            style={{ width: "100%" }}
          />
        </div>
      ) : null}
      <div className="app-claude-model-topbar-panel__quick-config-grid">
        <div className="app-claude-model-topbar-panel__form-field">
          <label className="app-claude-model-topbar-panel__label">URL</label>
          <Input
            size="small"
            value={draft.url}
            onChange={(e) => updateField("url", e.target.value)}
            onBlur={handleFieldBlur}
            onKeyDown={handleEnter}
            placeholder="Base URL"
            maxLength={512}
          />
        </div>
        <div className="app-claude-model-topbar-panel__form-field">
          <label className="app-claude-model-topbar-panel__label">Auth</label>
          <Input.Password
            size="small"
            value={draft.auth}
            onChange={(e) => updateField("auth", e.target.value)}
            onBlur={handleFieldBlur}
            onKeyDown={handleEnter}
            placeholder="API Key"
            maxLength={512}
            visibilityToggle
          />
        </div>
        <div className="app-claude-model-topbar-panel__form-field">
          <label className="app-claude-model-topbar-panel__label">
            模型
            {modelValidation ? (
              <Tooltip title={modelValidation.hint}>
                {modelValidation.valid ? (
                  <CheckCircleFilled
                    style={{
                      color: "var(--ant-color-success)",
                      fontSize: 12,
                      marginLeft: 4,
                    }}
                  />
                ) : (
                  <WarningFilled
                    style={{
                      color: "var(--ant-color-warning)",
                      fontSize: 12,
                      marginLeft: 4,
                    }}
                  />
                )}
              </Tooltip>
            ) : null}
          </label>
          <div className="app-claude-model-topbar-panel__model-field-wrap">
            {showModelSelect ? (
              <Select
                size="small"
                value={normalizedDraft.model || undefined}
                onChange={(val) => updateField("model", val)}
                placeholder={modelPlaceholder ?? "model id"}
                allowClear
                showSearch
                className="app-claude-model-topbar-panel__model-select"
                dropdownMatchSelectWidth={false}
                notFoundContent="无可用模型"
                options={modelOptions}
              />
            ) : (
              <Input
                size="small"
                value={draft.model}
                onChange={(e) => updateField("model", e.target.value)}
                onBlur={handleFieldBlur}
                onKeyDown={handleEnter}
                placeholder={modelPlaceholder ?? "model id"}
                maxLength={120}
                status={
                  modelValidation && !modelValidation.valid ? "warning" : undefined
                }
              />
            )}
          </div>
          {modelValidation && !modelValidation.valid ? (
            <Typography.Text
              type="warning"
              className="app-claude-model-topbar-panel__model-hint"
              style={{ fontSize: 11, lineHeight: 1.4, marginTop: 2 }}
            >
              {modelValidation.hint}
            </Typography.Text>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export { EMPTY_MODEL_PROFILE_QUICK_CONFIG };

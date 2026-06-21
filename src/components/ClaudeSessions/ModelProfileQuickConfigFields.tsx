import { ThunderboltOutlined } from "@ant-design/icons";
import { Button, Input, Typography } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  canApplyModelProfileQuickConfig,
  EMPTY_MODEL_PROFILE_QUICK_CONFIG,
  isModelProfileQuickConfigDirty,
  normalizeModelProfileQuickConfig,
  type ModelProfileQuickConfig,
} from "../../utils/modelProfileQuickConfig";

interface Props {
  sourceValue: ModelProfileQuickConfig;
  onApply: (value: ModelProfileQuickConfig) => boolean;
  /** 模型输入框占位文本；OpenCode 用 `provider/model`，其余默认 `model id`。 */
  modelPlaceholder?: string;
}

export function ModelProfileQuickConfigFields({ sourceValue, onApply, modelPlaceholder }: Props) {
  const [draft, setDraft] = useState(sourceValue);
  const [dirty, setDirty] = useState(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    if (!dirty) {
      setDraft(sourceValue);
    }
  }, [dirty, sourceValue]);

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
          <label className="app-claude-model-topbar-panel__label">模型</label>
          <Input
            size="small"
            value={draft.model}
            onChange={(e) => updateField("model", e.target.value)}
            onBlur={handleFieldBlur}
            onKeyDown={handleEnter}
            placeholder={modelPlaceholder ?? "model id"}
            maxLength={120}
          />
        </div>
      </div>
    </section>
  );
}

export { EMPTY_MODEL_PROFILE_QUICK_CONFIG };

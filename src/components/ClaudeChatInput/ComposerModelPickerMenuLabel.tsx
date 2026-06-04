import type { ModelProfileDropdownParts } from "../../utils/modelProfileDisplay";

type ComposerModelPickerMenuLabelProps = ModelProfileDropdownParts & {
  /** 悬停提示用完整文案 */
  title?: string;
};

export function ComposerModelPickerMenuLabel({
  company,
  modelName,
  title,
}: ComposerModelPickerMenuLabelProps) {
  const fullTitle = title ?? (company ? `${company} ${modelName}` : modelName);

  if (!company) {
    return (
      <span
        className="app-composer-model-picker-menu-label app-composer-model-picker-menu-label--solo"
        title={fullTitle}
      >
        {modelName}
      </span>
    );
  }

  return (
    <span className="app-composer-model-picker-menu-label" title={fullTitle}>
      <span className="app-composer-model-picker-menu-label__company">{company}</span>
      <span className="app-composer-model-picker-menu-label__model">{modelName}</span>
    </span>
  );
}

/** 无档案时的扁平文案：首段作公司、其余作模型名。 */
/** Composer 底栏触发器：单行公司 + 模型名（与下拉分层样式一致）。 */
export function ComposerModelPickerBarLabel({
  company,
  modelName,
  title,
}: ComposerModelPickerMenuLabelProps) {
  const fullTitle = title ?? (company ? `${company} ${modelName}` : modelName);

  if (!company) {
    return (
      <span className="app-composer-model-picker-bar-label" title={fullTitle}>
        <span className="app-composer-model-picker-bar-label__model">{modelName}</span>
      </span>
    );
  }

  return (
    <span className="app-composer-model-picker-bar-label" title={fullTitle}>
      <span className="app-composer-model-picker-bar-label__company">{company}</span>
      <span className="app-composer-model-picker-bar-label__model">{modelName}</span>
    </span>
  );
}

export function splitFlatModelDropdownLabel(label: string): ModelProfileDropdownParts {
  const trimmed = label.trim();
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx <= 0) {
    return { company: "", modelName: trimmed };
  }
  return {
    company: trimmed.slice(0, spaceIdx),
    modelName: trimmed.slice(spaceIdx + 1).trim(),
  };
}

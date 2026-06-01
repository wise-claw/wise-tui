/** 模型配置档案「公司 / 名称」字段：允许数字、点、横线及中英文等展示字符。 */

export const MODEL_PROFILE_LABEL_MAX_LENGTH = 80;

/** 输入时剔除控制字符与路径分隔符，保留数字、`.`、`-`、`_` 等。 */
export function normalizeModelProfileLabelInput(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f\\/<>|]/g, "");
}

export function validateModelProfileLabel(
  value: string,
  options: { field: string; required?: boolean },
): string | null {
  const trimmed = value.trim();
  if (options.required && !trimmed) {
    return `请输入${options.field}`;
  }
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > MODEL_PROFILE_LABEL_MAX_LENGTH) {
    return `${options.field}不能超过 ${MODEL_PROFILE_LABEL_MAX_LENGTH} 个字符`;
  }
  if (/[\u0000-\u001f\u007f\\/<>|]/.test(value)) {
    return `${options.field}不能包含 / \\ < > | 或不可见控制字符`;
  }
  return null;
}

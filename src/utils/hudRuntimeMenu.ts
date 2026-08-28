import type { SessionExecutionEngine } from "../constants/sessionExecutionEngine";

export const HUD_MODEL_MENU_PREFIX = "hud-model:";
export const HUD_RUNTIME_MODEL_LIMIT = 24;

export interface HudRuntimeModelOption {
  value: string;
  label: string;
}

export function hudModelMenuKey(modelId: string): string {
  return `${HUD_MODEL_MENU_PREFIX}${modelId}`;
}

export function parseHudModelMenuKey(key: string): string | null {
  if (!key.startsWith(HUD_MODEL_MENU_PREFIX)) return null;
  const id = key.slice(HUD_MODEL_MENU_PREFIX.length).trim();
  return id || null;
}

/** 保留当前模型，其余按原顺序截到上限。 */
export function capHudRuntimeModelOptions(
  options: readonly HudRuntimeModelOption[],
  currentModel: string,
  limit = HUD_RUNTIME_MODEL_LIMIT,
): HudRuntimeModelOption[] {
  const max = Math.max(1, Math.floor(limit));
  const current = currentModel.trim();
  const seen = new Set<string>();
  const out: HudRuntimeModelOption[] = [];
  const push = (item: HudRuntimeModelOption) => {
    const value = item.value.trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    out.push({ value, label: item.label.trim() || value });
  };
  if (current) {
    const match = options.find((item) => item.value.trim() === current);
    push(match ?? { value: current, label: current });
  }
  for (const item of options) {
    if (out.length >= max) break;
    push(item);
  }
  return out;
}

export function hudRuntimeBusyBlocksEngineSwitch(
  engine: SessionExecutionEngine,
  nextEngine: SessionExecutionEngine,
  busy: boolean,
): boolean {
  return busy && engine !== nextEngine;
}

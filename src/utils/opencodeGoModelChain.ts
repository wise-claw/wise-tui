/** 默认模型 + 备用模型去重后的切换列表（主模型在前）。 */
export function buildOpencodeGoModelChain(
  defaultModel: string,
  fallbackModels: readonly string[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [defaultModel, ...fallbackModels]) {
    const id = raw.trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function parseOpencodeGoFallbackDraft(fallbackDraft: string): string[] {
  return normalizeFallbackModels(
    fallbackDraft.split(",").map((s) => s.trim()).filter(Boolean),
  );
}

/** 备用模型列表去重、去空。 */
export function normalizeFallbackModels(models: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of models) {
    const id = raw.trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function fallbackModelsEqual(
  a: readonly string[],
  b: readonly string[] | undefined,
): boolean {
  return (
    JSON.stringify(normalizeFallbackModels(a)) ===
    JSON.stringify(normalizeFallbackModels(b ?? []))
  );
}

/** 默认模型下拉：已配置链 + 预设，去重保序。 */
export function buildOpencodeGoModelSelectOptions(
  chain: readonly string[],
  presets: readonly string[],
): { value: string; label: string }[] {
  const seen = new Set<string>();
  const out: { value: string; label: string }[] = [];
  for (const raw of [...chain, ...presets]) {
    const id = raw.trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push({ value: id, label: id });
  }
  return out;
}

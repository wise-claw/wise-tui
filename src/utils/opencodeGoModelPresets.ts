/** OpenCode Go 常见上游模型（与 oc-go-cc / routing 对齐）。 */
export const OPENCODE_GO_PROVIDER_PRESETS = [
  "kimi-k2.6",
  "qwen3.7-plus",
  "qwen3.7-max",
  "minimax-m3",
  "minimax-m2.5",
  "mimo-v2.5-pro",
  "glm-5.1",
  "glm-5",
  "qwen3.5-plus",
] as const;

/** OpenCode Zen 常见上游模型。 */
export const OPENCODE_ZEN_PROVIDER_PRESETS = [
  "claude-sonnet-4-8",
  "claude-opus-4-8",
  "gemini-3.5-flash",
  "gemini-3.1-pro",
  "gemini-3-flash",
  "gpt-5.4",
  "gpt-5.3-codex",
  "gpt-5.2",
] as const;

export function resolveOpencodeGoModelPresets(provider: string): readonly string[] {
  return provider === "opencode-zen"
    ? OPENCODE_ZEN_PROVIDER_PRESETS
    : OPENCODE_GO_PROVIDER_PRESETS;
}

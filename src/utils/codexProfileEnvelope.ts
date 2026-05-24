export interface CodexProfileDraft {
  authJson: string;
  configToml: string;
}

export const EMPTY_CODEX_AUTH_JSON = "{\n}\n";
export const EMPTY_CODEX_CONFIG_TOML = "";

export function parseCodexProfileEnvelopeJson(raw: string): CodexProfileDraft {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { authJson: EMPTY_CODEX_AUTH_JSON, configToml: EMPTY_CODEX_CONFIG_TOML };
  }
  const parsed = JSON.parse(trimmed) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Codex 配置顶层必须是对象");
  }
  const obj = parsed as Record<string, unknown>;
  const auth = obj.auth ?? {};
  const config = typeof obj.config === "string" ? obj.config : "";
  return {
    authJson: `${JSON.stringify(auth, null, 2)}\n`,
    configToml: config,
  };
}

export function serializeCodexProfileEnvelope(draft: CodexProfileDraft): string {
  const authTrimmed = draft.authJson.trim();
  const auth = authTrimmed ? (JSON.parse(authTrimmed) as unknown) : {};
  if (auth === null || typeof auth !== "object" || Array.isArray(auth)) {
    throw new Error("auth 必须是 JSON 对象");
  }
  const envelope = {
    auth,
    config: draft.configToml,
  };
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

export function validateCodexProfileDraft(draft: CodexProfileDraft): string | null {
  const authTrimmed = draft.authJson.trim();
  if (!authTrimmed) return "auth.json 不能为空";
  try {
    const auth = JSON.parse(authTrimmed) as unknown;
    if (auth === null || typeof auth !== "object" || Array.isArray(auth)) {
      return "auth 必须是 JSON 对象";
    }
  } catch (e) {
    return e instanceof Error ? `auth JSON 解析失败：${e.message}` : "auth JSON 解析失败";
  }
  return null;
}

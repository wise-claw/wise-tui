import type { RequirementsIndex, RequirementsIndexEntry } from "../types/requirementsIndex";
import { REQUIREMENTS_INDEX_SCHEMA_VERSION } from "../types/requirementsIndex";

const ID_RE = /^req-(functional|nonfunctional|acceptance)-[0-9]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 校验任意 JSON 是否符合 requirements-index schema（与 `.task/requirements-index.schema.json` 对齐）。
 * 用于落盘前自检与导入审计。
 */
export function parseRequirementsIndex(value: unknown):
  | { ok: true; index: RequirementsIndex }
  | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["根节点须为 JSON 对象"] };
  }
  const allowedRoot = new Set(["version", "runId", "requirements"]);
  for (const k of Object.keys(value)) {
    if (!allowedRoot.has(k)) errors.push(`不允许的根字段：${k}`);
  }
  if (value.version !== REQUIREMENTS_INDEX_SCHEMA_VERSION) {
    errors.push(`version 须为 ${REQUIREMENTS_INDEX_SCHEMA_VERSION}`);
  }
  if (value.runId !== undefined && (typeof value.runId !== "string" || !value.runId.trim())) {
    errors.push("runId 若存在须为非空字符串");
  }
  if (!Array.isArray(value.requirements)) {
    errors.push("requirements 须为数组");
    return { ok: false, errors };
  }
  const seen = new Set<string>();
  for (let i = 0; i < value.requirements.length; i++) {
    const item = value.requirements[i];
    const prefix = `requirements[${i}]`;
    if (!isRecord(item)) {
      errors.push(`${prefix} 须为对象`);
      continue;
    }
    for (const k of Object.keys(item)) {
      if (!["id", "content", "start", "end"].includes(k)) {
        errors.push(`${prefix} 不允许的字段：${k}`);
      }
    }
    if (typeof item.id !== "string" || !item.id.trim()) {
      errors.push(`${prefix}.id 须为非空字符串`);
    } else if (!ID_RE.test(item.id.trim())) {
      errors.push(`${prefix}.id 格式须匹配 req-{functional|nonfunctional|acceptance}-<正整数>`);
    } else if (seen.has(item.id.trim())) {
      errors.push(`重复的 requirement id：${item.id.trim()}`);
    } else {
      seen.add(item.id.trim());
    }
    if (typeof item.content !== "string") {
      errors.push(`${prefix}.content 须为字符串`);
    }
    if (typeof item.start !== "number" || !Number.isFinite(item.start) || item.start < 0) {
      errors.push(`${prefix}.start 须为 >= 0 的数字`);
    }
    if (typeof item.end !== "number" || !Number.isFinite(item.end) || item.end < 0) {
      errors.push(`${prefix}.end 须为 >= 0 的数字`);
    }
    if (typeof item.start === "number" && typeof item.end === "number" && item.end <= item.start) {
      errors.push(`${prefix}.end 须大于 start`);
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  const requirements: RequirementsIndexEntry[] = (value.requirements as unknown[]).map((raw) => {
    const o = raw as Record<string, unknown>;
    return {
      id: String(o.id).trim(),
      content: typeof o.content === "string" ? o.content : "",
      start: typeof o.start === "number" && Number.isFinite(o.start) ? Math.floor(o.start) : 0,
      end: typeof o.end === "number" && Number.isFinite(o.end) ? Math.floor(o.end) : 0,
    };
  });
  const index: RequirementsIndex = {
    version: REQUIREMENTS_INDEX_SCHEMA_VERSION,
    requirements,
  };
  if (typeof value.runId === "string" && value.runId.trim()) {
    index.runId = value.runId.trim();
  }
  return { ok: true, index };
}

export function parseRequirementsIndexJsonString(json: string):
  | { ok: true; index: RequirementsIndex }
  | { ok: false; errors: string[] } {
  try {
    return parseRequirementsIndex(JSON.parse(json) as unknown);
  } catch {
    return { ok: false, errors: ["JSON 解析失败"] };
  }
}

import type { ToolUseLocation, ToolUsePart } from "../types";
import { classifyToolActivity } from "./toolGroupActivitySummary";

export type SubagentCardKind = "explorer" | "subagent";

export interface SubagentFileActivityRow {
  label: string;
  path?: string;
}

export interface SubagentCardModel {
  kind: SubagentCardKind;
  title: string;
  subtitle: string;
  modelLabel: string;
  waiting: boolean;
  status: ToolUsePart["status"];
  locations: ToolUseLocation[];
  fileRows: SubagentFileActivityRow[];
}

function readInputString(input: ToolUsePart["input"], keys: string[]): string {
  if (!input || typeof input !== "object") return "";
  const record = input as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function basenamePath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() || normalized;
}

function formatLocationRow(loc: ToolUseLocation): SubagentFileActivityRow {
  const base = basenamePath(loc.path);
  if (loc.line != null && loc.endLine != null && loc.endLine !== loc.line) {
    return { label: `Read ${base} L${loc.line}-${loc.endLine}`, path: loc.path };
  }
  if (loc.line != null) {
    return { label: `Read ${base} L${loc.line}`, path: loc.path };
  }
  return { label: `Read ${base}`, path: loc.path };
}

/** Weak parse of "Read path L1-239" / "Read path" lines from tool output. */
export function parseReadActivityLinesFromText(text: string): SubagentFileActivityRow[] {
  const rows: SubagentFileActivityRow[] = [];
  const re =
    /(?:^|\n)\s*(?:Read|读取)\s+([^\s\n]+?)(?:\s+L(\d+)(?:-(\d+))?)?(?=\s*(?:\n|$))/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const path = match[1]?.trim() ?? "";
    if (!path) continue;
    const start = match[2] ? Number.parseInt(match[2], 10) : undefined;
    const end = match[3] ? Number.parseInt(match[3], 10) : undefined;
    rows.push(
      formatLocationRow({
        path,
        ...(Number.isFinite(start) ? { line: start } : {}),
        ...(Number.isFinite(end) ? { endLine: end } : {}),
      }),
    );
  }
  return rows;
}

/**
 * Task/Agent 子代理工具（不含后台 bash 等「会话任务」宽判定）。
 * 用于消息列表专用卡片，避免把 run_in_background shell 渲成子代理卡。
 */
export function isSubagentToolPart(part: ToolUsePart): boolean {
  const name = part.name.trim().toLowerCase();
  if (
    name === "task" ||
    name === "agent" ||
    name.includes("subagent") ||
    name === "spawn_agent" ||
    name === "run_subagent"
  ) {
    return true;
  }

  const subagentType = readInputString(part.input, [
    "subagent_type",
    "subagentType",
    "agent_type",
  ]);
  if (subagentType) return true;

  const description = readInputString(part.input, ["description", "title", "summary"]);
  const prompt = readInputString(part.input, ["prompt", "instructions"]);
  if (/子\s*代理|subagent/i.test(description) || /子\s*代理|subagent/i.test(prompt)) {
    return true;
  }
  if (/\bexplorer\b/i.test(description) && prompt) return true;
  return false;
}

export function isExplorerSubagentPart(part: ToolUsePart): boolean {
  if (!isSubagentToolPart(part)) return false;
  const subagentType = readInputString(part.input, [
    "subagent_type",
    "subagentType",
    "agent_type",
    "type",
  ]).toLowerCase();
  if (subagentType === "explore") return true;

  const title = readInputString(part.input, ["title", "description", "summary"]);
  if (/\bexplorer\b/i.test(title)) return true;
  return false;
}

/** Whether a tool should nest under an Explorer card as child progress. */
export function isExplorerNestableToolPart(part: ToolUsePart): boolean {
  if (isSubagentToolPart(part)) return false;
  return classifyToolActivity(part) === "explore";
}

function formatChildToolRow(part: ToolUsePart): SubagentFileActivityRow {
  const name = part.name.trim() || "Tool";
  const path =
    readInputString(part.input, ["file_path", "path", "target_file", "target_directory"]) ||
    "";
  const base = path ? basenamePath(path) : "";
  const record = (part.input ?? {}) as Record<string, unknown>;
  const offsetRaw = record.offset ?? record.offset_line;
  const limitRaw = record.limit ?? record.limit_lines;
  const offset =
    typeof offsetRaw === "number" && Number.isFinite(offsetRaw)
      ? Math.trunc(offsetRaw)
      : typeof offsetRaw === "string" && /^\d+$/.test(offsetRaw.trim())
        ? Number.parseInt(offsetRaw.trim(), 10)
        : undefined;
  const limit =
    typeof limitRaw === "number" && Number.isFinite(limitRaw)
      ? Math.trunc(limitRaw)
      : typeof limitRaw === "string" && /^\d+$/.test(limitRaw.trim())
        ? Number.parseInt(limitRaw.trim(), 10)
        : undefined;

  if (base && offset != null && limit != null && limit > 0) {
    const end = offset + Math.max(limit - 1, 0);
    return { label: `${name} ${base} L${offset}-${end}`, path };
  }
  if (base && offset != null) {
    return { label: `${name} ${base} L${offset}`, path };
  }
  if (base) {
    return { label: `${name} ${base}`, path };
  }
  const subtitle = readInputString(part.input, ["pattern", "query", "glob_pattern", "description"]);
  return { label: subtitle ? `${name} ${subtitle}` : name, path: path || undefined };
}

export function buildSubagentCardModel(
  part: ToolUsePart,
  childParts: readonly ToolUsePart[] = [],
): SubagentCardModel {
  const kind: SubagentCardKind = isExplorerSubagentPart(part) ? "explorer" : "subagent";
  const description = readInputString(part.input, ["description", "title", "summary"]);
  const prompt = readInputString(part.input, ["prompt", "instructions"]);
  const modelLabel = readInputString(part.input, ["model"]);
  const subagentType = readInputString(part.input, [
    "subagent_type",
    "subagentType",
    "agent_type",
  ]);

  let title = description || (prompt ? prompt.slice(0, 72) : "") || part.name.trim() || "子代理";
  if (kind === "explorer" && !/\bexplorer\b/i.test(title)) {
    title = `${title} Explorer`.trim();
  }
  if (kind === "subagent" && modelLabel && !title.includes(modelLabel)) {
    title = `${title} ${modelLabel}`.trim();
  }

  const waiting = part.status === "pending" || part.status === "running";
  const outputFirstLine = (part.output ?? "")
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean) ?? "";

  let subtitle = "";
  if (waiting) {
    subtitle =
      outputFirstLine.slice(0, 120)
      || (kind === "explorer" ? "正在探索…" : prompt.slice(0, 120) || "运行中…");
  } else if (part.status === "error") {
    subtitle = (part.error?.trim() || outputFirstLine || "失败").slice(0, 120);
  } else {
    subtitle = outputFirstLine.slice(0, 120) || (subagentType ? `[${subagentType}]` : "已完成");
  }

  const locations = Array.isArray(part.locations) ? [...part.locations] : [];
  const fileRows: SubagentFileActivityRow[] = [];
  if (childParts.length > 0) {
    for (const child of childParts) {
      fileRows.push(formatChildToolRow(child));
    }
  } else if (locations.length > 0) {
    for (const loc of locations) {
      fileRows.push(formatLocationRow(loc));
    }
  } else if (part.output?.trim()) {
    fileRows.push(...parseReadActivityLinesFromText(part.output));
  }

  return {
    kind,
    title,
    subtitle,
    modelLabel,
    waiting,
    status: part.status,
    locations,
    fileRows,
  };
}

import type { PrdDocument } from "../types";
import type { RequirementsIndex, RequirementsIndexEntry } from "../types/requirementsIndex";
import { REQUIREMENTS_INDEX_SCHEMA_VERSION } from "../types/requirementsIndex";
import { prdDocumentToSplitMarkdown } from "./prdDocumentMarkdown";

/** 与任务拆分面板中的需求条目 id 规则一致。 */
export type PrdRequirementSectionKind = "functional" | "nonFunctional" | "acceptance";

export interface PrdRequirementIndexEntry {
  id: string;
  kind: PrdRequirementSectionKind;
  label: string;
  content: string;
  start: number;
  end: number;
}

interface RequirementDraft {
  kind: PrdRequirementSectionKind;
  content: string;
  anchorText: string;
}

const TABLE_CELL_TEXT_MAX_CHARS = 240;
const TABLE_CELL_SEGMENT_MAX = 8;
const TABLE_CELL_TOTAL_MAX_CHARS = 1200;

function splitTableRowCells(line: string): string[] {
  const trimmed = line.trim();
  const normalized = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
  const normalizedTail = normalized.endsWith("|") ? normalized.slice(0, -1) : normalized;
  return normalizedTail.split("|").map((cell) => cell.trim());
}

function collapseWs(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeTableCellValue(raw: string): string {
  const stripped = raw
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[*_~>#]+/g, " ");
  const collapsed = collapseWs(stripped);
  if (!collapsed) return "";
  if (collapsed.length <= TABLE_CELL_TEXT_MAX_CHARS) return collapsed;
  return `${collapsed.slice(0, TABLE_CELL_TEXT_MAX_CHARS)}…`;
}

function extractTableCellSegments(raw: string): string[] {
  const plain = raw
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "\n$1\n")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "\n$1\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|div|tr|td|th|h[1-6])>/gi, "\n")
    .replace(/<(p|li|div|tr|td|th|h[1-6])[^>]*>/gi, "\n")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[*_~>#]+/g, " ");
  const roughSegments = plain.split(/\n+|；|;/g);
  const out: string[] = [];
  for (const seg of roughSegments) {
    const normalized = normalizeTableCellValue(seg);
    if (!normalized) continue;
    if (!out.includes(normalized)) out.push(normalized);
    if (out.length >= TABLE_CELL_SEGMENT_MAX) break;
  }
  return out;
}

function isTableSeparatorLine(line: string): boolean {
  const cells = splitTableRowCells(line);
  if (cells.length === 0) return false;
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function parseMarkdownTable(block: string): { headers: string[]; rows: Array<{ cells: string[]; rawLine: string }> } | null {
  const lines = block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < 2) return null;
  if (!lines.every((line) => line.includes("|"))) return null;
  const headerLine = lines[0]!;
  const separatorLine = lines[1]!;
  if (!isTableSeparatorLine(separatorLine)) return null;
  const headers = splitTableRowCells(headerLine);
  if (headers.length === 0) return null;
  const rows = lines
    .slice(2)
    .map((line) => ({ rawLine: line, cells: splitTableRowCells(line) }))
    .filter((row) => row.cells.some((cell) => cell.length > 0));
  if (rows.length === 0) return null;
  return { headers, rows };
}

function renderTableCellSemanticContent(
  headers: string[],
  row: { cells: string[]; rawLine: string },
  colIndex: number,
): RequirementDraft {
  const normalizedHeaders = headers.map((header, idx) => header || `列${idx + 1}`);
  const header = normalizedHeaders[colIndex] ?? `列${colIndex + 1}`;
  const rawCell = row.cells[colIndex] ?? "";
  const segments = extractTableCellSegments(rawCell);
  if (segments.length === 0) {
    const one = normalizeTableCellValue(rawCell);
    if (one) segments.push(one);
  }
  const lines = segments.length > 0
    ? segments.map((segment) => `${header}: ${segment}`)
    : [`${header}: ${collapseWs(rawCell)}`];
  const joined = lines.join("\n");
  const content = joined.length > TABLE_CELL_TOTAL_MAX_CHARS
    ? `${joined.slice(0, TABLE_CELL_TOTAL_MAX_CHARS)}…`
    : joined;
  const firstNonEmptyCell = segments[0] ?? normalizeTableCellValue(rawCell);
  return {
    kind: "functional",
    content,
    anchorText: firstNonEmptyCell || row.rawLine,
  };
}

function expandSectionContents(contents: string[], kind: PrdRequirementSectionKind): RequirementDraft[] {
  const out: RequirementDraft[] = [];
  for (const content of contents) {
    const table = parseMarkdownTable(content);
    if (!table) {
      out.push({ kind, content, anchorText: content });
      continue;
    }
    table.rows.forEach((row) => {
      row.cells.forEach((cell, colIndex) => {
        if (!cell.trim()) return;
        out.push({ ...renderTableCellSemanticContent(table.headers, row, colIndex), kind });
      });
    });
  }
  return out;
}

export function listPrdRequirementIndexEntries(source: PrdDocument): PrdRequirementIndexEntry[] {
  const drafts: RequirementDraft[] = [
    ...expandSectionContents(source.functional, "functional"),
    ...expandSectionContents(source.nonFunctional, "nonFunctional"),
    ...expandSectionContents(source.acceptance, "acceptance"),
  ];
  const markdown = prdDocumentToSplitMarkdown(source);
  const counters = { functional: 0, nonfunctional: 0, acceptance: 0 };
  let cursor = 0;
  return drafts.map((draft) => {
    const key = draft.kind === "nonFunctional" ? "nonfunctional" : draft.kind;
    counters[key] += 1;
    const id = `req-${key}-${counters[key]}`;
    const probe = draft.anchorText.trim() || draft.content.trim();
    const startAtCursor = probe ? markdown.indexOf(probe, cursor) : -1;
    const startGlobal = startAtCursor >= 0 ? startAtCursor : (probe ? markdown.indexOf(probe) : -1);
    const fallbackStart = Math.min(cursor, Math.max(0, markdown.length - 1));
    const start = startGlobal >= 0 ? startGlobal : fallbackStart;
    const fallbackLen = Math.max(1, probe.length);
    const end = startGlobal >= 0 ? start + Math.max(1, probe.length) : start + fallbackLen;
    if (end > cursor) cursor = end;
    const labelPrefix = draft.kind === "functional" ? "功能需求" : draft.kind === "nonFunctional" ? "非功能需求" : "验收标准";
    return {
      id,
      kind: draft.kind,
      label: `${labelPrefix} ${counters[key]}`,
      content: draft.content,
      start,
      end,
    };
  });
}

/** 生成符合 `requirements-index.schema.json` 的对象（spec §4 I1）。 */
export function buildRequirementsIndex(source: PrdDocument): RequirementsIndex {
  const requirements: RequirementsIndexEntry[] = listPrdRequirementIndexEntries(source).map((e) => ({
    id: e.id,
    content: e.content,
    start: e.start,
    end: e.end,
  }));
  return { version: REQUIREMENTS_INDEX_SCHEMA_VERSION, requirements };
}

/** 供本地规则引擎遍历，顺序与 `listPrdRequirementIndexEntries` 一致。 */
export function iterPrdRequirementSplitItems(prd: PrdDocument): {
  text: string;
  source: PrdRequirementSectionKind;
  requirementId: string;
}[] {
  return listPrdRequirementIndexEntries(prd).map((entry) => ({
    text: entry.content,
    source: entry.kind,
    requirementId: entry.id,
  }));
}

export function buildRequirementsIndexJsonForSnapshot(source: PrdDocument): string {
  return JSON.stringify(buildRequirementsIndex(source), null, 2);
}

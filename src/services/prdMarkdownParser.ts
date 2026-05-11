import type { ParsedPrdSections } from "../types";

const SECTION_KEYWORDS: Record<keyof ParsedPrdSections, string[]> = {
  background: ["背景", "背景与目标", "背景说明", "背景信息"],
  goals: ["目标", "目标与指标", "成功指标", "业务目标"],
  scenarios: ["场景", "用户场景", "使用场景", "用户流程"],
  functional: ["功能", "功能需求", "需求明细", "需求列表"],
  nonFunctional: ["非功能", "非功能需求", "性能", "安全", "稳定性"],
  acceptance: ["验收", "验收标准", "完成标准", "dod"],
};

const EMPTY_SECTIONS: ParsedPrdSections = {
  background: [],
  goals: [],
  scenarios: [],
  functional: [],
  nonFunctional: [],
  acceptance: [],
};

function matchSectionKey(title: string): keyof ParsedPrdSections | null {
  const normalized = title.trim().toLowerCase();
  for (const [key, aliases] of Object.entries(SECTION_KEYWORDS) as [keyof ParsedPrdSections, string[]][]) {
    if (aliases.some((alias) => normalized.includes(alias.toLowerCase()))) {
      return key;
    }
  }
  return null;
}

function isTableLikeLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  // markdown table row or divider row
  if (t.startsWith("|") && t.endsWith("|")) return true;
  if (/^\|?[\s:-]+\|[\s|:-]+$/.test(t)) return true;
  return false;
}

function isListLikeLine(line: string): boolean {
  return /^\s*(?:[-*+]\s+|\d+\.\s+)/.test(line);
}

function isHeadingLine(line: string): boolean {
  return /^\s{0,3}#{1,6}\s+.+\s*$/.test(line);
}

function normalizeBlock(blockLines: string[]): string {
  const raw = blockLines.join("\n").trim();
  if (!raw) return "";
  // 保留多行结构（表格/列表/代码块），仅压缩过度空行，避免按行切碎需求语义。
  return raw.replace(/\n{3,}/g, "\n\n").trim();
}

function splitMarkdownIntoSemanticBlocks(raw: string): string[] {
  const lines = raw.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let inCodeFence = false;
  let mode: "paragraph" | "table" | "list" | "code" = "paragraph";

  const flush = () => {
    const normalized = normalizeBlock(current);
    if (normalized) blocks.push(normalized);
    current = [];
    mode = "paragraph";
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (/^\s*```/.test(line)) {
      if (!inCodeFence) {
        flush();
        inCodeFence = true;
        mode = "code";
        current.push(line);
      } else {
        current.push(line);
        flush();
        inCodeFence = false;
      }
      continue;
    }

    if (inCodeFence) {
      current.push(line);
      continue;
    }

    if (!trimmed) {
      flush();
      continue;
    }

    if (isHeadingLine(line)) {
      flush();
      blocks.push(trimmed);
      continue;
    }

    const tableLike = isTableLikeLine(line);
    const listLike = isListLikeLine(line);
    if (mode === "table" && !tableLike) {
      flush();
    } else if (mode === "list" && !listLike && !/^\s{2,}\S/.test(line)) {
      flush();
    }

    if (tableLike) {
      if (mode !== "table") flush();
      mode = "table";
      current.push(line);
      continue;
    }

    if (listLike || (mode === "list" && /^\s{2,}\S/.test(line))) {
      if (mode !== "list") flush();
      mode = "list";
      current.push(line);
      continue;
    }

    if (mode !== "paragraph") flush();
    mode = "paragraph";
    current.push(line);
  }

  flush();
  return blocks;
}

export function parsePrdMarkdown(raw: string): ParsedPrdSections {
  if (!raw.trim()) return { ...EMPTY_SECTIONS };

  const output: ParsedPrdSections = {
    background: [],
    goals: [],
    scenarios: [],
    functional: [],
    nonFunctional: [],
    acceptance: [],
  };

  let currentSection: keyof ParsedPrdSections | null = null;
  const blocks = splitMarkdownIntoSemanticBlocks(raw);

  for (const block of blocks) {
    const headingMatch = block.match(/^\s{0,3}#{1,6}\s+(.+)\s*$/);
    if (headingMatch) {
      currentSection = matchSectionKey(headingMatch[1]);
      continue;
    }

    const content = normalizeBlock([block]);
    if (!content) continue;

    if (currentSection) {
      output[currentSection].push(content);
    } else {
      output.functional.push(content);
    }
  }

  return output;
}

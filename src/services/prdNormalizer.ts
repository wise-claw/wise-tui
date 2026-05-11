import type { ParsedPrdSections, PrdDocument, PrdInputMeta } from "../types";
import { parsePrdMarkdown } from "./prdMarkdownParser";

function dedupe(list: string[]): string[] {
  return Array.from(new Set(list.map((item) => item.trim()).filter(Boolean)));
}

function ensureSections(sections: ParsedPrdSections): ParsedPrdSections {
  return {
    background: dedupe(sections.background),
    goals: dedupe(sections.goals),
    scenarios: dedupe(sections.scenarios),
    functional: dedupe(sections.functional),
    nonFunctional: dedupe(sections.nonFunctional),
    acceptance: dedupe(sections.acceptance),
  };
}

export function normalizePrdDocument(input: PrdInputMeta, fetchedContent?: string): PrdDocument {
  const rawContent = input.sourceType === "url" ? fetchedContent ?? "" : input.rawText;
  const parsed = parsePrdMarkdown(rawContent);
  const sections = ensureSections(parsed);

  return {
    title: sections.goals[0] ?? "未命名 PRD",
    sourceType: input.sourceType,
    sourceRef: input.rawUrl,
    ...sections,
  };
}

/** 将编辑器选中片段作为单一功能需求块参与本地规则拆分（保留 Markdown 与插图语法）。 */
export function prdDocumentFromMarkdownFragment(markdown: string): PrdDocument {
  const trimmed = markdown.trim();
  const heading = trimmed.match(/^\s*#{1,6}\s+(.+)$/m)?.[1]?.trim();
  const title =
    heading && heading.length > 0 ? heading.slice(0, 120) : "选中片段";
  return {
    title,
    sourceType: "markdown",
    sourceRef: null,
    background: [],
    goals: [],
    scenarios: [],
    functional: trimmed ? [trimmed] : [],
    nonFunctional: [],
    acceptance: [],
  };
}

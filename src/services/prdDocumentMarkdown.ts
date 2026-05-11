import type { PrdDocument } from "../types";

/** 将结构化 PRD 转为单一 Markdown 正文，供拆分输入与 `prd.md` 物化。 */
export function prdDocumentToSplitMarkdown(doc: PrdDocument): string {
  const blocks: string[] = [];
  if (doc.title.trim()) {
    blocks.push(`# ${doc.title.trim()}`);
  }
  const src = doc.sourceRef?.trim()
    ? `来源：${doc.sourceType}${doc.sourceRef ? `（${doc.sourceRef}）` : ""}`
    : `来源：${doc.sourceType}`;
  blocks.push(src, "");

  function section(title: string, items: string[]): void {
    if (items.length === 0) return;
    blocks.push(`## ${title}`, "");
    items.forEach((text, i) => {
      blocks.push(`### ${i + 1}`, "", text.trimEnd(), "");
    });
  }

  section("背景", doc.background);
  section("目标", doc.goals);
  section("场景", doc.scenarios);
  section("功能需求", doc.functional);
  section("非功能需求", doc.nonFunctional);
  section("验收标准", doc.acceptance);

  return blocks.join("\n").trimEnd() + "\n";
}

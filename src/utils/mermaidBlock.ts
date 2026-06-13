const MERMAID_FENCE_LANGS = new Set(["mermaid", "flowchart", "graph", "diagram"]);

const MERMAID_DIAGRAM_START_RE =
  /^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie(?:Title)?|gitGraph|mindmap|timeline|sankey(?:-beta)?|block(?:-beta)?|quadrantChart|xychart-(?:beta|v2)|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment|requirementDiagram|architecture-(?:beta|v2))\b/i;

const FLOWCHART_DIRECTION_RE = /^(?:flowchart|graph)\s+(?:TB|TD|BT|RL|LR)\b/i;

const PROGRAMMING_FENCE_LANG_RE =
  /^(?:python|py|javascript|js|typescript|ts|tsx|jsx|ruby|rb|go|golang|rust|rs|java|kotlin|kt|swift|php|c\+\+|cpp|c#|cs|sql|bash|sh|zsh|fish|powershell|ps1|json|yaml|yml|html|css|scss|less|dockerfile|makefile|lua|r|scala|perl|vue|svelte)\b/i;

/** 围栏 info 字符串是否应视为 Mermaid 图表语言。 */
export function isMermaidFenceLanguage(lang: string): boolean {
  const trimmed = lang.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  if (MERMAID_FENCE_LANGS.has(lower)) return true;
  // 模型常把方向写进 info，如 ```flowchart TB
  if (/^(?:flowchart|graph)\b/i.test(trimmed)) return true;
  return false;
}

function isProgrammingFenceLanguage(lang: string): boolean {
  const trimmed = lang.trim();
  if (!trimmed) return false;
  return PROGRAMMING_FENCE_LANG_RE.test(trimmed);
}

/** 文本首行是否像 Mermaid 图表声明。 */
export function looksLikeMermaidSource(text: string): boolean {
  const firstLine = text.trim().split("\n")[0]?.trim() ?? "";
  return MERMAID_DIAGRAM_START_RE.test(firstLine);
}

function hasMermaidDiagramBody(text: string): boolean {
  const body = text.trim();
  if (!body) return false;
  const firstLine = body.split("\n")[0]?.trim() ?? "";
  if (FLOWCHART_DIRECTION_RE.test(firstLine)) return true;
  if (/^(?:flowchart|graph)\b/i.test(firstLine)) return true;
  if (body.includes("subgraph") || /-->|==>|---/.test(body)) return true;
  return body.split("\n").length >= 2;
}

function isMermaidBlockContinuationLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith("%%")) return true;
  if (/^(?:subgraph|end|classDef|class|style|linkStyle|click|direction)\b/i.test(trimmed)) {
    return true;
  }
  if (/^(?:#+\s|[-*+]\s|\d+\.\s)/.test(trimmed)) return false;
  if (/-->|<--|---|==>|:::/.test(trimmed)) return true;
  if (/[\[\(\{]/.test(trimmed)) return true;
  if (/^\s/.test(line)) return true;
  return false;
}

/** 围栏 code block 是否应渲染为 Mermaid 图表。 */
export function shouldRenderFencedBlockAsMermaid(codeText: string, lang: string): boolean {
  const body = codeText.trim();
  if (!body || !looksLikeMermaidSource(body)) return false;
  if (isProgrammingFenceLanguage(lang)) return false;
  if (isMermaidFenceLanguage(lang)) return true;
  return hasMermaidDiagramBody(body);
}

/** 将 Markdown 正文中嵌入的裸 Mermaid 块包成围栏。 */
export function wrapEmbeddedMermaidBlocks(text: string): string {
  if (!text.trim() || text.trim().startsWith("```")) return text;

  const lines = text.split("\n");
  const out: string[] = [];
  let inFence = false;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const trimmedLine = line.trim();

    if (trimmedLine.startsWith("```")) {
      inFence = !inFence;
      out.push(line);
      i += 1;
      continue;
    }

    if (inFence) {
      out.push(line);
      i += 1;
      continue;
    }

    if (looksLikeMermaidSource(trimmedLine)) {
      const blockLines: string[] = [line];
      i += 1;
      while (i < lines.length) {
        const next = lines[i] ?? "";
        if (next.trim().startsWith("```")) break;
        if (!isMermaidBlockContinuationLine(next)) break;
        blockLines.push(next);
        i += 1;
      }
      const blockText = blockLines.join("\n").trimEnd();
      if (shouldRenderFencedBlockAsMermaid(blockText, "mermaid")) {
        out.push("```mermaid", blockText, "```");
      } else {
        out.push(...blockLines);
      }
      continue;
    }

    out.push(line);
    i += 1;
  }

  return out.join("\n");
}

/** 整段或嵌入的裸 Mermaid 源码包成围栏，便于 marked 解析。 */
export function wrapMermaidBlocksInMarkdown(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return text;
  if (trimmed.startsWith("```")) return text;
  if (shouldRenderFencedBlockAsMermaid(trimmed, "mermaid")) {
    return `\`\`\`mermaid\n${trimmed}\n\`\`\``;
  }
  return wrapEmbeddedMermaidBlocks(text);
}

/** @deprecated 使用 {@link wrapMermaidBlocksInMarkdown} */
export function wrapBareMermaidBlock(text: string): string {
  return wrapMermaidBlocksInMarkdown(text);
}

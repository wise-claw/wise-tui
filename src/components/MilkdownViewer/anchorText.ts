/** Collapse prose whitespace without changing semantic text content. */
export function collapseWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function stripMarkdownSyntax(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*[•·▪]\s+/gm, "")
    .replace(/^\s{0,3}(?:[-*+]|\d+\.)\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1");
}

export function normalizeAnchorProbeText(text: string): string {
  return collapseWs(stripMarkdownSyntax(text));
}

/** Try long-to-short candidates so slightly edited editor text can still resolve. */
export function buildNeedleCandidates(searchText: string): string[] {
  const collapsed = normalizeAnchorProbeText(searchText);
  if (collapsed.length < 2) return [];
  const out: string[] = [];
  const push = (s: string) => {
    const t = normalizeAnchorProbeText(s);
    if (t.length >= 2 && !out.includes(t)) out.push(t);
  };
  push(collapsed.length <= 96 ? collapsed : collapsed.slice(0, 96));
  for (const len of [72, 56, 40, 28, 20]) {
    if (collapsed.length > len) push(collapsed.slice(0, len));
  }
  return out;
}

/** Add per-line candidates for multi-line requirements that map to separate Milkdown blocks. */
export function expandNeedleCandidates(searchText: string): string[] {
  const out: string[] = [];
  const pushAll = (arr: string[]) => {
    for (const n of arr) {
      if (n.length >= 2 && !out.includes(n)) out.push(n);
    }
  };
  pushAll(buildNeedleCandidates(searchText));
  const lines = searchText.split(/\r?\n/);
  if (lines.length > 1) {
    for (const line of lines) {
      const t = line.trim();
      if (t.length < 2) continue;
      pushAll(buildNeedleCandidates(t));
    }
  }
  return out;
}

export function textblockHayIncludesNeedle(hayRaw: string, needle: string): boolean {
  const hay = normalizeAnchorProbeText(hayRaw);
  if (hay.includes(needle)) return true;
  const deBullet = hay
    .replace(/^[\u200b\s]+/, "")
    .replace(/^[•·▪]\s*/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+\.\s+/, "");
  return deBullet.includes(needle);
}

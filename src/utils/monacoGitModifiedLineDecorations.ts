import { diffLines, type Change } from "diff";

export type MonacoLineChangeKind = "added" | "modified";

export interface MonacoLineChange {
  lineNumber: number;
  kind: MonacoLineChangeKind;
}

function normalizeNewlines(content: string): string {
  return content.replace(/\r\n/g, "\n");
}

export function classifyLineChanges(base: string, current: string): MonacoLineChange[] {
  const baseNorm = normalizeNewlines(base);
  const currentNorm = normalizeNewlines(current);

  if (baseNorm === currentNorm) return [];

  const parts: Change[] = diffLines(baseNorm, currentNorm);
  const changes: MonacoLineChange[] = [];
  let currentLine = 1;
  let prevRemovedCount = 0;

  for (const part of parts) {
    const count = part.count ?? 1;

    if (!part.added && !part.removed) {
      currentLine += count;
      prevRemovedCount = 0;
    } else if (part.removed && !part.added) {
      prevRemovedCount += count;
    } else if (part.added && !part.removed) {
      limitedReplace: {
        const replacedCount = Math.min(count, prevRemovedCount);
        for (let i = 0; i < replacedCount; i++) {
          changes.push({ lineNumber: currentLine + i, kind: "modified" });
        }
        for (let i = replacedCount; i < count; i++) {
          changes.push({ lineNumber: currentLine + i, kind: "added" });
        }
        prevRemovedCount = 0;
        break limitedReplace;
      }
      currentLine += count;
    } else {
      for (let i = 0; i < count; i++) {
        changes.push({ lineNumber: currentLine + i, kind: "modified" });
      }
      currentLine += count;
      prevRemovedCount = 0;
    }
  }

  return changes;
}

export function computeLineNumbersDifferentFromBase(base: string, current: string): number[] {
  return classifyLineChanges(base, current).map((change) => change.lineNumber);
}

export function monacoLineChangeGutterClassName(kind: MonacoLineChangeKind): string {
  return kind === "added" ? "wise-monaco-edit-added-gutter" : "wise-monaco-edit-modified-gutter";
}

export function monacoLineChangeOverviewColor(kind: MonacoLineChangeKind): string {
  return kind === "added" ? "#3fb950" : "#3794ff";
}

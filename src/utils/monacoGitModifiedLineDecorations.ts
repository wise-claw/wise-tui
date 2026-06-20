export type MonacoLineChangeKind = "added" | "modified";

export interface MonacoLineChange {
  lineNumber: number;
  kind: MonacoLineChangeKind;
}

function normalizeEditorLines(content: string): string[] {
  return content.replace(/\r\n/g, "\n").split("\n");
}

export function classifyLineChanges(base: string, current: string): MonacoLineChange[] {
  const baseLines = normalizeEditorLines(base);
  const currentLines = normalizeEditorLines(current);
  const maxLen = Math.max(baseLines.length, currentLines.length);
  const changes: MonacoLineChange[] = [];
  for (let index = 0; index < maxLen; index += 1) {
    const baseLine = baseLines[index];
    const currentLine = currentLines[index];
    if (baseLine === currentLine) continue;
    if (baseLine === undefined) {
      changes.push({ lineNumber: index + 1, kind: "added" });
      continue;
    }
    changes.push({ lineNumber: index + 1, kind: "modified" });
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

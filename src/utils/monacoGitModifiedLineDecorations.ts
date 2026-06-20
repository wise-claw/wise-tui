export function computeLineNumbersDifferentFromBase(base: string, current: string): number[] {
  const baseLines = base.replace(/\r\n/g, "\n").split("\n");
  const currentLines = current.replace(/\r\n/g, "\n").split("\n");
  const maxLen = Math.max(baseLines.length, currentLines.length);
  const changed: number[] = [];
  for (let index = 0; index < maxLen; index += 1) {
    if ((baseLines[index] ?? "") !== (currentLines[index] ?? "")) {
      changed.push(index + 1);
    }
  }
  return changed;
}

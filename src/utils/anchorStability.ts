import type { TaskAnchorPosition } from "../types";

type AnchorRange = { from: number; to: number };

function sortedRangeEntries<T extends AnchorRange>(
  record: Record<string, T> | undefined,
): Array<[string, T]> {
  return Object.entries(record ?? {}).sort(([k1], [k2]) => k1.localeCompare(k2));
}

export function sameStringArray(a: string[], b: string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function sameTaskAnchorPositions(
  a: Record<string, TaskAnchorPosition> | undefined,
  b: Record<string, TaskAnchorPosition> | undefined,
): boolean {
  const aEntries = sortedRangeEntries(a);
  const bEntries = sortedRangeEntries(b);
  if (aEntries.length !== bEntries.length) return false;
  for (let i = 0; i < aEntries.length; i += 1) {
    const [ak, av] = aEntries[i];
    const [bk, bv] = bEntries[i];
    if (ak !== bk) return false;
    if (av.from !== bv.from || av.to !== bv.to) return false;
  }
  return true;
}

export function sameResolvedAnchorRanges(
  a: Record<string, AnchorRange> | undefined,
  b: Record<string, AnchorRange> | undefined,
): boolean {
  const aEntries = sortedRangeEntries(a);
  const bEntries = sortedRangeEntries(b);
  if (aEntries.length !== bEntries.length) return false;
  for (let i = 0; i < aEntries.length; i += 1) {
    const [ak, av] = aEntries[i];
    const [bk, bv] = bEntries[i];
    if (ak !== bk) return false;
    if (av.from !== bv.from || av.to !== bv.to) return false;
  }
  return true;
}

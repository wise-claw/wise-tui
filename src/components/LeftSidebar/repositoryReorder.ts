export function reorderRepositoryIdsForDrop(
  ordered: readonly number[],
  draggedId: number,
  anchorId: number,
  placement: "before" | "after",
): number[] {
  const next = ordered.filter((id) => id !== draggedId);
  const anchorIdx = next.indexOf(anchorId);
  if (anchorIdx === -1) return [...ordered];
  const insertAt = placement === "before" ? anchorIdx : anchorIdx + 1;
  next.splice(insertAt, 0, draggedId);
  return next;
}

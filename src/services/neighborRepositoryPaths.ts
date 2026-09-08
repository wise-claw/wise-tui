/** 当前仓在列表中的左右邻仓；找不到时返回空。 */
export function neighborRepositoryPaths(
  repositoryPath: string,
  allPaths: readonly string[],
): string[] {
  const path = repositoryPath.trim();
  if (!path) return [];
  const normalized = allPaths.map((item) => item.trim()).filter(Boolean);
  const index = normalized.findIndex((item) => item === path);
  if (index < 0) return [];
  const neighbors: string[] = [];
  const prev = normalized[index - 1];
  const next = normalized[index + 1];
  if (prev && prev !== path) neighbors.push(prev);
  if (next && next !== path) neighbors.push(next);
  return neighbors;
}

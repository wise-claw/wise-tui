import type { RepositoryFileContentMatch } from "../../services/repositoryFiles";

export interface ContentMatchHit {
  line: number;
  preview: string;
  matchStart?: number | null;
  matchEnd?: number | null;
}

export interface ContentFileGroup {
  kind: "content-file";
  path: string;
  hits: ContentMatchHit[];
}

/** 将全文搜索结果按文件路径聚合，保留后端返回的文件首次出现顺序。 */
export function groupContentMatchesByFile(
  matches: readonly RepositoryFileContentMatch[],
): ContentFileGroup[] {
  if (matches.length === 0) return [];

  const hitsByPath = new Map<string, ContentMatchHit[]>();
  const pathOrder: string[] = [];

  for (const match of matches) {
    let hits = hitsByPath.get(match.path);
    if (!hits) {
      hits = [];
      hitsByPath.set(match.path, hits);
      pathOrder.push(match.path);
    }
    hits.push({
      line: match.line,
      preview: match.preview,
      matchStart: match.matchStart ?? null,
      matchEnd: match.matchEnd ?? null,
    });
  }

  return pathOrder.map((path) => {
    const hits = hitsByPath.get(path) ?? [];
    hits.sort((a, b) => a.line - b.line);
    return { kind: "content-file", path, hits };
  });
}

export function countContentFileGroupHits(groups: readonly ContentFileGroup[]): number {
  let total = 0;
  for (const group of groups) {
    total += group.hits.length;
  }
  return total;
}

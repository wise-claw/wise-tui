import { gitShowRevision } from "../services/git";
import { readProjectRelativeFile } from "../services/projectRelativeFiles";
import { buildFileTextDiffLines, type ToolFileEditPreviewLine } from "./toolFileEditPreview";

const cache = new Map<string, Promise<ToolFileEditPreviewLine[]>>();

/**
 * 历史会话只记下了路径、没有 old/new 时，用仓库里 HEAD 与工作区正文补出 diff。
 */
export function loadWorkingTreeFileDiffLines(
  repositoryPath: string,
  relativePath: string,
): Promise<ToolFileEditPreviewLine[]> {
  const key = `${repositoryPath}\n${relativePath}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const pending = computeWorkingTreeFileDiffLines(repositoryPath, relativePath).catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, pending);
  return pending;
}

async function computeWorkingTreeFileDiffLines(
  repositoryPath: string,
  relativePath: string,
): Promise<ToolFileEditPreviewLine[]> {
  const relative = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const [before, after] = await Promise.all([
    gitShowRevision(repositoryPath, `HEAD:${relative}`),
    readProjectRelativeFile(repositoryPath, relative).catch(() => ""),
  ]);
  if (before === after) return [];
  return buildFileTextDiffLines(before, after);
}

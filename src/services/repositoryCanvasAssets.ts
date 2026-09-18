import { readProjectRelativeFileBase64, readProjectRelativeFileForEditor, statProjectRelativeFile } from "./projectRelativeFiles";
import { inlineCanvasAssets } from "../utils/repositoryCanvasAssets";

export function loadRepositoryCanvasAssets(root: string, path: string, content: string) {
  let total = 0;
  const reserve = async (relative: string) => {
    const stat = await statProjectRelativeFile(root, relative);
    if (stat.byteLen > 4 * 1024 * 1024 || total + stat.byteLen > 16 * 1024 * 1024) {
      throw new Error("资源超过单文件 4MB / 总计 16MB 上限");
    }
    total += stat.byteLen;
  };
  return inlineCanvasAssets(content, path, {
    text: async (relative) => {
      await reserve(relative);
      return (await readProjectRelativeFileForEditor(root, relative)).content;
    },
    base64: async (relative) => {
      await reserve(relative);
      return readProjectRelativeFileBase64(root, relative);
    },
  });
}

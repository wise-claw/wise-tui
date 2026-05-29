import { invoke } from "@tauri-apps/api/core";

/** 将 data URL 解码后的 base64 写入 ~/.wise/composer-images/<仓库>/，返回绝对路径供 `@` 引用 */
export async function saveComposerImage(
  repositoryPath: string,
  filename: string,
  dataUrl: string,
): Promise<string | null> {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  const meta = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  const b64 = meta.includes(";base64") ? payload : null;
  if (!b64) return null;
  try {
    return await invoke<string>("save_composer_image", {
      projectPath: repositoryPath,
      filename,
      base64Data: b64,
    });
  } catch {
    return null;
  }
}

/** @deprecated 使用 {@link saveComposerImage} */
export const saveComposerImageToRepository = saveComposerImage;

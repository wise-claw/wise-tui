import { convertFileSrc, invoke } from "@tauri-apps/api/core";

/** 保存粘贴图片到 ~/.wise/prd-images/<repository>/ 并返回可在 WebView 展示的 URL。 */
export async function savePrdPastedImage(
  repositoryPath: string,
  repositoryName: string | null,
  repositoryId: number | null,
  projectName: string | null,
  projectId: string | null,
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
    const absolutePath = await invoke<string>("save_prd_pasted_image", {
      repositoryPath,
      repositoryName,
      repositoryId,
      projectName,
      projectId,
      filename,
      base64Data: b64,
    });
    return convertFileSrc(absolutePath);
  } catch (error) {
    console.error("[prd-image] save_prd_pasted_image failed:", error);
    return null;
  }
}

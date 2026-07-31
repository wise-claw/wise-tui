/** 判断 File 是否为图片（mime 优先，扩展名兜底）。 */
export function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif", "heic", "heif"].includes(ext);
}

function dataUrlToFile(dataUrl: string, index: number): File | null {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/i.exec(dataUrl.replace(/\s+/g, ""));
  if (!match) return null;
  const mime = match[1]!.toLowerCase();
  const b64 = match[2]!;
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const ext = mime.split("/")[1]?.replace("+xml", "") || "png";
    return new File([bytes], `pasted-image-${index + 1}.${ext}`, { type: mime });
  } catch {
    return null;
  }
}

/** 从 text/html 里捞 data:image URL（网页右键复制图片常见，没有 image/* item）。 */
export function collectImageFilesFromClipboardHtml(html: string): File[] {
  if (!html || !html.includes("data:image")) return [];
  const out: File[] = [];
  const re = /(?:src|href)\s*=\s*["'](data:image\/[^"']+)["']/gi;
  for (const match of html.matchAll(re)) {
    const file = dataUrlToFile(match[1] ?? "", out.length);
    if (file) out.push(file);
  }
  return out;
}

/**
 * 从剪贴板提取图片文件。
 * 优先 `items` 里 `image/*`；再回退 `files`；最后从 text/html 的 data URL 还原。
 */
export function collectClipboardImageFiles(
  data: DataTransfer | null | undefined,
): File[] {
  if (!data) return [];

  const out: File[] = [];
  const seen = new Set<File>();

  const push = (file: File | null | undefined) => {
    if (!file || seen.has(file)) return;
    seen.add(file);
    out.push(file);
  };

  const items = data.items;
  if (items?.length) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item || !item.type.startsWith("image/")) continue;
      push(item.getAsFile());
    }
  }

  if (out.length === 0 && data.files?.length) {
    for (const file of Array.from(data.files)) {
      if (isImageFile(file)) push(file);
    }
  }

  if (out.length === 0) {
    try {
      const html = data.getData("text/html");
      for (const file of collectImageFilesFromClipboardHtml(html)) push(file);
    } catch {
      /* getData 在部分时机会抛 */
    }
  }

  return out;
}

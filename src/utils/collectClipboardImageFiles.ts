/** 判断 File 是否为图片（mime 优先，扩展名兜底）。 */
export function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif", "heic", "heif"].includes(ext);
}

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "ico",
  "avif",
  "heic",
  "heif",
]);

export function isImagePath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.has(ext);
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

const REMOTE_IMAGE_URL_RE =
  /(?:src|href)\s*=\s*["'](https?:\/\/[^"'\s]+\.(?:png|jpe?g|gif|webp|svg|bmp|avif|heic|heif)(?:\?[^"'\s]*)?)["']/gi;

export function safeGetData(data: DataTransfer, type: string): string {
  try {
    return data.getData(type) ?? "";
  } catch {
    return "";
  }
}

const BARE_IMAGE_URL_RE = /^https?:\/\/\S+\.(?:png|jpe?g|gif|webp|svg|bmp|avif|heic|heif)(?:\?\S*)?$/i;

/**
 * 判断这次粘贴是否「看起来是图片粘贴」。
 * macOS WKWebView 的 DOM paste 经常拿不到图片数据（items/files 为空），
 * 靠这些线索决定是否走系统剪贴板兜底：
 * - types 里含 `Files` 或 `image/*`；
 * - 纯文本是一整段图片 URL（网页复制图片的常见形态）；
 * - clipboardData 整体为空（截屏复制等场景）。
 */
export function isLikelyImagePaste(data: DataTransfer | null | undefined): boolean {
  if (!data) return true;
  const rawTypes = (data.types ?? []) as unknown;
  const types: string[] = [];
  if (Array.isArray(rawTypes)) {
    types.push(...(rawTypes as string[]));
  } else if (typeof rawTypes === "object" && rawTypes !== null) {
    // Safari 下 DataTransfer.types 是 DOMStringList（length + item，无迭代器）。
    const list = rawTypes as { length?: number; item?: (index: number) => string | null };
    const len = list.length ?? 0;
    for (let i = 0; i < len; i += 1) {
      const type = list.item?.(i) ?? "";
      if (type) types.push(type);
    }
  }
  if (types.includes("Files") || types.some((type) => type.startsWith("image/"))) return true;
  const plain = safeGetData(data, "text/plain").trim();
  return BARE_IMAGE_URL_RE.test(plain);
}

/** `file:///Users/a/b.png` → `/Users/a/b.png`（含 percent-decode），普通绝对路径原样返回。 */
export function decodeFileUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let path = trimmed;
  if (path.startsWith("file://")) {
    path = path.slice("file://".length);
    // file:// 后紧跟主机名时仅保留本地路径（macOS 为空主机）。
    if (/^[^/]/.test(path)) path = `/${path.replace(/^[^/]*/, "")}`;
  }
  if (!path.startsWith("/")) return null;
  try {
    path = decodeURIComponent(path);
  } catch {
    /* 保留原文 */
  }
  return path;
}

export interface ClipboardImageRefs {
  /** 可直接读取的图片文件（剪贴板 image/* 或 files，含 text/html data URL 还原）。 */
  files: File[];
  /** 网页复制图片的远端 URL（text/html 里 http/https 的 `<img src>`）。 */
  remoteUrls: string[];
  /** Finder 复制图片文件的本地绝对路径（text/uri-list / text/plain 的 file://）。 */
  localPaths: string[];
}

/**
 * 从剪贴板收集全部图片引用：文件、远端 URL、本地路径。
 * 编辑器粘贴时优先插文件；无文件时尝试远端 URL / 本地路径兜底（防止只落下 URL 文本）。
 */
export function collectClipboardImageRefs(
  data: DataTransfer | null | undefined,
): ClipboardImageRefs {
  const files = collectClipboardImageFiles(data);
  const remoteUrls: string[] = [];
  const localPaths: string[] = [];
  if (!data || files.length > 0) {
    return { files, remoteUrls, localPaths };
  }

  const html = safeGetData(data, "text/html");
  if (html) {
    for (const match of html.matchAll(REMOTE_IMAGE_URL_RE)) {
      const url = match[1] ?? "";
      if (url && !remoteUrls.includes(url)) remoteUrls.push(url);
    }
  }

  const uriList = safeGetData(data, "text/uri-list");
  const plain = safeGetData(data, "text/plain");
  const candidates: string[] = [
    ...uriList.split(/\r?\n/),
    // 仅当整段纯文本看起来就是一个图片文件引用（file:// 前缀，或单行绝对图片路径）才纳入，
    // 避免普通文字里夹带路径时误读。
    ...(plain.trim().startsWith("file://") || (!/\s/.test(plain.trim()) && isImagePath(plain.trim()))
      ? [plain]
      : []),
  ];
  for (const candidate of candidates) {
    const path = decodeFileUrl(candidate);
    if (path && isImagePath(path) && !localPaths.includes(path)) localPaths.push(path);
  }

  return { files, remoteUrls, localPaths };
}

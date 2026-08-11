import { homeDir } from "@tauri-apps/api/path";
import type { ClaudeComposerExecuteBubbleOptions } from "../types";
import { saveComposerImage } from "./saveComposerImage";
import {
  deriveRequirementTitle,
  type WorkspaceRequirementItem,
} from "../types/workspaceRequirements";
import {
  countMarkdownImages,
  extractAbsoluteImagePathsFromMarkdown,
  stripMarkdownImages,
} from "../utils/markdownImages";

export {
  countMarkdownImages,
  extractAbsoluteImagePathsFromMarkdown,
  stripMarkdownImages,
};


function mimeFromDataUrl(dataUrl: string): string {
  const m = /^data:([^;,]+)/i.exec(dataUrl);
  return m?.[1]?.trim() || "image/png";
}

function extFromMime(mime: string): string {
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("png")) return "png";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("webp")) return "webp";
  return "png";
}

function mimeFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
  };
  return map[ext] ?? "image/png";
}

async function resolveWiseHomeDir(): Promise<string> {
  const home = await homeDir();
  return `${home.replace(/\/+$/, "")}/.wise`;
}

/**
 * 将 body 中的 data URL 图片落盘到 `~/.wise/composer-images/`，并把 Markdown 改写为绝对路径引用。
 * 返回改写后的 Markdown 与全部本地图片路径。
 */
export async function materializeRequirementBodyImages(bodyMarkdown: string): Promise<{
  bodyMarkdown: string;
  imagePaths: string[];
}> {
  const source = typeof bodyMarkdown === "string" ? bodyMarkdown : "";
  const wiseHome = await resolveWiseHomeDir();
  let next = source;
  const imagePaths: string[] = [];

  // 先收集已有绝对路径
  for (const p of extractAbsoluteImagePathsFromMarkdown(source)) {
    imagePaths.push(p);
  }

  // 1) Markdown 图片语法：`![alt](data:...)`
  const MD_IMAGE_RE = /!\[([^\]]*)\]\((data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+)\)/g;
  const dataMatches = [...source.matchAll(MD_IMAGE_RE)];
  for (let i = 0; i < dataMatches.length; i += 1) {
    const match = dataMatches[i]!;
    const full = match[0]!;
    const alt = match[1] ?? "";
    const dataUrl = (match[2] ?? "").replace(/\s+/g, "");
    if (!dataUrl.startsWith("data:")) continue;
    const mime = mimeFromDataUrl(dataUrl);
    const filename = `requirement-${i + 1}.${extFromMime(mime)}`;
    const absPath = await saveComposerImage(wiseHome, filename, dataUrl);
    if (!absPath) continue;
    next = next.replace(full, `![${alt}](${absPath})`);
    if (!imagePaths.includes(absPath)) imagePaths.push(absPath);
  }

  // 2) HTML <img src="data:...">：改写 src 为绝对路径，保留 width/align 等展示属性
  const HTML_DATA_RE = /<img\b[^>]*?\bsrc="(data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+)"[^>]*>/gi;
  let htmlSeq = dataMatches.length;
  for (const match of next.matchAll(HTML_DATA_RE)) {
    const full = match[0]!;
    const dataUrl = match[1]!;
    if (!dataUrl.startsWith("data:")) continue;
    htmlSeq += 1;
    const mime = mimeFromDataUrl(dataUrl);
    const filename = `requirement-${htmlSeq}.${extFromMime(mime)}`;
    const absPath = await saveComposerImage(wiseHome, filename, dataUrl);
    if (!absPath) continue;
    const rewritten = full.replace(`src="${dataUrl}"`, `src="${absPath}"`);
    next = next.replace(full, rewritten);
    if (!imagePaths.includes(absPath)) imagePaths.push(absPath);
  }

  // 再扫一遍改写后的绝对路径（防遗漏）
  for (const p of extractAbsoluteImagePathsFromMarkdown(next)) {
    if (!imagePaths.includes(p)) imagePaths.push(p);
  }

  return { bodyMarkdown: next, imagePaths };
}

function formatComposerMessageWithImages(main: string, imageBits: string[]): string {
  if (imageBits.length === 0) return main.trim();
  const tail = imageBits.join(" ");
  if (!main.trim()) {
    return `附图：${tail}`.trim();
  }
  return `${main.trim()}\n\n附图：${tail}`.trim();
}

export interface RequirementDispatchPayload {
  promptText: string;
  imagePaths: string[];
  executeBubbleOptions?: ClaudeComposerExecuteBubbleOptions;
}

/**
 * 将需求图文组装为待执行队列可消费的 prompt（文字 + 本地 `@` 图片路径）。
 * 若 body 仍含 data URL，会先落盘再组装。
 */
export async function buildRequirementDispatchPayload(
  item: WorkspaceRequirementItem,
): Promise<RequirementDispatchPayload> {
  const materialized = await materializeRequirementBodyImages(item.bodyMarkdown || item.description || "");
  const title = (item.title.trim() || deriveRequirementTitle(materialized.bodyMarkdown)).trim() || "无标题需求";
  const bodyText = stripMarkdownImages(materialized.bodyMarkdown);
  const main =
    bodyText && bodyText !== title
      ? `请实现以下需求：\n\n## ${title}\n\n${bodyText}`
      : `请实现以下需求：\n\n${title}`;

  const paths =
    materialized.imagePaths.length > 0
      ? materialized.imagePaths
      : Array.isArray(item.imagePaths)
        ? item.imagePaths.filter((p) => typeof p === "string" && p.trim().startsWith("/"))
        : [];

  const imageBits = paths.map((p) => `@${p}`);
  const promptText = formatComposerMessageWithImages(main, imageBits);
  const executeBubbleOptions: ClaudeComposerExecuteBubbleOptions | undefined =
    paths.length > 0
      ? {
          userBubblePrompt: promptText,
          cursorAttachments: paths.map((path) => ({
            path,
            mimeType: mimeFromPath(path),
          })),
        }
      : { userBubblePrompt: promptText };

  return { promptText, imagePaths: paths, executeBubbleOptions };
}


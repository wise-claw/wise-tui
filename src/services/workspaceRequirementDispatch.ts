import { homeDir } from "@tauri-apps/api/path";
import type { ClaudeComposerExecuteBubbleOptions } from "../types";
import { saveComposerImage } from "./saveComposerImage";
import {
  deriveRequirementTitle,
  type WorkspaceRequirementItem,
} from "../types/workspaceRequirements";

const MD_IMAGE_RE = /!\[([^\]]*)\]\((data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+)\)/g;
const MD_ABS_IMAGE_RE = /!\[([^\]]*)\]\((\/[^)\s]+)\)/g;

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

/** 去掉 Markdown 图片语法，保留纯文字。 */
export function stripMarkdownImages(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 从 Markdown 中收集绝对路径图片（已落盘）。 */
export function extractAbsoluteImagePathsFromMarkdown(markdown: string): string[] {
  const paths: string[] = [];
  const re = /!\[[^\]]*\]\((\/[^)\s]+)\)/g;
  for (const match of markdown.matchAll(re)) {
    const p = (match[1] ?? "").trim();
    if (p && !paths.includes(p)) paths.push(p);
  }
  return paths;
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

/** 供测试：匹配 data URL / 绝对路径图片语法（导出正则计数用）。 */
export function countMarkdownImages(markdown: string): number {
  const dataCount = [...markdown.matchAll(MD_IMAGE_RE)].length;
  const absCount = [...markdown.matchAll(MD_ABS_IMAGE_RE)].length;
  return dataCount + absCount;
}

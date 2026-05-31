import type { ContextItem, ImageAttachmentPart, Prompt } from "../types";
import {
  mergeContextFileMentions,
  serializePromptPartsToClaudeString,
} from "../utils/serializeClaudePrompt";
import { saveComposerImage } from "./saveComposerImage";

export interface CursorSdkAttachment {
  path: string;
  mimeType?: string;
}

function mimeTypeFromDataUrl(dataUrl: string): string {
  const meta = dataUrl.slice(0, dataUrl.indexOf(","));
  const match = /data:([^;]+);/i.exec(meta);
  return match?.[1]?.trim() || "image/png";
}

function buildOutgoingPromptWithImagePaths(
  opts: {
    prompt: Prompt;
    contextItems: ContextItem[];
  },
  imagePaths: readonly string[],
): string {
  let main = serializePromptPartsToClaudeString(opts.prompt, { trimEnd: true });
  main = mergeContextFileMentions(main, opts.contextItems);
  if (imagePaths.length === 0) {
    return main.trim();
  }
  const tail = imagePaths.map((path) => `@${path}`).join(" ");
  if (!main.trim()) {
    return `附图：${tail}`.trim();
  }
  return `${main.trim()}\n\n附图：${tail}`.trim();
}

/** 将 Composer 附图落盘并返回 Cursor bridge 可用的绝对路径列表。 */
export async function buildCursorSdkAttachments(params: {
  repositoryPath: string;
  images: ImageAttachmentPart[];
}): Promise<CursorSdkAttachment[]> {
  const out: CursorSdkAttachment[] = [];
  for (const img of params.images) {
    const absPath = await saveComposerImage(params.repositoryPath, img.filename, img.dataUrl);
    if (!absPath) continue;
    out.push({
      path: absPath,
      mimeType: mimeTypeFromDataUrl(img.dataUrl),
    });
  }
  return out;
}

/** 由 outbound 文本 + 已落盘路径合成用户气泡正文（避免队列/内存重复存长字符串）。 */
export function buildCursorUserBubblePrompt(
  outboundPrompt: string,
  attachments: readonly CursorSdkAttachment[],
): string {
  if (attachments.length === 0) return outboundPrompt;
  const tail = attachments.map((item) => `@${item.path}`).join(" ");
  const main = outboundPrompt.trim();
  if (!main) {
    return `附图：${tail}`.trim();
  }
  return `${main}\n\n附图：${tail}`.trim();
}

export interface CursorComposerSendPayload {
  outbound: string;
  cursorAttachments: CursorSdkAttachment[];
}

/** Cursor 引擎发送：图片只落盘一次；SDK prompt 不含 `@` 路径，图片走 `cursorAttachments`。 */
export async function buildCursorComposerSendPayload(params: {
  prompt: Prompt;
  contextItems: ContextItem[];
  images: ImageAttachmentPart[];
  repositoryPath: string;
}): Promise<CursorComposerSendPayload> {
  const cursorAttachments = await buildCursorSdkAttachments({
    repositoryPath: params.repositoryPath,
    images: params.images,
  });
  const imagePaths = cursorAttachments.map((item) => item.path);
  let outbound = buildOutgoingPromptWithImagePaths(
    { prompt: params.prompt, contextItems: params.contextItems },
    [],
  );
  if (!outbound.trim() && imagePaths.length > 0) {
    outbound =
      serializePromptPartsToClaudeString(params.prompt, { trimEnd: true }).trim() ||
      "请描述附图中的内容。";
  }
  return { outbound, cursorAttachments };
}

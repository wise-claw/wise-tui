import type { ContextItem, ImageAttachmentPart, Prompt } from "../types";
import { serializePromptPartsToClaudeString } from "../utils/serializeClaudePrompt";
import { buildClaudeOutgoingPrompt } from "./claudeComposerPrompt";
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

export interface CursorComposerSendPayload {
  outbound: string;
  userBubblePrompt: string;
  cursorAttachments: CursorSdkAttachment[];
}

/** Cursor 引擎发送：气泡仍展示附图路径，SDK prompt 不含 `@` 路径，图片走 `cursorAttachments`。 */
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
  const userBubblePrompt = await buildClaudeOutgoingPrompt(params);
  let outbound = await buildClaudeOutgoingPrompt({ ...params, images: [] });
  if (!outbound.trim() && cursorAttachments.length > 0) {
    outbound =
      serializePromptPartsToClaudeString(params.prompt, { trimEnd: true }).trim() ||
      "请描述附图中的内容。";
  }
  return { outbound, userBubblePrompt, cursorAttachments };
}

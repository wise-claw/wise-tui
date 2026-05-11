import type { ImageAttachmentPart, Prompt } from "../types";
import { buildClaudeOutgoingPrompt } from "../services/claudeComposerPrompt";

function mimeFromDataUrl(dataUrl: string): string | null {
  const m = /^data:([^;,]+)/i.exec(dataUrl);
  return m?.[1]?.trim() ?? null;
}

function extFromMime(m: string): string {
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("png")) return "png";
  if (m.includes("gif")) return "gif";
  if (m.includes("webp")) return "webp";
  return "png";
}

/**
 * 将钉钉自动化载荷中的正文与 data URL 图片，组装为发往 Claude Code 的 `-p` 字符串（含 `@.wise/composer-attachments/` 附图）。
 */
export async function buildDingTalkAutomationExecutePrompt(input: {
  repositoryPath: string;
  promptText: string;
  imageDataUrls?: string[] | null;
}): Promise<string> {
  const text = input.promptText.trim();
  const urls = (input.imageDataUrls ?? []).map((u) => u.trim()).filter(Boolean);
  const prompt: Prompt =
    text.length > 0 ? [{ type: "text", text, start: 0, end: text.length }] : [{ type: "text", text: "", start: 0, end: 0 }];
  const images: ImageAttachmentPart[] = urls.map((dataUrl, i) => {
    const mime = mimeFromDataUrl(dataUrl) ?? "image/png";
    const ext = extFromMime(mime);
    return {
      type: "image",
      id: `dingtalk-${i}-${Date.now()}`,
      filename: `dingtalk-${i + 1}.${ext}`,
      mime,
      dataUrl,
    };
  });
  return buildClaudeOutgoingPrompt({
    prompt,
    contextItems: [],
    images,
    repositoryPath: input.repositoryPath.trim(),
  });
}

import type { ContextItem, ImageAttachmentPart, Prompt } from "../types";
import {
  mergeContextFileMentions,
  serializePromptPartsToClaudeString,
} from "../utils/serializeClaudePrompt";
import { extractComposerAttachmentPathsFromText } from "./readComposerImage";
import { saveComposerImage } from "./saveComposerImage";

export interface BuildClaudeOutgoingPromptOptions {
  prompt: Prompt;
  contextItems: ContextItem[];
  images: ImageAttachmentPart[];
  repositoryPath: string;
  /** 会话气泡展示用编辑器纯文本；省略则与发往 CLI 的正文同源 */
  userBubbleMain?: string;
}

/** 发送/入历史前规范化编辑器纯文本：折叠重复块并去掉已有附图尾缀。 */
export function normalizeComposerPlainMain(plain: string, hasImages: boolean): string {
  let main = collapseRepeatedComposerMain(plain.replace(/\u200B/g, "").trim());
  if (hasImages) {
    main = stripComposerAttachedImageSuffix(main);
  }
  return main;
}

/** 从消息/历史条目的纯文本拆出编辑器正文与附图路径（填入 Composer 与 ↑ 恢复共用）。 */
export function buildComposerInsertFromPlainText(fullText: string): {
  composerMain: string;
  attachmentPaths: string[];
} {
  const trimmed = fullText.trim();
  const attachmentPaths = extractComposerAttachmentPathsFromText(trimmed);
  const composerMain =
    attachmentPaths.length > 0
      ? normalizeComposerPlainMain(stripComposerAttachedImageSuffix(trimmed), true)
      : trimmed;
  return { composerMain, attachmentPaths };
}

export interface ClaudeComposerSendPayload {
  /** 发往 Claude Code CLI 的完整 `-p` 字符串 */
  outbound: string;
  /** 会话内用户气泡展示正文（与 outbound 一致，避免附图块重复拼接） */
  userBubblePrompt: string;
  /** 与 `opts.images` 同序的落盘绝对路径（发送后用于历史/恢复缩略图） */
  imageDiskPaths: Array<string | null>;
}

/** 发送/恢复时去掉末尾附图块：`\\n\\n附图` 或 ` 附图`（系统派发句内常见）及之后路径、句号等。 */
const COMPOSER_ATTACHED_IMAGE_SUFFIX_RE = /(?:\s|[\n\r\u2028\u2029])+附图[：:][\s\S]*$/u;

/** 去掉正文末尾已拼接的附图块（上键恢复后重发、粘贴历史 outbound 时防重复）。 */
export function stripComposerAttachedImageSuffix(text: string): string {
  return text.replace(COMPOSER_ATTACHED_IMAGE_SUFFIX_RE, "").trimEnd();
}

const REPEATED_COMPOSER_WITH_IMAGES_RE =
  /^([\s\S]*?)(\n\n附图[：:][\s\S]*?)\n\n\1\2$/u;

/** 若整段正文由相同块连续重复两次（常见于编辑器双次 setContent），折叠为一块。 */
export function collapseRepeatedComposerMain(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length < 2) return trimmed;
  const withImages = trimmed.match(REPEATED_COMPOSER_WITH_IMAGES_RE);
  if (withImages) {
    return `${withImages[1]}${withImages[2]}`.trim();
  }
  const maxBlockLen = Math.floor(trimmed.length / 2);
  for (let len = maxBlockLen; len >= 1; len -= 1) {
    const block = trimmed.slice(0, len);
    if (!block) continue;
    if (block.repeat(2) === trimmed) {
      return block;
    }
  }
  return trimmed;
}

function formatComposerMessageWithImages(main: string, imageBits: string[]): string {
  if (imageBits.length === 0) return main.trim();
  const tail = imageBits.join(" ");
  if (!main.trim()) {
    return `附图：${tail}`.trim();
  }
  return `${main.trim()}\n\n附图：${tail}`.trim();
}

async function collectComposerImageBits(
  repositoryPath: string,
  images: ImageAttachmentPart[],
): Promise<{ bits: string[]; diskPaths: Array<string | null> }> {
  const bits: string[] = [];
  const diskPaths: Array<string | null> = [];
  for (const img of images) {
    const absPath = await saveComposerImage(repositoryPath, img.filename, img.dataUrl);
    diskPaths.push(absPath);
    if (absPath) {
      bits.push(`@${absPath}`);
    } else if (img.filename) {
      bits.push(
        `（图片 ${img.filename} 未能写入 ~/.wise，请用文字描述或保存到磁盘后再 @ 引用）`,
      );
    }
  }
  return { bits, diskPaths };
}

/**
 * 组装发往 Claude Code CLI 的完整 `-p` 字符串与会话气泡正文（单次落盘、附图只拼一段）。
 */
export async function buildClaudeComposerSendPayload(
  opts: BuildClaudeOutgoingPromptOptions,
): Promise<ClaudeComposerSendPayload> {
  let main = serializePromptPartsToClaudeString(opts.prompt, { trimEnd: true });
  main = mergeContextFileMentions(main, opts.contextItems);
  main = collapseRepeatedComposerMain(main);
  if (opts.images.length > 0) {
    main = stripComposerAttachedImageSuffix(main);
  }

  const { bits: imageBits, diskPaths: imageDiskPaths } = await collectComposerImageBits(
    opts.repositoryPath,
    opts.images,
  );
  const outbound = formatComposerMessageWithImages(main, imageBits);
  const bubbleMain =
    opts.userBubbleMain !== undefined
      ? normalizeComposerPlainMain(opts.userBubbleMain, opts.images.length > 0)
      : main;
  const userBubblePrompt = formatComposerMessageWithImages(bubbleMain, imageBits);
  return { outbound, userBubblePrompt, imageDiskPaths };
}

/**
 * 组装发往 Claude Code CLI 的完整 `-p` 字符串：
 * 编辑器正文（含 `/` 命令与 `@` 药丸）→ 合并上下文条中的文件 → 图片落盘为 `~/.wise/composer-images/...`（绝对路径 `@`）
 */
export async function buildClaudeOutgoingPrompt(
  opts: BuildClaudeOutgoingPromptOptions,
): Promise<string> {
  const payload = await buildClaudeComposerSendPayload(opts);
  return payload.outbound;
}

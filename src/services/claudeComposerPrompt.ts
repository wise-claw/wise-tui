import type { ContextItem, ImageAttachmentPart, Prompt } from "../types";
import {
  mergeContextFileMentions,
  serializePromptPartsToClaudeString,
} from "../utils/serializeClaudePrompt";
import { saveComposerImageToRepository } from "./saveComposerImage";

export interface BuildClaudeOutgoingPromptOptions {
  prompt: Prompt;
  contextItems: ContextItem[];
  images: ImageAttachmentPart[];
  repositoryPath: string;
}

/**
 * 组装发往 Claude Code CLI 的完整 `-p` 字符串：
 * 编辑器正文（含 `/` 命令与 `@` 药丸）→ 合并上下文条中的文件 → 图片落盘为 `@.wise/composer-attachments/...`
 */
export async function buildClaudeOutgoingPrompt(
  opts: BuildClaudeOutgoingPromptOptions,
): Promise<string> {
  let main = serializePromptPartsToClaudeString(opts.prompt, { trimEnd: true });
  main = mergeContextFileMentions(main, opts.contextItems);

  const imageBits: string[] = [];
  for (const img of opts.images) {
    const rel = await saveComposerImageToRepository(opts.repositoryPath, img.filename, img.dataUrl);
    if (rel) {
      imageBits.push(`@${rel}`);
    } else if (img.filename) {
      imageBits.push(`（图片 ${img.filename} 未能写入仓库，请用文字描述或保存到磁盘后再 @ 引用）`);
    }
  }

  if (imageBits.length === 0) {
    return main.trim();
  }
  const tail = imageBits.join(" ");
  if (!main.trim()) {
    return `附图：${tail}`.trim();
  }
  return `${main.trim()}\n\n附图：${tail}`.trim();
}

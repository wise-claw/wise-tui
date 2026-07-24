/**
 * 将 Markdown 中的 blob URL（`blob:http://...`）替换为 base64 data URI。
 *
 * Crepe/Milkdown 粘贴图片时默认生成临时 blob URL，页面刷新或过一段时间后
 * blob URL 失效导致图片丢失。此函数在保存前将所有可访问的 blob URL 转为
 * `data:<mime>;base64,...` 格式，确保图片持久化。
 *
 * 注意：代码块 / 行内代码中的 blob URL 不会被替换。
 */
export async function replaceBlobUrlsWithBase64(markdown: string): Promise<string> {
  const blobUrlRegex = /blob:[^\s)\]]+/g;
  const matches = [...markdown.matchAll(blobUrlRegex)];
  if (matches.length === 0) return markdown;

  // 收集唯一 blob URL，避免重复 fetch
  const uniqueUrls = new Set<string>();
  for (const m of matches) {
    uniqueUrls.add(m[0]);
  }

  // 并行 fetch 所有 blob URL
  const urlToBase64 = new Map<string, string | null>();
  await Promise.all(
    [...uniqueUrls].map(async (url) => {
      try {
        const resp = await fetch(url);
        if (!resp.ok) {
          urlToBase64.set(url, null);
          return;
        }
        const blob = await resp.blob();
        const buffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);
        const mime = blob.type || "image/png";
        urlToBase64.set(url, `data:${mime};base64,${base64}`);
      } catch {
        // blob URL 已失效或无法访问，保留原值
        urlToBase64.set(url, null);
      }
    }),
  );

  // 逐段处理：跳过代码块和行内代码中的 blob URL
  let result = "";
  let i = 0;

  while (i < markdown.length) {
    // 检查是否进入代码块 ```
    if (markdown.startsWith("```", i)) {
      const endFence = markdown.indexOf("```", i + 3);
      const codeBlockEnd = endFence === -1 ? markdown.length : endFence + 3;
      result += markdown.slice(i, codeBlockEnd);
      i = codeBlockEnd;
      continue;
    }

    // 检查是否进入行内代码 `
    if (markdown[i] === "`") {
      const endBacktick = markdown.indexOf("`", i + 1);
      if (endBacktick !== -1) {
        result += markdown.slice(i, endBacktick + 1);
        i = endBacktick + 1;
        continue;
      }
    }

    // 非代码区域：查找下一个 blob URL
    const remaining = markdown.slice(i);
    const match = remaining.match(blobUrlRegex);
    if (!match) {
      result += remaining;
      break;
    }

    const matchIndex = match.index!;
    const blobUrl = match[0];
    const absoluteMatchIndex = i + matchIndex;

    // 添加匹配前的文本
    result += markdown.slice(i, absoluteMatchIndex);

    // 替换或保留
    const replacement = urlToBase64.get(blobUrl);
    result += replacement ?? blobUrl;

    i = absoluteMatchIndex + blobUrl.length;
  }

  return result;
}

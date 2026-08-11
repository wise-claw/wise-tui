/**
 * Markdown 图片语法（`![alt](src)`）与 HTML `<img>` 语法的统一处理。
 * Tiptap 编辑器在图片带自定义尺寸/对齐时以 `<img width align>` 序列化，
 * 因此解析、落盘、计数需同时兼容两种形式。
 */

const MD_IMAGE_SYNTAX_RE = /!\[[^\]]*\]\([^)]+\)/g;
const MD_ABS_IMAGE_RE = /!\[[^\]]*\]\((\/[^)\s]+)\)/g;
const HTML_IMG_TAG_RE = /<img\b[^>]*>/gi;
const HTML_IMG_SRC_ATTR_RE = /src\s*=\s*"([^"]*)"/i;

export function htmlImageTags(markdown: string): string[] {
  return [...markdown.matchAll(HTML_IMG_TAG_RE)].map((match) => match[0]!);
}

export function htmlImageSrc(tag: string): string {
  const match = HTML_IMG_SRC_ATTR_RE.exec(tag);
  return match?.[1] ?? "";
}

/** 去掉 Markdown / HTML 图片语法，保留纯文字。 */
export function stripMarkdownImages(markdown: string): string {
  return markdown
    .replace(MD_IMAGE_SYNTAX_RE, "")
    .replace(HTML_IMG_TAG_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 从 Markdown / HTML 中收集绝对路径图片（已落盘）。 */
export function extractAbsoluteImagePathsFromMarkdown(markdown: string): string[] {
  const paths: string[] = [];
  const push = (path: string) => {
    if (path && !paths.includes(path)) paths.push(path);
  };
  for (const match of markdown.matchAll(MD_ABS_IMAGE_RE)) {
    push((match[1] ?? "").trim());
  }
  for (const tag of htmlImageTags(markdown)) {
    const src = htmlImageSrc(tag);
    if (src.startsWith("/")) push(src);
  }
  return paths;
}

/** 统计 Markdown / HTML 图片数量。 */
export function countMarkdownImages(markdown: string): number {
  const mdCount = [...markdown.matchAll(MD_IMAGE_SYNTAX_RE)].length;
  return mdCount + htmlImageTags(markdown).length;
}

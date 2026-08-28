export type ChromeSelectionImageRef = {
  alt: string;
  path?: string;
  url?: string;
};

export type ChromeSelectionRequirementEvent = {
  text: string;
  pageUrl: string;
  pageTitle: string;
  images: ChromeSelectionImageRef[];
};

const MAX_IMAGES = 8;
const MAX_TEXT_CHARS = 50_000;

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/[\[\]]/g, " ").replace(/\s+/g, " ").trim();
}

export function normalizeChromeSelectionRequirementEvent(
  raw: unknown,
): ChromeSelectionRequirementEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const text = asTrimmedString(row.text).slice(0, MAX_TEXT_CHARS);
  const pageUrl = asTrimmedString(row.pageUrl ?? row.page_url);
  const pageTitle = asTrimmedString(row.pageTitle ?? row.page_title);
  const imagesRaw = Array.isArray(row.images) ? row.images : [];
  const images: ChromeSelectionImageRef[] = [];
  const seen = new Set<string>();
  for (const entry of imagesRaw) {
    if (images.length >= MAX_IMAGES) break;
    if (!entry || typeof entry !== "object") continue;
    const img = entry as Record<string, unknown>;
    const alt = asTrimmedString(img.alt);
    const path = asTrimmedString(img.path);
    const url = asTrimmedString(img.url);
    const src = path || url;
    if (!src || seen.has(src)) continue;
    if (path && !path.startsWith("/")) continue;
    if (!path && !/^https?:\/\//i.test(url)) continue;
    seen.add(src);
    images.push({
      alt,
      ...(path ? { path } : {}),
      ...(!path && url ? { url } : {}),
    });
  }
  return { text, pageUrl, pageTitle, images };
}

export function chromeSelectionHasContent(
  event: ChromeSelectionRequirementEvent | null | undefined,
): event is ChromeSelectionRequirementEvent {
  if (!event) return false;
  return Boolean(event.text.trim()) || event.images.length > 0;
}

/** 把扩展选中的图文整理成需求 Markdown：正文 → 图片 → 来源链接。 */
export function buildChromeSelectionRequirementMarkdown(
  event: ChromeSelectionRequirementEvent,
): string {
  const lines: string[] = [];
  const text = event.text.trim();
  const title = event.pageTitle.trim();
  const url = event.pageUrl.trim();
  if (text) {
    lines.push(text);
  } else if (title) {
    lines.push(title);
  }
  for (const img of event.images) {
    const src = (img.path || img.url || "").trim();
    if (!src) continue;
    const alt = escapeMarkdownLabel(img.alt) || "网页图片";
    lines.push("", `![${alt}](${src})`);
  }
  if (url && /^https?:\/\//i.test(url)) {
    const label = escapeMarkdownLabel(title || url) || url;
    lines.push("", `来源：[${label}](${url})`);
  }
  return lines.join("\n").trim();
}

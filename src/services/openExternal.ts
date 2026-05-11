import { openUrl } from "@tauri-apps/plugin-opener";

/** http(s) / mailto / tel — 用于会话区等处的安全外链打开 */
export function isSafeExternalHref(href: string): boolean {
  const t = href.trim().toLowerCase();
  return (
    t.startsWith("https://") ||
    t.startsWith("http://") ||
    t.startsWith("mailto:") ||
    t.startsWith("tel:")
  );
}

/**
 * 在系统默认应用中打开 URL（桌面端一般为默认浏览器）。
 * 非 Tauri 或插件失败时回退到 `window.open`。
 */
export async function openExternalUrl(href: string): Promise<void> {
  if (!isSafeExternalHref(href)) return;
  try {
    await openUrl(href);
  } catch {
    window.open(href, "_blank", "noopener,noreferrer");
  }
}

/** 在容器上使用捕获/冒泡阶段委托：点击 `a[href]` 时用系统默认应用打开外链 */
export function attachExternalLinkDelegation(container: HTMLElement): () => void {
  function handleLinkClick(e: MouseEvent) {
    if (e.defaultPrevented) return;
    const target = e.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest("a");
    if (!anchor || !container.contains(anchor)) return;
    const href = anchor.getAttribute("href");
    if (!href || !isSafeExternalHref(href)) return;
    e.preventDefault();
    e.stopPropagation();
    void openExternalUrl(href);
  }
  container.addEventListener("click", handleLinkClick);
  return () => container.removeEventListener("click", handleLinkClick);
}

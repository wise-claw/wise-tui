import { isAuthorPane } from "../components/AuthorPanel/AuthorPanelTabs";
import {
  WISE_UI_EVENT_NAVIGATE,
  type WiseUiNavigationDetail,
} from "../constants/wiseUiNavigationEvents";
import { buildWiseAuthorLink } from "../utils/wiseAuthorLinks";

export { buildWiseAuthorLink };

export function parseWiseUiHref(href: string): WiseUiNavigationDetail | null {
  const trimmed = href.trim();
  if (!trimmed.toLowerCase().startsWith("wise://")) return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "wise:") return null;

    if (url.hostname === "author") {
      const pane = url.pathname.replace(/^\/+/, "").trim();
      if (!pane || !isAuthorPane(pane)) return null;
      const query = Object.fromEntries(url.searchParams.entries());
      return {
        kind: "author",
        pane,
        query: Object.keys(query).length > 0 ? query : undefined,
      };
    }
  } catch {
    return null;
  }

  return null;
}

export function dispatchWiseUiNavigation(detail: WiseUiNavigationDetail): void {
  window.dispatchEvent(new CustomEvent<WiseUiNavigationDetail>(WISE_UI_EVENT_NAVIGATE, { detail }));
}

/** 在容器上委托处理 wise:// 应用内导航链接。 */
export function attachWiseLinkDelegation(container: HTMLElement): () => void {
  function handleLinkClick(e: MouseEvent) {
    if (e.defaultPrevented) return;
    const target = e.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest("a");
    if (!anchor || !container.contains(anchor)) return;
    const href = anchor.getAttribute("href");
    if (!href) return;
    const nav = parseWiseUiHref(href);
    if (!nav) return;
    e.preventDefault();
    e.stopPropagation();
    dispatchWiseUiNavigation(nav);
  }

  container.addEventListener("click", handleLinkClick);
  return () => container.removeEventListener("click", handleLinkClick);
}

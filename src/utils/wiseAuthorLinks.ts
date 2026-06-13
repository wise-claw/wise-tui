import type { AuthorPane } from "../types/viewMode";

export function buildWiseAuthorLink(
  pane: AuthorPane,
  query?: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams();
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      const trimmed = value?.trim();
      if (trimmed) params.set(key, trimmed);
    }
  }
  const qs = params.toString();
  return `wise://author/${pane}${qs ? `?${qs}` : ""}`;
}

export const WISE_AUTHOR_PLUGIN_MARKET_LINK = buildWiseAuthorLink("claude-plugins");
export const WISE_AUTHOR_PLUGIN_INSTALLED_LINK = buildWiseAuthorLink("claude-plugins", {
  tab: "installed",
});

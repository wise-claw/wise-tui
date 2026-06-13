import type { AuthorPane } from "../types/viewMode";

export const WISE_UI_EVENT_NAVIGATE = "wise:ui-navigate";

export interface WiseUiAuthorNavigationDetail {
  kind: "author";
  pane: AuthorPane;
  query?: Record<string, string>;
}

export type WiseUiNavigationDetail = WiseUiAuthorNavigationDetail;

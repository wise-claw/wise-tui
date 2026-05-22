import { getAppSetting, setAppSetting } from "../../services/appSettingsStore";
import { DEFAULT_AUTHOR_PANE, type AuthorPane } from "../../types/viewMode";
import { AUTHOR_TAB_STORAGE_KEY, isAuthorPane } from "./AuthorPanelTabs";

/** 侧栏可见 Tab；`workspaces` / `artifacts` 等已从导航移除。 */
export function resolveAuthorNavPane(pane: AuthorPane, fallback: AuthorPane = DEFAULT_AUTHOR_PANE): AuthorPane {
  return isAuthorPane(pane) ? pane : fallback;
}

export function readAuthorPaneFromStorage(fallback: AuthorPane = DEFAULT_AUTHOR_PANE): AuthorPane {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(AUTHOR_TAB_STORAGE_KEY)?.trim() ?? "";
  return resolveAuthorNavPane(isAuthorPane(raw) ? raw : fallback, fallback);
}

export async function readAuthorPaneFromSettings(fallback: AuthorPane = DEFAULT_AUTHOR_PANE): Promise<AuthorPane> {
  const raw = (await getAppSetting(AUTHOR_TAB_STORAGE_KEY))?.trim() ?? "";
  return resolveAuthorNavPane(isAuthorPane(raw) ? raw : readAuthorPaneFromStorage(fallback), fallback);
}

export function writeAuthorPaneToStorage(pane: AuthorPane): void {
  if (!isAuthorPane(pane)) return;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(AUTHOR_TAB_STORAGE_KEY, pane);
  }
  void setAppSetting(AUTHOR_TAB_STORAGE_KEY, pane).catch(() => {
    /* Last Author tab is a UI convenience; keep local fallback if settings write fails. */
  });
}

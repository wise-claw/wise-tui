import { message } from "antd";
import { HoverHint } from "../shared/HoverHint";
import { openMainWorkspaceWindow } from "../../services/mainWindow";

function IconNewWindow() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect
        x="4"
        y="6"
        width="11"
        height="13"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9 3h11v11"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M20 3l-8 8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface Props {
  /** 新建窗口时预选当前仓库（类似 VS Code 带工作区上下文开新窗）。 */
  activeRepositoryId?: number | null;
}

export function NewMainWindowTopbarTrigger({ activeRepositoryId }: Props) {
  return (
    <HoverHint title="新建窗口 (⇧⌘N)">
      <button
        type="button"
        className="app-left-sidebar-topbar-btn app-new-main-window-topbar-btn"
        aria-label="新建窗口"
        onClick={() => {
          void openMainWorkspaceWindow(activeRepositoryId ?? undefined).catch((err) => {
            message.error(err instanceof Error ? err.message : "无法新建窗口");
          });
        }}
      >
        <IconNewWindow />
      </button>
    </HoverHint>
  );
}

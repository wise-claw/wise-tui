import { APP_SHORTCUT_GROUPS } from "../../constants/appShortcuts";
import "./index.css";

interface Props {
  /** `compact`：左栏 Popover；`default`：设置全屏页 */
  density?: "compact" | "default";
}

export function AppShortcutsPopoverBody({ density = "compact" }: Props) {
  const isCompact = density === "compact";
  return (
    <div
      className={[
        "app-shortcuts-popover",
        isCompact ? "app-shortcuts-popover--compact" : "app-shortcuts-popover--page",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="app-shortcuts-popover__groups" aria-label="快捷键命令清单">
        {APP_SHORTCUT_GROUPS.map((group) => (
          <div key={group.title} className="app-shortcuts-popover__group">
            <div className="app-shortcuts-popover__section-title">{group.title}</div>
            {group.rows.map((row) => (
              <div className="app-shortcuts-popover__row" key={`${group.title}-${row.keys}`}>
                <span className="app-shortcuts-popover__kbd">{row.keys}</span>
                <span className="app-shortcuts-popover__desc">{row.description}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

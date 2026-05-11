import { Typography } from "antd";
import { APP_SHORTCUT_GROUPS } from "../../constants/appShortcuts";
import "./index.css";

interface Props {
  /** `compact`：左栏 Popover；`default`：设置全屏页 */
  density?: "compact" | "default";
}

export function AppShortcutsPopoverBody({ density = "compact" }: Props) {
  return (
    <div
      className={[
        "app-shortcuts-popover",
        density === "compact" ? "app-shortcuts-popover--compact" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Typography.Paragraph type="secondary" className="app-shortcuts-popover__intro">
        全局快捷键由系统注册，任意前台应用均可触发；应用内快捷键仅在 Wise 窗口聚焦时生效。
      </Typography.Paragraph>
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
  );
}

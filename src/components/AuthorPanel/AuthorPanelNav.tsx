import { LeftOutlined } from "@ant-design/icons";
import { Layout } from "antd";
import { memo, useCallback } from "react";
import { MAIN_LAYOUT_LEFT_SIDER_WIDTH_PX } from "../../constants/mainLayoutWidths";
import { AUTHOR_TAB_GROUPS } from "./AuthorPanelTabs";
import type { AuthorPane } from "./AuthorPanelTabs";
import "./index.css";

export interface AuthorPanelNavProps {
  pane: AuthorPane;
  onPaneChange: (pane: AuthorPane) => void;
  onBack: () => void;
  dark?: boolean;
  collapsed?: boolean;
  /** 退出工作台配置后暂挂（保持挂载，避免再次进入时重建）。 */
  parked?: boolean;
  siderWidth?: number;
}

export const AuthorPanelNav = memo(function AuthorPanelNav({
  pane,
  onPaneChange,
  onBack,
  dark = false,
  collapsed = false,
  parked = false,
  siderWidth = MAIN_LAYOUT_LEFT_SIDER_WIDTH_PX,
}: AuthorPanelNavProps) {
  const handleBack = useCallback(() => {
    onBack();
  }, [onBack]);

  const handlePaneChange = useCallback(
    (nextPane: AuthorPane) => {
      if (nextPane === pane) return;
      onPaneChange(nextPane);
    },
    [onPaneChange, pane],
  );

  return (
    <Layout.Sider
      width={siderWidth}
      collapsedWidth={0}
      collapsed={collapsed}
      className={`app-left-sidebar app-author-config-sider${parked ? " app-author-config-sider--parked" : ""}`}
      theme={dark ? "dark" : "light"}
    >
      <nav className="author-panel__nav" aria-label="工作台配置导航">
        <div className="author-panel__nav-topbar">
          <div
            className="author-panel__nav-drag app-logo-draggable"
            data-tauri-drag-region
            aria-hidden
          />
          <button
            type="button"
            className="author-panel-nav-item author-panel-nav-item--back"
            onClick={handleBack}
            title="关闭工作台配置"
            aria-label="关闭工作台配置"
          >
            <span className="author-panel-nav-item__icon" aria-hidden>
              <LeftOutlined />
            </span>
            <span className="author-panel-nav-item__label">返回</span>
          </button>
        </div>
        {AUTHOR_TAB_GROUPS.map((group) => (
          <div className="author-panel-nav-group" key={group.title}>
            <div className="author-panel-nav-group__title">{group.title}</div>
            {group.items.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={`author-panel-nav-item${tab.key === pane ? " author-panel-nav-item--active" : ""}`}
                onClick={() => handlePaneChange(tab.key)}
                title={tab.description}
              >
                <span className="author-panel-nav-item__icon" aria-hidden>
                  {tab.icon}
                </span>
                <span className="author-panel-nav-item__label">{tab.label}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>
    </Layout.Sider>
  );
});

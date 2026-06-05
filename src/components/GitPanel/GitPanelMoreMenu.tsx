import { useMemo } from "react";
import { Button, Dropdown } from "antd";
import type { MenuProps } from "antd";
import { GlobalOutlined, HistoryOutlined, MoreOutlined } from "@ant-design/icons";

interface GitPanelMoreMenuProps {
  historyActive?: boolean;
  onOpenHistory?: () => void;
  onOpenInBrowser?: () => void;
  openingBrowser?: boolean;
}

export function GitPanelMoreMenu({
  historyActive = false,
  onOpenHistory,
  onOpenInBrowser,
  openingBrowser = false,
}: GitPanelMoreMenuProps) {
  const menuItems = useMemo((): MenuProps["items"] => {
    const items: MenuProps["items"] = [];
    if (onOpenHistory) {
      items.push({
        key: "history",
        label: "提交历史",
        icon: <HistoryOutlined />,
        className: historyActive ? "git-panel-more-menu__item--active" : undefined,
        onClick: onOpenHistory,
      });
    }
    if (onOpenInBrowser) {
      items.push({
        key: "browser",
        label: "在浏览器中打开仓库",
        icon: <GlobalOutlined />,
        disabled: openingBrowser,
        onClick: onOpenInBrowser,
      });
    }
    return items;
  }, [historyActive, onOpenHistory, onOpenInBrowser, openingBrowser]);

  if (!menuItems || menuItems.length === 0) {
    return null;
  }

  return (
    <Dropdown
      menu={{ items: menuItems, className: "git-panel-more-menu" }}
      classNames={{ root: "git-panel-more-menu-dropdown" }}
      trigger={["click"]}
    >
      <Button
        type="text"
        size="small"
        className={`git-panel-more-btn${historyActive ? " git-panel-more-btn--active" : ""}`}
        icon={<MoreOutlined />}
        aria-label="更多 Git 操作"
        aria-haspopup="menu"
      />
    </Dropdown>
  );
}

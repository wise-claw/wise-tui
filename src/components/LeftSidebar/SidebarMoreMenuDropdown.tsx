import type { MenuProps } from "antd";
import { Dropdown, type DropdownProps } from "antd";
import { useCallback, useMemo, type ReactElement, type ReactNode } from "react";

type SidebarMoreMenuDropdownProps = Omit<DropdownProps, "menu" | "rootClassName" | "getPopupContainer"> & {
  items: MenuProps["items"];
  onMenuClick: NonNullable<MenuProps["onClick"]>;
  children: ReactElement;
};

/** 侧栏工作区/仓库「更多」菜单：挂 body、独立滚动、阻断 wheel 穿透侧栏列表。 */
export function SidebarMoreMenuDropdown({
  items,
  onMenuClick,
  children,
  ...dropdownProps
}: SidebarMoreMenuDropdownProps) {
  const menu = useMemo(
    (): MenuProps => ({
      className: "app-sidebar-more-menu-inner",
      items,
      onClick: onMenuClick,
    }),
    [items, onMenuClick],
  );

  const dropdownRender = useCallback((originNode: ReactNode) => {
    return (
      <div
        className="app-sidebar-more-menu-scroll-shell"
        onWheel={(event) => {
          event.stopPropagation();
        }}
      >
        {originNode}
      </div>
    );
  }, []);

  return (
    <Dropdown
      {...dropdownProps}
      rootClassName="app-sidebar-more-menu-dropdown"
      getPopupContainer={() => document.body}
      dropdownRender={dropdownRender}
      menu={menu}
    >
      {children}
    </Dropdown>
  );
}

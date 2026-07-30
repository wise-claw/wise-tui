import { useState } from "react";
import { Dropdown } from "antd";
import { HoverHint } from "../shared/HoverHint";
import { WISE_THEME_MODES, WISE_THEME_MODE_LABELS, isWiseThemeMode } from "../../constants/appTheme";
import { setAppThemeMode, toggleAppTheme, useAppTheme } from "../../stores/appThemeStore";

/**
 * 顶栏外观切换。沿用顶栏既有约定：左键直接切浅/深，右键选具体模式（含跟随系统）。
 */

function IconSun() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path
        d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconMoon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        d="M20 14.5A8.2 8.2 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.05"
      />
    </svg>
  );
}

export function AppearanceThemeToggle() {
  const { mode, dark } = useAppTheme();
  const [menuOpen, setMenuOpen] = useState(false);

  const hint =
    mode === "system"
      ? `外观：跟随系统（当前${dark ? "深色" : "浅色"}）· 左键切换 · 右键选择`
      : `外观：${WISE_THEME_MODE_LABELS[mode]} · 左键切换 · 右键选择`;

  return (
    <Dropdown
      trigger={[]}
      placement="bottomRight"
      open={menuOpen}
      onOpenChange={setMenuOpen}
      menu={{
        selectedKeys: [mode],
        items: WISE_THEME_MODES.map((value) => ({
          key: value,
          label: WISE_THEME_MODE_LABELS[value],
        })),
        onClick: ({ key }) => {
          if (isWiseThemeMode(key)) setAppThemeMode(key);
          setMenuOpen(false);
        },
      }}
    >
      <HoverHint title={hint} open={menuOpen ? false : undefined}>
        <button
          type="button"
          className="app-topbar-btn"
          aria-label={hint}
          onClick={toggleAppTheme}
          onContextMenu={(event) => {
            event.preventDefault();
            setMenuOpen(true);
          }}
        >
          {dark ? <IconMoon /> : <IconSun />}
        </button>
      </HoverHint>
    </Dropdown>
  );
}

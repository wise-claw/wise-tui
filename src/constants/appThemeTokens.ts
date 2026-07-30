import { theme } from "antd";
import type { ThemeConfig } from "antd";

/**
 * 全局 AntD 主题配置的唯一生成点。
 *
 * 视觉基线：13px 正文、1.55 行高、圆角 8。浅/深两套只在语义色与容器色上分叉，
 * 尺寸与圆角共用，保证切换主题时布局不跳动。
 *
 * 自定义面板不要再各写一套颜色：这里注入的 `--ant-color-*` 是 `App.css` 中
 * `--mission-*` / `--wise-*` 的上游，组件 CSS 应消费后者。
 */

export const APP_FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "SF Pro SC", "SF Pro Text", "PingFang SC", "Helvetica Neue", "Microsoft YaHei", "Segoe UI", Arial, sans-serif';

export const APP_FONT_FAMILY_CODE =
  'ui-monospace, SFMono-Regular, "SF Mono", "JetBrains Mono", Menlo, Consolas, "Liberation Mono", monospace';

/** 基准字号：与 `--wise-font-size-base` 保持一致。 */
export const APP_BASE_FONT_SIZE = 13;

/** MCP/技能等叠层 z-index 较高，消息与通知必须压在其上，否则用户看不到反馈。 */
const OVERLAY_FEEDBACK_Z_INDEX = 20000;

interface ThemePalette {
  primary: string;
  info: string;
  success: string;
  warning: string;
  error: string;
  bgLayout: string;
  bgContainer: string;
  bgElevated: string;
  siderBg: string;
}

const LIGHT_PALETTE: ThemePalette = {
  primary: "#1677ff",
  info: "#1677ff",
  success: "#1a9e5f",
  warning: "#d98511",
  error: "#e0483e",
  // 略偏冷的中性灰，避免大面积纯 #f5f5f5 在深色文字下发灰发脏
  bgLayout: "#f4f6f8",
  bgContainer: "#ffffff",
  bgElevated: "#ffffff",
  siderBg: "#f7f8fa",
};

const DARK_PALETTE: ThemePalette = {
  // 深色底上提亮主色，保证 AA 对比度
  primary: "#4a92ff",
  info: "#4a92ff",
  success: "#3fb87a",
  warning: "#e5a03a",
  error: "#f0655c",
  // 比 AntD 默认 #000/#141414 更柔和的冷灰，长时间阅读不压眼
  bgLayout: "#15171a",
  bgContainer: "#1c1f23",
  bgElevated: "#24282d",
  siderBg: "#191c1f",
};

export function appThemePalette(dark: boolean): ThemePalette {
  return dark ? DARK_PALETTE : LIGHT_PALETTE;
}

function sharedShapeTokens() {
  return {
    fontFamily: APP_FONT_FAMILY,
    fontFamilyCode: APP_FONT_FAMILY_CODE,
    fontSize: APP_BASE_FONT_SIZE,
    lineHeight: 1.55,
    borderRadius: 8,
    borderRadiusLG: 10,
    borderRadiusSM: 6,
    borderRadiusXS: 4,
    wireframe: false,
    motionDurationMid: "0.18s",
    motionDurationSlow: "0.28s",
    motionEaseInOut: "cubic-bezier(0.33, 1, 0.68, 1)",
  } as const;
}

function shadowTokens(dark: boolean) {
  if (dark) {
    return {
      boxShadow: "0 6px 18px rgba(0, 0, 0, 0.45)",
      boxShadowSecondary: "0 10px 32px rgba(0, 0, 0, 0.5)",
      boxShadowTertiary: "0 2px 6px rgba(0, 0, 0, 0.36)",
    } as const;
  }
  return {
    boxShadow: "0 4px 14px rgba(15, 23, 42, 0.08)",
    boxShadowSecondary: "0 10px 32px rgba(15, 23, 42, 0.1)",
    boxShadowTertiary: "0 1px 4px rgba(15, 23, 42, 0.06)",
  } as const;
}

export function buildAppThemeConfig(dark: boolean): ThemeConfig {
  const palette = appThemePalette(dark);
  return {
    algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      ...sharedShapeTokens(),
      ...shadowTokens(dark),
      colorPrimary: palette.primary,
      colorInfo: palette.info,
      colorSuccess: palette.success,
      colorWarning: palette.warning,
      colorError: palette.error,
      colorBgLayout: palette.bgLayout,
      colorBgContainer: palette.bgContainer,
      colorBgElevated: palette.bgElevated,
    },
    components: {
      Message: { zIndexPopup: OVERLAY_FEEDBACK_Z_INDEX },
      Notification: { zIndexPopup: OVERLAY_FEEDBACK_Z_INDEX },
      Layout: {
        bodyBg: palette.bgLayout,
        siderBg: palette.siderBg,
        headerBg: palette.bgContainer,
        footerBg: palette.bgLayout,
      },
      // 侧栏/配置导航：胶囊选中态 + 更紧的行高，贴合 13px 基准
      Menu: {
        itemHeight: 32,
        itemBorderRadius: 7,
        itemMarginInline: 6,
        itemMarginBlock: 2,
        subMenuItemBorderRadius: 7,
        iconMarginInlineEnd: 8,
      },
      Tooltip: { borderRadius: 7 },
      Segmented: { itemSelectedBg: palette.bgElevated, trackPadding: 3, borderRadius: 7 },
      Tabs: { horizontalItemGutter: 20, titleFontSize: APP_BASE_FONT_SIZE },
      Card: { borderRadiusLG: 12 },
      Modal: { borderRadiusLG: 14, titleFontSize: 15 },
      Drawer: { footerPaddingBlock: 10 },
      Collapse: { borderRadiusLG: 10 },
      Table: { borderRadius: 10, headerBorderRadius: 10 },
      Tag: { borderRadiusSM: 5 },
      Popover: { borderRadiusLG: 12 },
      Dropdown: { borderRadiusLG: 10, controlPaddingHorizontal: 10 },
      Input: { borderRadius: 8 },
      Button: { borderRadius: 8, paddingInline: 13, fontWeight: 500 },
      Switch: { trackMinWidth: 38 },
      Tree: { titleHeight: 24, nodeSelectedBg: `${palette.primary}1f` },
      Empty: { controlHeightLG: 40 },
    },
  };
}

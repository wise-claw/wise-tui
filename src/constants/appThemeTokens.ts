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
  border: string;
  borderSecondary: string;
  split: string;
  textSecondary: string;
  textTertiary: string;
  textQuaternary: string;
  fillSecondary: string;
  fillTertiary: string;
  fillQuaternary: string;
}

const LIGHT_PALETTE: ThemePalette = {
  primary: "#1677ff",
  info: "#1677ff",
  success: "#1a9e5f",
  warning: "#d98511",
  error: "#e0483e",
  // 略偏冷的中性灰，比容器深一档，白卡片才能真正“浮”起来
  bgLayout: "#eef1f6",
  bgContainer: "#ffffff",
  bgElevated: "#ffffff",
  siderBg: "#f5f7fa",
  // 边框收敛到同一支冷灰，避免 AntD 默认 #d9d9d9 / #f0f0f0 冷暖不一、卡片轮廓发虚
  border: "#dde4ee",
  borderSecondary: "#e9eef6",
  split: "#e9eef6",
  // 次要/三级文字各提亮一档，中文小字不再糊成一片浅灰
  textSecondary: "#5a6472",
  textTertiary: "#8a94a3",
  textQuaternary: "#aab3c0",
  fillSecondary: "rgba(16, 24, 40, 0.06)",
  fillTertiary: "rgba(16, 24, 40, 0.04)",
  fillQuaternary: "rgba(16, 24, 40, 0.025)",
};

const DARK_PALETTE: ThemePalette = {
  // 深色底上提亮主色，保证 AA 对比度
  primary: "#4a92ff",
  info: "#4a92ff",
  success: "#3fb87a",
  warning: "#e5a03a",
  error: "#f0655c",
  // 比 AntD 默认 #000/#141414 更柔和的冷灰，长时间阅读不压眼
  bgLayout: "#0f1114",
  bgContainer: "#171a1e",
  bgElevated: "#20242a",
  siderBg: "#141719",
  border: "#2e343c",
  borderSecondary: "#242a31",
  split: "#242a31",
  textSecondary: "rgba(255, 255, 255, 0.68)",
  textTertiary: "rgba(255, 255, 255, 0.46)",
  textQuaternary: "rgba(255, 255, 255, 0.30)",
  fillSecondary: "rgba(255, 255, 255, 0.08)",
  fillTertiary: "rgba(255, 255, 255, 0.05)",
  fillQuaternary: "rgba(255, 255, 255, 0.03)",
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
    borderRadiusLG: 12,
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
      // 深色下纯黑大阴影会糊成一块；用「贴地 + 环境」两层，保留边缘可读性
      boxShadow: "0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 20px -8px rgba(0, 0, 0, 0.6)",
      boxShadowSecondary: "0 2px 6px rgba(0, 0, 0, 0.4), 0 20px 48px -16px rgba(0, 0, 0, 0.72)",
      boxShadowTertiary: "0 1px 2px rgba(0, 0, 0, 0.4)",
    } as const;
  }
  return {
    // 浅色下先用 1px 接触阴影定住轮廓，再用大半径负扩散做柔和环境光
    boxShadow: "0 1px 2px rgba(16, 24, 40, 0.05), 0 8px 20px -10px rgba(16, 24, 40, 0.14)",
    boxShadowSecondary: "0 2px 6px rgba(16, 24, 40, 0.05), 0 20px 48px -18px rgba(16, 24, 40, 0.2)",
    boxShadowTertiary: "0 1px 2px rgba(16, 24, 40, 0.06)",
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
      colorBorder: palette.border,
      colorBorderSecondary: palette.borderSecondary,
      colorSplit: palette.split,
      colorTextSecondary: palette.textSecondary,
      colorTextTertiary: palette.textTertiary,
      colorTextQuaternary: palette.textQuaternary,
      colorFillSecondary: palette.fillSecondary,
      colorFillTertiary: palette.fillTertiary,
      colorFillQuaternary: palette.fillQuaternary,
      fontWeightStrong: 600,
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
        itemBorderRadius: 8,
        itemMarginInline: 6,
        itemMarginBlock: 2,
        subMenuItemBorderRadius: 8,
        iconMarginInlineEnd: 8,
      },
      Tooltip: { borderRadius: 8 },
      Segmented: { itemSelectedBg: palette.bgElevated, trackPadding: 3, borderRadius: 8 },
      Tabs: { horizontalItemGutter: 20, titleFontSize: APP_BASE_FONT_SIZE },
      Card: { borderRadiusLG: 14 },
      Modal: { borderRadiusLG: 16, titleFontSize: 15 },
      Drawer: { footerPaddingBlock: 10 },
      Collapse: { borderRadiusLG: 12 },
      Table: { borderRadius: 12, headerBorderRadius: 12 },
      Tag: { borderRadiusSM: 6 },
      Popover: { borderRadiusLG: 12 },
      Dropdown: { borderRadiusLG: 12, controlPaddingHorizontal: 10 },
      Input: { borderRadius: 8 },
      Button: { borderRadius: 8, paddingInline: 13, fontWeight: 500 },
      Switch: { trackMinWidth: 38 },
      Tree: { titleHeight: 24, nodeSelectedBg: `${palette.primary}1f` },
      Empty: { controlHeightLG: 40 },
    },
  };
}

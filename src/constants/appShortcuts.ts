export interface AppShortcutRow {
  keys: string;
  description: string;
}

export interface AppShortcutGroup {
  title: string;
  rows: AppShortcutRow[];
}

/** 与 Tauri `global_shortcut`、主窗 `keydown` 捕获逻辑保持一致，供快捷键说明 Popover 使用。 */
export const APP_SHORTCUT_GROUPS: AppShortcutGroup[] = [
  {
    title: "全局（桌面版）",
    rows: [
      {
        keys: "F3",
        description: "桌面截图，并把图片投递到最近操作过的会话输入框。",
      },
      {
        keys: "⌥Z · Alt+Z",
        description: "置顶主窗口，并将焦点切到最近操作过的会话输入框。",
      },
      {
        keys: "⌥S · Alt+S",
        description: "置顶主窗口，并切换小窗口模式（收起右栏、固定窗口尺寸）。",
      },
      {
        keys: "⌥K · Alt+K",
        description: "置顶主窗口，并切换双栏布局。",
      },
    ],
  },
  {
    title: "应用内",
    rows: [
      {
        keys: "Esc",
        description: "焦点在会话输入框内且无 @ / 补全菜单时：撤销上一步编辑（与 Ctrl+Z 同一栈）。",
      },
      {
        keys: "⌃` · Ctrl+`",
        description: "打开或关闭终端面板（反引号键，数字 1 左侧；须用 Control，不是 ⌘）。",
      },
      {
        keys: "⌘K · Ctrl+K",
        description: "打开或关闭命令面板。",
      },
      {
        keys: "⌘⇧M · Ctrl+Shift+M",
        description: "显示 Wise 浮窗助手。",
      },
      {
        keys: "⌘R · Ctrl+R",
        description: "重新加载应用界面。",
      },
      {
        keys: "可配置",
        description:
          "主会话：「默认配置 → @ 快捷键」插入 @ 提及；「会话常用语」配置正文与组合键，输入区按钮或快捷键直接发送。",
      },
    ],
  },
];

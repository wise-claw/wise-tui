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
        description: "置顶主窗口，并打开默认配置弹窗。",
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
        keys: "⌘N · Ctrl+N",
        description: "为当前仓库新建一个对话会话。",
      },
      {
        keys: "Esc",
        description: "焦点在会话输入框内且无 @ / 补全菜单时：撤销上一步编辑（与 Ctrl+Z 同一栈）。",
      },
      {
        keys: "⌃` · Ctrl+`",
        description: "打开或关闭终端面板（反引号键，数字 1 左侧；须用 Control，不是 ⌘）。",
      },
      {
        keys: "⌘W · Ctrl+W",
        description: "焦点在终端面板内时：关闭当前终端标签；仅剩一个时同时关闭面板。",
      },
      {
        keys: "⌘F · Ctrl+F",
        description: "Wise 主窗口聚焦时打开全局搜索（文件名模式）。",
      },
      {
        keys: "⌘K · Ctrl+K",
        description: "打开或关闭全局搜索（文件名模式）。",
      },
      {
        keys: "⌘⇧F · Ctrl+Shift+F",
        description: "Wise 主窗口聚焦时打开全局搜索（文件内容模式）。",
      },
      {
        keys: "⌘J · Ctrl+J",
        description: "文件内容搜索的并列快捷键（与 ⌘⇧F 同效）。",
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
          "主会话输入框聚焦时：「默认配置 → @ 快捷键」插入 @ 提及；「会话常用语」配置正文与组合键，按钮或快捷键直接发送。",
      },
    ],
  },
];

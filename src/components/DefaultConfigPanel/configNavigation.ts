/** 以工作台任务划分配置入口；引擎专属设置归入统一的运行分类。 */
export const DEFAULT_CONFIG_CATEGORIES = [
  { key: "session", title: "会话与输入", description: "设置新会话的默认行为，以及消息输入方式。", sections: ["session", "composer"] },
  { key: "runtime", title: "Agent 与运行", description: "管理各引擎的默认权限、终端和本地工具快捷键。", sections: ["engines", "terminal", "repoShortcuts"] },
  { key: "workspace", title: "工作台布局", description: "安排工作区、需求与运行面板，调整界面和通知。", sections: ["leftSidebar", "chrome"] },
  { key: "files", title: "文件与产物", description: "设置 Git、文件树及文件预览的打开方式。", sections: ["gitFiles"] },
  { key: "automation", title: "自动化与反馈", description: "配置反馈分析、自我优化闭环及全局规则。", sections: ["dev"] },
  { key: "about", title: "关于与更新", description: "查看 Wise 版本，管理更新检查。", sections: ["updates"] },
] as const;

export function matchesConfigSearch(query: string, text: string): boolean {
  const normalized = text.toLocaleLowerCase();
  return query.trim().toLocaleLowerCase().split(/\s+/).every((word) => normalized.includes(word));
}

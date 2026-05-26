import {
  ApartmentOutlined,
  ApiOutlined,
  AppstoreAddOutlined,
  AppstoreOutlined,
  BranchesOutlined,
  FieldTimeOutlined,
  FolderOpenOutlined,
  GatewayOutlined,
  SlidersOutlined,
  BlockOutlined,
  RobotOutlined,
  ThunderboltOutlined,
  ToolOutlined,
  UserOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";
import type { AuthorPane } from "../../types/viewMode";
import { IconClaudeSandboxHelp } from "../icons/IconClaudeSandboxHelp";
import { IconKeyboardShortcuts } from "../icons/IconKeyboardShortcuts";

export interface AuthorTabDefinition {
  key: AuthorPane;
  label: string;
  description: string;
  icon: ReactNode;
}

export const AUTHOR_TAB_STORAGE_KEY = "wise.author.lastPane";

export const AUTHOR_TAB_GROUPS: Array<{ title: string; items: AuthorTabDefinition[] }> = [
  {
    title: "工作台",
    items: [
      {
        key: "workspaces",
        label: "工作区",
        description: "规范库、工作流图、运行证据与 Trellis 状态",
        icon: <FolderOpenOutlined />,
      },
      { key: "agents", label: "智能体角色", description: "角色供给、职责和默认仓库", icon: <RobotOutlined /> },
      { key: "workflows", label: "工作流", description: "阶段派发、验收和工作流画布", icon: <BranchesOutlined /> },
    ],
  },
  {
    title: "生态",
    items: [
      {
        key: "my-extensions",
        label: "我的扩展",
        description: "全局或仓库级 MCP、技能、插件、Hooks 与脚本",
        icon: <AppstoreOutlined />,
      },
      { key: "extensions", label: "扩展市场", description: "本地扩展、远程索引和贡献能力", icon: <AppstoreAddOutlined /> },
      { key: "assistants", label: "助手模板", description: "角色模板、模型和系统提示词", icon: <UserOutlined /> },
      { key: "mcp", label: "MCP 工具", description: "服务器、推荐项和扩展工具协议", icon: <ApiOutlined /> },
      { key: "skills", label: "技能市场", description: "skills.sh、外部目录和扩展技能", icon: <ToolOutlined /> },
      {
        key: "claude-plugins",
        label: "插件市场",
        description: "精选 50+ 插件，一键安装 oh-my-claudecode 等",
        icon: <BlockOutlined />,
      },
      { key: "engine-registry", label: "执行环境", description: "本机 Claude Code 与预留运行入口", icon: <ThunderboltOutlined /> },
    ],
  },
  {
    title: "运行设置",
    items: [
      {
        key: "defaults",
        label: "默认配置",
        description: "主会话连接方式、右侧面板与顶栏工具显示",
        icon: <SlidersOutlined />,
      },
      { key: "automation", label: "定时自动化", description: "Cron、Mission 和会话续跑", icon: <FieldTimeOutlined /> },
      { key: "channels", label: "远程入口", description: "钉钉、飞书、企微和 Telegram", icon: <GatewayOutlined /> },
      { key: "claude-config", label: "引擎环境", description: "配置目录与 agents", icon: <FolderOpenOutlined /> },
      { key: "hooks", label: "触发器规则", description: "工具链事件、权限和自动化", icon: <ApartmentOutlined /> },
      { key: "shortcuts", label: "快捷键", description: "桌面操作和窗口控制", icon: <IconKeyboardShortcuts /> },
      { key: "sandbox", label: "Claude 沙箱", description: "权限、隔离和运行说明", icon: <IconClaudeSandboxHelp /> },
    ],
  },
];

export const AUTHOR_TABS: AuthorTabDefinition[] = [
  ...AUTHOR_TAB_GROUPS.flatMap((group) => group.items),
];

export function isAuthorPane(value: string): value is AuthorPane {
  return AUTHOR_TABS.some((item) => item.key === value);
}

export type { AuthorPane };

import {
  ApartmentOutlined,
  ApiOutlined,
  CompassOutlined,
  AppstoreAddOutlined,
  AppstoreOutlined,
  AuditOutlined,
  BranchesOutlined,
  FieldTimeOutlined,
  FileSearchOutlined,
  FolderOpenOutlined,
  GatewayOutlined,
  SlidersOutlined,
  SafetyCertificateOutlined,
  DeleteOutlined,
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
    title: "能力",
    items: [
      { key: "agents", label: "席位", description: "职责、默认仓库和派发目标", icon: <RobotOutlined /> },
      { key: "workflows", label: "工作流", description: "阶段派发、验收和工作流画布", icon: <BranchesOutlined /> },
      { key: "assistants", label: "助手模板", description: "角色模板、模型和系统提示词", icon: <UserOutlined /> },
      { key: "engine-registry", label: "执行环境", description: "本机 CLI 与 Agent 运行入口", icon: <ThunderboltOutlined /> },
      {
        key: "agents-explorer",
        label: "仓库智能体",
        description: "仓库 .agents 下的命令、技能与智能体",
        icon: <CompassOutlined />,
      },
      { key: "mcp", label: "MCP 工具", description: "服务器、推荐项和扩展工具协议", icon: <ApiOutlined /> },
      { key: "skills", label: "技能", description: "skills.sh、外部目录和扩展技能", icon: <ToolOutlined /> },
      {
        key: "my-extensions",
        label: "我的扩展",
        description: "全局或仓库级 MCP、技能、插件、钩子与脚本",
        icon: <AppstoreOutlined />,
      },
      { key: "extensions", label: "扩展市场", description: "本地扩展、远程索引和贡献能力", icon: <AppstoreAddOutlined /> },
      { key: "hooks", label: "钩子", description: "工具链事件、权限和自动化", icon: <ApartmentOutlined /> },
      {
        key: "claude-plugins",
        label: "插件",
        description: "精选插件与 oh-my-claudecode 等安装源",
        icon: <BlockOutlined />,
      },
    ],
  },
  {
    title: "自动化",
    items: [
      { key: "automation", label: "定时自动化", description: "Cron、Mission 和会话续跑", icon: <FieldTimeOutlined /> },
    ],
  },
  {
    title: "通道",
    items: [
      { key: "channels", label: "远程入口", description: "通知、回执与远程控制", icon: <GatewayOutlined /> },
    ],
  },
  {
    title: "产物",
    items: [
      {
        key: "artifacts",
        label: "产物检查台",
        description: "按仓库浏览 Markdown、Diff、图片、文档与代码",
        icon: <FileSearchOutlined />,
      },
    ],
  },
  {
    title: "运行",
    items: [
      {
        key: "defaults",
        label: "默认配置",
        description: "主会话连接方式、运行项、右侧面板与顶栏工具显示",
        icon: <SlidersOutlined />,
      },
      {
        key: "auto-approve",
        label: "自动批准",
        description: "全局或按仓库设置 Permission / 提问的自动通过策略",
        icon: <SafetyCertificateOutlined />,
      },
      {
        key: "code-review",
        label: "代码审查",
        description: "推送前门闸、默认范围、结果复用与过期标注策略",
        icon: <AuditOutlined />,
      },
      { key: "sandbox", label: "沙箱", description: "权限、隔离和运行说明", icon: <IconClaudeSandboxHelp /> },
      { key: "shortcuts", label: "快捷键", description: "桌面操作和窗口控制", icon: <IconKeyboardShortcuts /> },
      {
        key: "data-cleanup",
        label: "数据清理",
        description: "清理 ~/.wise 图片缓存、PRD 快照与子进程配置",
        icon: <DeleteOutlined />,
      },
    ],
  },
];

export const AUTHOR_TABS: AuthorTabDefinition[] = [
  // 「工作区」已从导航分组中移除，但保留为可路由 AuthorPane，
  // 以兼容深链跳转、isAuthorPane 校验与 AuthorPanel 路由分支。
  {
    key: "workspaces",
    label: "工作区",
    description: "规范库、工作流图、运行证据与 Trellis 状态",
    icon: <FolderOpenOutlined />,
  },
  ...AUTHOR_TAB_GROUPS.flatMap((group) => group.items),
];

export function isAuthorPane(value: string): value is AuthorPane {
  return AUTHOR_TABS.some((item) => item.key === value);
}

export type { AuthorPane };

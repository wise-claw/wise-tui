import {
  ApartmentOutlined,
  ApiOutlined,
  BranchesOutlined,
  CodeOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  RobotOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";
import type { AuthorPane } from "../../types/viewMode";

export interface AuthorTabDefinition {
  key: AuthorPane;
  label: string;
  icon: ReactNode;
}

export const AUTHOR_TAB_STORAGE_KEY = "wise.author.lastPane";

export const AUTHOR_TABS: AuthorTabDefinition[] = [
  { key: "workspaces", label: "Workspaces", icon: <FolderOpenOutlined /> },
  { key: "agents", label: "Agents", icon: <RobotOutlined /> },
  { key: "workflows", label: "Workflows", icon: <BranchesOutlined /> },
  { key: "mcp", label: "MCP", icon: <ApiOutlined /> },
  { key: "skills", label: "Skills", icon: <ToolOutlined /> },
  { key: "hooks", label: "Hooks", icon: <ApartmentOutlined /> },
  { key: "prompts", label: "Prompts", icon: <FileTextOutlined /> },
  { key: "trellis-spec", label: "Trellis Spec", icon: <CodeOutlined /> },
];

export function isAuthorPane(value: string): value is AuthorPane {
  return AUTHOR_TABS.some((item) => item.key === value);
}

export type { AuthorPane };

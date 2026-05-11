import type { Repository, TaskRole } from "../types";

export function defaultTaskRoleForRepositoryType(
  repositoryType: Repository["repositoryType"] | null | undefined,
): TaskRole {
  if (repositoryType === "backend") return "backend";
  if (repositoryType === "document") return "document";
  return "frontend";
}

export function repositoryTypeBadgeLetter(type: Repository["repositoryType"]): string {
  if (type === "frontend") return "前";
  if (type === "backend") return "后";
  return "文";
}

/** 从路径解析末段目录名（与后端 `repository_folder_label_from_path` 语义一致）。 */
export function repositoryFolderBasename(repository: Pick<Repository, "path" | "name">): string {
  const raw = repository.path.trim().replace(/\\/g, "/");
  const parts = raw.split("/").filter(Boolean);
  const tail = parts.length > 0 ? parts[parts.length - 1] : "";
  const fromPath = tail.trim();
  if (fromPath.length > 0) return fromPath;
  return repository.name.trim() || "未命名仓库";
}

/** 新建 Claude 标签时：主 Owner 为子代理时的 `repositoryName`（与 `…/员工:姓名` 规则一致）。 */
export function repositoryDisplayNameForMainOwnerAgent(
  repository: Pick<Repository, "path" | "name">,
  agentName: string,
): string {
  return `${repositoryFolderBasename(repository)}/员工:${agentName.trim()}`;
}

/** 侧栏「主会话」新建标签用的展示名：配置了主 Owner 智能体则为员工子标签名，否则为目录名。 */
export function repositorySessionTabDisplayName(
  repository: Pick<Repository, "path" | "name" | "mainOwnerAgentName">,
): string {
  const agent = repository.mainOwnerAgentName?.trim();
  if (agent) return repositoryDisplayNameForMainOwnerAgent(repository, agent);
  return repositoryFolderBasename(repository);
}

/**
 * 角标标题全文（用于提示等）：有角标标题用其文案；无则用角色默认字（前/后/文），
 * 不使用目录名或仓库名。
 */
export function repositoryIconBadgeDisplayText(
  repository: Pick<Repository, "repositoryType" | "iconDisplayName">,
): string {
  const custom = repository.iconDisplayName?.trim();
  if (custom && custom.length > 0) return custom;
  return repositoryTypeBadgeLetter(repository.repositoryType);
}

/** 侧栏圆形角标内仅展示的首字（取角标标题或角色默认文案的第一个字符）。 */
export function repositoryIconBadgeCircleLetter(
  repository: Pick<Repository, "repositoryType" | "iconDisplayName">,
): string {
  const source = repositoryIconBadgeDisplayText(repository);
  const chars = [...source];
  return chars[0] ?? "?";
}

export function repositoryTypeSolidBadgeColor(type: Repository["repositoryType"]): string {
  if (type === "frontend") return "#1677ff";
  if (type === "backend") return "#52c41a";
  return "#722ed1";
}

/** 新建仓库时可选的角标颜色预设（与类型默认色有重叠，便于快速点选）。 */
export const REPOSITORY_ICON_COLOR_PRESETS = [
  "#1677ff",
  "#52c41a",
  "#722ed1",
  "#fa8c16",
  "#eb2f96",
  "#13c2c2",
  "#faad14",
  "#2f54eb",
] as const;

export function resolveRepositoryIconColor(
  repositoryType: Repository["repositoryType"],
  iconColor: string | null | undefined,
): string {
  const trimmed = iconColor?.trim();
  if (trimmed) return trimmed;
  return repositoryTypeSolidBadgeColor(repositoryType);
}

export function repositoryTypeChineseLabel(type: Repository["repositoryType"]): string {
  if (type === "frontend") return "前端";
  if (type === "backend") return "后端";
  return "文档";
}

export function taskRoleChineseLabel(role: TaskRole): string {
  if (role === "frontend") return "前端";
  if (role === "backend") return "后端";
  return "文档";
}

export function taskRoleTagModifierClass(role: TaskRole): "is-frontend" | "is-backend" | "is-document" {
  if (role === "frontend") return "is-frontend";
  if (role === "backend") return "is-backend";
  return "is-document";
}

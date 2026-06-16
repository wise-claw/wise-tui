import type { Repository } from "../../types";
import {
  repositoryIconBadgeCircleLetter,
  repositoryIconBadgeDisplayText,
  resolveRepositoryIconColor,
} from "../../utils/repositoryType";

export function ProjectIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 2.5h12v2.5H2zM2 7h12v6.5H2z" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export function MoreIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="4" cy="8" r="1.2" fill="currentColor" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" />
      <circle cx="12" cy="8" r="1.2" fill="currentColor" />
    </svg>
  );
}

export function ExpandIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function RequirementIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        d="M4.25 2.25h6.3l2.2 2.2V13H4.25V2.25z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M10.55 2.25v2.2h2.2" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M5.35 7.35h5.3M5.35 9.35h5.3M5.35 11.35h3.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function TrellisIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path d="M3 2.5h10v3H3v-3zM3 10.5h10v3H3v-3z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M8 5.5v5M5.5 8h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function CodeGraphIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <circle cx="4" cy="4" r="1.35" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="12" cy="4" r="1.35" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="8" cy="12" r="1.35" stroke="currentColor" strokeWidth="1.1" />
      <path d="M5.1 4.8 6.9 11M10.9 4.8 9.1 11M5.35 4h5.3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

export function ScheduledTasksIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <circle cx="8" cy="8.5" r="5.25" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 5.75v3l2 1.15" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 2.5h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function ExecutableTasksIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5 8l2 2 4-4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 侧栏快捷入口：待办事项（类似 Apple 提醒列表） */
export function WorkspaceRemindersIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <circle cx="4.75" cy="4.75" r="1.35" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="4.75" cy="8" r="1.35" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="4.75" cy="11.25" r="1.35" stroke="currentColor" strokeWidth="1.1" />
      <path d="M7.25 4.75h5M7.25 8h5M7.25 11.25h3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function ChatIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        d="M3 4.5A1.5 1.5 0 0 1 4.5 3h7A1.5 1.5 0 0 1 13 4.5v5A1.5 1.5 0 0 1 11.5 11H7l-2.5 2V11h0A1.5 1.5 0 0 1 3 9.5v-5z"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );
}

export function McpNavIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        d="M3.5 5.5h3v5h-3v-5zm6 0h3v5h-3v-5zM5 3.5h6M5 12.5h6"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <circle cx="5" cy="8" r="0.9" fill="currentColor" />
      <circle cx="11" cy="8" r="0.9" fill="currentColor" />
    </svg>
  );
}

export function SkillsNavIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        d="M8 1.8 9.55 4.9l3.4.5-2.45 2.4.58 3.4L8 9.55 4.82 11.2l.58-3.4L2.95 5.4l3.4-.5L8 1.8z"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AutomationNavIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <circle cx="8" cy="8.5" r="5.25" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 5.75v3l2 1.15" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 2.5h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function AssistantNavIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <circle cx="8" cy="5.5" r="2.25" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M4 13c0-2.2 1.8-4 4-4s4 1.8 4 4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function PluginMarketNavIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        d="M3 3h4v4H3V3zm6 0h4v4H9V3zM3 9h4v4H3V9zm6 0h4v4H9V9z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 左栏「工作流」入口：与 Claude Code 团队编排画布语义一致 */
export function WorkflowStudioNavIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="2" y="2.5" width="4.5" height="3" rx="0.6" stroke="currentColor" strokeWidth="1.15" />
      <rect x="9.5" y="2.5" width="4.5" height="3" rx="0.6" stroke="currentColor" strokeWidth="1.15" />
      <rect x="5.75" y="10.5" width="4.5" height="3" rx="0.6" stroke="currentColor" strokeWidth="1.15" />
      <path d="M4.25 5.6v2.2h3.5v2.1M11.75 5.6v2.2h-3.5v2.1" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" />
    </svg>
  );
}

/** 默认配置（Sliders）— 左栏顶栏弹窗入口 */
export function IconDefaultConfig() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        d="M4 7h16M4 12h16M4 17h16"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <circle cx="9" cy="7" r="2" fill="currentColor" />
      <circle cx="15" cy="12" r="2" fill="currentColor" />
      <circle cx="11" cy="17" r="2" fill="currentColor" />
    </svg>
  );
}

export function RepositoryTypeIcon({ repository }: { repository: Repository }) {
  const full = repositoryIconBadgeDisplayText(repository);
  const letter = repositoryIconBadgeCircleLetter(repository);
  const badgeColor = resolveRepositoryIconColor(repository.repositoryType, repository.iconColor);
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <title>{full}</title>
      <circle cx="12" cy="12" r="10" fill={badgeColor} />
      <text
        x="12"
        y="12"
        dy="-1.75"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="12"
        fontWeight="700"
        fill="#ffffff"
      >
        {letter}
      </text>
    </svg>
  );
}

function RepositoryFolderOutlineIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        d="M4.5 7.25h6.1l1.6 1.85h7.3V18H4.5V7.25z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 左栏仓库行图标：全局默认可隐藏圆形角标，改为文件夹轮廓。 */
export function RepositorySidebarIcon({
  repository,
  showIconBadgeInWorkspaceList = false,
}: {
  repository: Repository;
  showIconBadgeInWorkspaceList?: boolean;
}) {
  if (!showIconBadgeInWorkspaceList) {
    return <RepositoryFolderOutlineIcon />;
  }
  return <RepositoryTypeIcon repository={repository} />;
}

/** 左栏底栏：Git 变更面板 */
export function GitBottomTabIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <circle cx="4.75" cy="4.75" r="1.35" stroke="currentColor" strokeWidth="1.15" />
      <circle cx="4.75" cy="11.25" r="1.35" stroke="currentColor" strokeWidth="1.15" />
      <circle cx="11.25" cy="8" r="1.35" stroke="currentColor" strokeWidth="1.15" />
      <path
        d="M4.75 6.1v3.3M4.75 4.75c0-1.38 1.12-2.5 2.5-2.5h1.25c1.38 0 2.5 1.12 2.5 2.5"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 左栏底栏：仓库文件树 */
export function FilesBottomTabIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        d="M2.75 4.25h4.1l1.15 1.65h5.25V12H2.75V4.25z"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinejoin="round"
      />
      <path d="M5.25 7.35h5.5M5.25 9.65h3.75" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" />
    </svg>
  );
}

export function RepoDragHandleIcon() {
  return (
    <svg viewBox="0 0 10 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <circle cx="3" cy="3" r="1.25" />
      <circle cx="7" cy="3" r="1.25" />
      <circle cx="3" cy="8" r="1.25" />
      <circle cx="7" cy="8" r="1.25" />
      <circle cx="3" cy="13" r="1.25" />
      <circle cx="7" cy="13" r="1.25" />
    </svg>
  );
}

export function OpenInEditorIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="2.5" y="4.5" width="7.5" height="7.5" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M8 3h4.5V7.5M7.25 8.75 12.5 3.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function OpenInTerminalIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4.5 6l2.5 2-2.5 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.5 11h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

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

export function CodeKnowledgeGraphNavIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <circle cx="4" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="12" cy="5" r="1.5" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="8" cy="12" r="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5.3 5.1l5.4-.2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4.8 5.4l2.4 5.2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M11.2 6.4l-2.4 4.2" stroke="currentColor" strokeWidth="1.2" />
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

export function IconCompactLayout() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="3.5" y="4" width="17" height="16" rx="2" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <rect x="12" y="11" width="8.5" height="8" rx="1.5" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
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

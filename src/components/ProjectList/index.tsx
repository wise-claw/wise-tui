import { Tooltip } from "antd";
import type { Repository } from "../../types";
import { repositoryFolderBasename } from "../../utils/repositoryType";
import "./index.css";

// ── SVG Icons ──

function GitFolderIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 7V5a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="15.5" cy="15" r="1.2" fill="currentColor" />
      <circle cx="15.5" cy="19.5" r="1.2" fill="currentColor" />
      <circle cx="19.5" cy="15" r="1.2" fill="currentColor" />
      <path d="M15.5 16.2v2.1" stroke="currentColor" strokeWidth="1.2" />
      <path d="M16.7 15h1.6" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M1 3.5C1 2.67 1.67 2 2.5 2H5.5L7 3.5H13.5C14.33 3.5 15 4.17 15 5V12.5C15 13.33 14.33 14 13.5 14H2.5C1.67 14 1 13.33 1 12.5V3.5Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
    </svg>
  );
}

function RemoveIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// ── Types ──

interface Props {
  repositories: Repository[];
  activeRepositoryId: number | null;
  onRepositoryClick: (repository: Repository) => void;
  onAddRepository: () => void;
  onExpandConversations: (repository: Repository) => void;
  onNewConversation: (repository: Repository) => void;
  onRemoveRepository: (repository: Repository) => void;
  onOpenInFinder: (repository: Repository) => void;
}

// ── Main Component ──

export function RepositoryList({
  repositories,
  activeRepositoryId,
  onRepositoryClick,
  onAddRepository,
  onExpandConversations,
  onNewConversation,
  onRemoveRepository,
  onOpenInFinder,
}: Props) {
  return (
    <div className="app-repository-list">
      {repositories.length === 0 ? (
        <div
          className="app-repository-item app-repository-item--add"
          onClick={onAddRepository}
        >
          <span className="app-repository-add-icon">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </span>
          <span className="app-repository-add-text">添加仓库</span>
        </div>
      ) : (
        repositories.map((repository) => (
          <div
            key={repository.id}
            className={`app-repository-item app-repository-item--repo${repository.id === activeRepositoryId ? " app-repository-item--repo-active" : ""}`}
            onClick={() => onRepositoryClick(repository)}
          >
            <span className="app-repository-icon-wrapper">
              <span className="app-repository-icon app-repository-icon--folder">
                <GitFolderIcon />
              </span>
              <span
                className="app-repository-icon app-repository-icon--expand"
                onClick={(e) => {
                  e.stopPropagation();
                  onExpandConversations(repository);
                }}
              >
                <ExpandIcon />
              </span>
            </span>
            <span className="app-repository-name">{repositoryFolderBasename(repository)}</span>
            <Tooltip title="打开目录" mouseEnterDelay={0.3}>
              <span
                className="app-repository-action"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenInFinder(repository);
                }}
              >
                <FolderIcon />
              </span>
            </Tooltip>
            <Tooltip title="移除" mouseEnterDelay={0.3}>
              <span
                className="app-repository-action app-repository-action--remove"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveRepository(repository);
                }}
              >
                <RemoveIcon />
              </span>
            </Tooltip>
            <Tooltip title="新增会话" mouseEnterDelay={0.3}>
              <span
                className="app-repository-action app-repository-action--plus"
                onClick={(e) => {
                  e.stopPropagation();
                  onNewConversation(repository);
                }}
              >
                <PlusIcon />
              </span>
            </Tooltip>
          </div>
        ))
      )}
    </div>
  );
}

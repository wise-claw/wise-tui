import type { ClaudeSession } from "../../types";
import { formatClaudeModelLabel } from "../../utils/claudeModel";
import { stripRedundantRepoBracketPrefix } from "../../utils/sessionRepositoryDisplay";

// ── SVG Icons ──

function IconClose() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

// ── ClaudeSessionTab ──

interface Props {
  session: ClaudeSession;
  isActive: boolean;
  onClick: () => void;
  onClose: () => void;
}

export function ClaudeSessionTab({ session, isActive, onClick, onClose }: Props) {
  const repo = session.repositoryName ?? "";
  const firstUserMsg = session.messages.find((m) => m.role === "user");
  const fromDisk = session.diskPreview?.trim();
  const rawSource = firstUserMsg
    ? stripRedundantRepoBracketPrefix(firstUserMsg.content, repo)
    : fromDisk
      ? stripRedundantRepoBracketPrefix(fromDisk, repo)
      : "新会话";
  const raw = rawSource.trim() || "新会话";
  const preview = raw.length > 40 ? `${raw.slice(0, 40)}...` : raw;

  const statusDot = session.status === "running"
    ? "app-claude-tab-status--running"
    : session.status === "completed"
      ? "app-claude-tab-status--completed"
      : session.status === "error"
        ? "app-claude-tab-status--error"
        : "";

  return (
    <div
      className={`app-claude-tab ${isActive ? "app-claude-tab--active" : ""}`}
      onClick={onClick}
    >
      <div className={`app-claude-tab-status-dot ${statusDot}`} />
      <div className="app-claude-tab-content">
        <span className="app-claude-tab-title">{preview}</span>
        <span className="app-claude-tab-model">{formatClaudeModelLabel(session.model)}</span>
      </div>
      <button
        className="app-claude-tab-close"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <IconClose />
      </button>
    </div>
  );
}

import { Button, Space, Tooltip } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { GitFileStatus } from "../../types";
import { setWiseRepositoryFileDragData } from "../../utils/repositoryFileDrag";
import { DiscardFilePopconfirm } from "./DiscardFilePopconfirm";
import { getStatusColor, getStatusSymbol, splitNameAndExt, splitPath } from "./gitPanelUtils";
import { RevertIcon } from "./RevertIcon";
import type { GitPanelOpenFileOptions } from "./types";

interface FileRowProps {
  file: GitFileStatus;
  section: "staged" | "unstaged";
  onStage?: (path: string) => void;
  onUnstage?: (path: string) => void;
  onDiscard?: (path: string) => void | Promise<void>;
  onOpenFile?: (path: string, options?: GitPanelOpenFileOptions) => void;
}

export function FileRow({
  file,
  section,
  onStage,
  onUnstage,
  onDiscard,
  onOpenFile,
}: FileRowProps) {
  const { name } = splitPath(file.path);
  const { base, ext } = splitNameAndExt(name);

  return (
    <div
      className={`git-file-row ${onOpenFile ? "git-file-row--clickable" : ""}`}
      draggable
      onDragStart={(e) => {
        e.stopPropagation();
        setWiseRepositoryFileDragData(e.dataTransfer, file.path);
      }}
      onClick={(e) => {
        if (!onOpenFile) {
          return;
        }
        if ((e.target as HTMLElement).closest(".git-file-actions")) {
          return;
        }
        onOpenFile(file.path, { fromGitChanges: section });
      }}
      role={onOpenFile ? "button" : undefined}
      tabIndex={onOpenFile ? 0 : -1}
      onKeyDown={(event) => {
        if (!onOpenFile) {
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenFile(file.path, { fromGitChanges: section });
        }
      }}
    >
      <span
        className="git-file-status-badge"
        style={{ color: getStatusColor(file.status) }}
      >
        {getStatusSymbol(file.status)}
      </span>
      <div className="git-file-info">
        <span className="git-file-name">
          {base}
          {ext && <span className="git-file-ext">.{ext}</span>}
        </span>
      </div>
      <div className="git-file-meta">
        <Space
          size={0}
          className="git-file-actions"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {section === "unstaged" && onStage && (
            <Tooltip title="暂存" placement="top">
              <Button
                type="text"
                size="small"
                icon={<PlusOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  onStage(file.path);
                }}
              />
            </Tooltip>
          )}
          {section === "staged" && onUnstage && (
            <Tooltip title="取消暂存" placement="top">
              <Button
                type="text"
                size="small"
                icon={<span style={{ fontSize: 12 }}>-</span>}
                onClick={(e) => {
                  e.stopPropagation();
                  onUnstage(file.path);
                }}
              />
            </Tooltip>
          )}
          {section === "unstaged" && onDiscard && (
            <DiscardFilePopconfirm
              filePath={file.path}
              onConfirm={() => onDiscard(file.path)}
            >
              <Tooltip title="放弃更改" placement="top">
                <Button
                  type="text"
                  size="small"
                  icon={<RevertIcon />}
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                />
              </Tooltip>
            </DiscardFilePopconfirm>
          )}
        </Space>
        <span className="git-file-counts">
          <span className="git-file-add">+{file.additions}</span>
          <span className="git-file-sep">/</span>
          <span className="git-file-del">-{file.deletions}</span>
        </span>
      </div>
    </div>
  );
}

import { memo } from "react";
import { Button, Space } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { GitFileStatus } from "../../types";
import { setWiseRepositoryFileDragData } from "../../utils/repositoryFileDrag";
import { DiscardFilePopconfirm } from "./DiscardFilePopconfirm";
import { getStatusColor, getStatusSymbol, splitNameAndExt, splitPath } from "./gitPanelUtils";
import { OpenFileIcon } from "./OpenFileIcon";
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

export const FileRow = memo(function FileRow({
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
          {onOpenFile && (
            <Button
              type="text"
              size="small"
              title="打开文件"
              aria-label="打开文件"
              icon={<OpenFileIcon />}
              onClick={(e) => {
                e.stopPropagation();
                onOpenFile(file.path);
              }}
            />
          )}
          {section === "unstaged" && onStage && (
            <Button
              type="text"
              size="small"
              title="暂存"
              aria-label="暂存"
              icon={<PlusOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                onStage(file.path);
              }}
            />
          )}
          {section === "staged" && onUnstage && (
            <Button
              type="text"
              size="small"
              title="取消暂存"
              aria-label="取消暂存"
              icon={<span style={{ fontSize: 12 }}>-</span>}
              onClick={(e) => {
                e.stopPropagation();
                onUnstage(file.path);
              }}
            />
          )}
          {section === "unstaged" && onDiscard && (
            <DiscardFilePopconfirm
              filePath={file.path}
              onConfirm={() => onDiscard(file.path)}
            >
              <Button
                type="text"
                size="small"
                title="放弃更改"
                aria-label="放弃更改"
                icon={<RevertIcon />}
                onClick={(e) => {
                  e.stopPropagation();
                }}
              />
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
});

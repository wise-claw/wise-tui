import { useEffect, useMemo, useState } from "react";
import { Drawer, Select } from "antd";
import { GraphMode } from "./GraphMode";
import type { GitPanelOpenFileOptions } from "./types";

export interface GitHistoryRepositoryOption {
  label: string;
  value: string;
}

interface GitHistoryDrawerProps {
  open: boolean;
  onClose: () => void;
  repositoryPath?: string | null;
  repositoryOptions?: GitHistoryRepositoryOption[];
  defaultRepositoryPath?: string;
  onOpenFile?: (path: string, options?: GitPanelOpenFileOptions) => void;
  onRepositoryRefresh?: () => void;
}

export function GitHistoryDrawer({
  open,
  onClose,
  repositoryPath,
  repositoryOptions,
  defaultRepositoryPath,
  onOpenFile,
  onRepositoryRefresh,
}: GitHistoryDrawerProps) {
  const initialPath = useMemo(() => {
    if (repositoryPath?.trim()) {
      return repositoryPath.trim();
    }
    if (defaultRepositoryPath?.trim()) {
      return defaultRepositoryPath.trim();
    }
    return repositoryOptions?.[0]?.value ?? "";
  }, [defaultRepositoryPath, repositoryOptions, repositoryPath]);

  const [selectedRepoPath, setSelectedRepoPath] = useState(initialPath);

  useEffect(() => {
    if (!open) {
      return;
    }
    setSelectedRepoPath(initialPath);
  }, [initialPath, open]);

  const activeRepositoryPath = repositoryPath?.trim() || selectedRepoPath;
  const showRepoPicker = !repositoryPath?.trim() && (repositoryOptions?.length ?? 0) > 1;

  return (
    <Drawer
      title="提交历史"
      placement="right"
      size={600}
      open={open}
      destroyOnHidden
      className="git-history-drawer"
      onClose={onClose}
    >
      {showRepoPicker ? (
        <div className="git-history-drawer__repo-picker">
          <Select
            size="small"
            className="git-graph-branch-filter"
            classNames={{ popup: { root: "git-graph-select-dropdown" } }}
            value={selectedRepoPath}
            options={repositoryOptions}
            popupMatchSelectWidth={false}
            onChange={(value) => setSelectedRepoPath(String(value))}
          />
        </div>
      ) : null}
      {activeRepositoryPath ? (
        <GraphMode
          repositoryPath={activeRepositoryPath}
          onOpenFile={onOpenFile}
          onRepositoryRefresh={onRepositoryRefresh}
        />
      ) : null}
    </Drawer>
  );
}

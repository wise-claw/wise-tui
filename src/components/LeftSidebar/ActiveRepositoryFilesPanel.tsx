import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { RepositoryFilesExplorer } from "../GitPanel/RepositoryFilesExplorer";
import type { GitPanelOpenFileOptions } from "../GitPanel/types";
import type { GitPanelWorkspaceSelectorProps } from "../GitPanel/GitPanelWorkspaceSelector";

import type { ExplorerRevealTarget } from "../../utils/explorerRevealTarget";

const EXPLORER_REVEAL_TARGET_BY_VARIANT: Record<
  NonNullable<ActiveRepositoryFilesPanelProps["variant"]>,
  ExplorerRevealTarget
> = {
  "left-sidebar": "left-sidebar",
  "right-rail": "right-rail",
  "workspace-rail": "workspace-rail",
};

interface ActiveRepositoryFilesPanelProps {
  activeRepositoryPath: string;
  activeRepositoryName?: string;
  search: string;
  onSearchChange: (value: string) => void;
  onOpenFile?: (path: string, options?: GitPanelOpenFileOptions) => void;
  sectionCollapsed: boolean;
  onSectionCollapsedChange?: (collapsed: boolean) => void;
  headerPrefix?: ReactNode;
  workspaceSelector?: Omit<GitPanelWorkspaceSelectorProps, "activeRepositoryPath">;
  /** 右栏 Inspector 内嵌时使用独立布局 class。 */
  variant?: "left-sidebar" | "right-rail" | "workspace-rail";
}

export const ActiveRepositoryFilesPanel = memo(function ActiveRepositoryFilesPanel({
  activeRepositoryPath,
  activeRepositoryName,
  search,
  onSearchChange,
  onOpenFile,
  sectionCollapsed,
  onSectionCollapsedChange,
  headerPrefix,
  workspaceSelector,
  variant = "left-sidebar",
}: ActiveRepositoryFilesPanelProps) {
  // 多 panel 并存时（split 模式可达 3 个 explorer 实例），用 IntersectionObserver
  // 检测本面板是否可见；隐藏态（父容器 hidden 属性 → display:none）时通知子树降级，
  // 跳过 git status 的 reactive 订阅与 hover，避免 N 倍渲染放大。默认可见（乐观），
  // 观察到不可见才降级，避免首次挂载延迟。
  const rootRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          setVisible(entry.isIntersecting);
        }
      },
      { threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const rootClassName =
    variant === "workspace-rail"
      ? "app-workspace-file-tree-rail-panel"
      : variant === "right-rail"
        ? "app-right-panel-files-explorer" +
          (sectionCollapsed ? " app-right-panel-files-explorer--section-collapsed" : "")
        : "app-left-sidebar-files-explorer" +
          (sectionCollapsed ? " app-left-sidebar-files-explorer--section-collapsed" : "");

  return (
    <div ref={rootRef} className={rootClassName}>
      <div
        className={
          variant === "workspace-rail"
            ? "app-workspace-file-tree-rail-panel-body"
            : variant === "right-rail"
              ? "app-right-panel-files-explorer-body"
              : "app-left-sidebar-files-explorer-body"
        }
      >
        <RepositoryFilesExplorer
          active={visible}
          headerPrefix={headerPrefix}
          repositoryPath={activeRepositoryPath}
          repositoryLabel={
            activeRepositoryName?.trim() ||
            activeRepositoryPath.split(/[/\\]/).filter(Boolean).pop() ||
            "资源管理器"
          }
          search={search}
          showSearchField={variant === "workspace-rail" ? true : !sectionCollapsed}
          onSearchChange={onSearchChange}
          onOpenFile={onOpenFile}
          onClearExplorerSearch={() => onSearchChange("")}
          sectionCollapsed={sectionCollapsed}
          onSectionCollapsedChange={
            variant === "workspace-rail" ? undefined : onSectionCollapsedChange
          }
          hideContextHeader={variant === "workspace-rail"}
          workspaceSelector={workspaceSelector}
          explorerRevealTarget={EXPLORER_REVEAL_TARGET_BY_VARIANT[variant]}
        />
      </div>
    </div>
  );
});

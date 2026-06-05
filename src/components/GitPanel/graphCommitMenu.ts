import type { MenuProps } from "antd";
import type { GitGraphCommit } from "../../types";

export interface GraphCommitMenuHandlers {
  onSelect: () => void;
  onCheckout: (revision: string) => void;
  onCherryPick: () => void;
  onRevert: () => void;
  onCreateBranch: () => void;
  onCreateTag: () => void;
  onReset: () => void;
  onSetCompareBase: () => void;
  onCompareWithBase: () => void;
  onCompareWithHead: () => void;
  onDeleteTag: (tagName: string) => void;
  onCopySha: () => void;
}

export function buildGraphCommitMenuItems(
  commit: GitGraphCommit,
  handlers: GraphCommitMenuHandlers,
  options: {
    canCompareWithBase: boolean;
    canCompareWithHead: boolean;
  },
): MenuProps["items"] {
  const checkoutBranches = commit.refs.filter(
    (ref) => ref.kind === "branch" && !ref.isHead,
  );
  const tagRefs = commit.refs.filter((ref) => ref.kind === "tag");

  return [
    { key: "detail", label: "查看详情", onClick: handlers.onSelect },
    { key: "checkout-commit", label: "检出此提交", onClick: () => handlers.onCheckout(commit.sha) },
    { key: "cherry-pick", label: "Cherry-pick", onClick: handlers.onCherryPick },
    { key: "revert", label: "Revert", danger: true, onClick: handlers.onRevert },
    { key: "create-branch", label: "创建分支", onClick: handlers.onCreateBranch },
    { key: "create-tag", label: "创建标签", onClick: handlers.onCreateTag },
    { key: "reset", label: "Reset 到此提交", danger: true, onClick: handlers.onReset },
    { type: "divider" as const },
    { key: "compare-base", label: "设为对比基准", onClick: handlers.onSetCompareBase },
    {
      key: "compare-with-base",
      label: "与基准对比",
      disabled: !options.canCompareWithBase,
      onClick: handlers.onCompareWithBase,
    },
    {
      key: "compare-with-head",
      label: "与 HEAD 对比",
      disabled: !options.canCompareWithHead,
      onClick: handlers.onCompareWithHead,
    },
    { type: "divider" as const },
    { key: "copy-sha", label: "复制 SHA", onClick: handlers.onCopySha },
    ...(tagRefs.length > 0 ? [{ type: "divider" as const }] : []),
    ...tagRefs.map((ref) => ({
      key: `delete-tag-${ref.name}`,
      label: `删除标签 ${ref.name}`,
      danger: true,
      onClick: () => handlers.onDeleteTag(ref.name),
    })),
    ...(checkoutBranches.length > 0 ? [{ type: "divider" as const }] : []),
    ...checkoutBranches.map((ref) => ({
      key: `branch-${ref.name}`,
      label: `检出 ${ref.name}`,
      onClick: () => handlers.onCheckout(ref.name),
    })),
  ];
}

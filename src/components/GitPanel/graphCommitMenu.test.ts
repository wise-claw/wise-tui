import { expect, mock, test } from "bun:test";
import type { GitGraphCommit } from "../../types";
import { buildGraphCommitMenuItems, type GraphCommitMenuHandlers } from "./graphCommitMenu";
import { getStatusColor, getStatusSymbol } from "./gitPanelUtils";

test("commit menu merges the selected commit without replacing checkout or cherry-pick", () => {
  const onMerge = mock(() => {});
  const noop = () => {};
  const handlers: GraphCommitMenuHandlers = {
    onMerge,
    onSelect: noop,
    onCheckout: noop,
    onCherryPick: noop,
    onRevert: noop,
    onCreateBranch: noop,
    onCreateTag: noop,
    onReset: noop,
    onSetCompareBase: noop,
    onCompareWithBase: noop,
    onCompareWithHead: noop,
    onDeleteTag: noop,
    onCopySha: noop,
  };
  const commit: GitGraphCommit = {
    sha: "abc123",
    summary: "feature",
    author: "Wise",
    timestamp: 1,
    parentShas: [],
    refs: [],
  };
  const items = buildGraphCommitMenuItems(commit, handlers, {
    canCompareWithBase: false,
    canCompareWithHead: true,
  })!;
  const merge = items.find((item) => item?.key === "merge");
  expect(merge && "label" in merge ? merge.label : null).toBe("合并到当前分支");
  if (merge && "onClick" in merge) merge.onClick?.({} as never);
  expect(onMerge).toHaveBeenCalledTimes(1);
  expect(items.some((item) => item?.key === "checkout-commit")).toBe(true);
  expect(items.some((item) => item?.key === "cherry-pick")).toBe(true);
});

test("conflicted files have a visible conflict status", () => {
  expect(getStatusSymbol("U")).toBe("U");
  expect(getStatusColor("U")).toBe("#ff4d4f");
});

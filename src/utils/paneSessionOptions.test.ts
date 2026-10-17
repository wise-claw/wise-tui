import { expect, test } from "bun:test";
import type { ClaudeSession } from "../types";
import { buildPaneSessionOptions, filterPaneSessionOptions } from "./paneSessionOptions";
import { assignCompanionSessionToPaneSlot } from "./multiPaneSlots";

const session = (id: string, createdAt: number, extra: Partial<ClaudeSession> = {}): ClaudeSession => ({ id, createdAt, claudeSessionId: null, repositoryPath: "/repo", repositoryName: "仓库", model: "", status: "idle", messages: [], pendingPrompt: "", ...extra });

test("会话按最近活跃排序，已在其他屏打开的会话不可重复选择", () => {
  const options = buildPaneSessionOptions([session("main", 1), session("free", 2), session("other", 3)], "main", [{ slotId: "pane", sessionId: "other", repositoryId: null }]);
  expect(options.map((item) => item.value)).toEqual(["other", "free", "main"]);
  expect(options.map((item) => item.disabled)).toEqual([true, false, true]);
});

test("会话标题不带仓库前缀，磁盘预览用于识别未加载的历史内容", () => {
  const options = buildPaneSessionOptions([session("a", 1, { threadName: "修复页面\n布局" }), session("b", 2, { repositoryName: "其他仓库", diskPreview: "继续任务" })], "main", []);
  expect(options.map((item) => item.label)).toEqual(["继续任务", "修复页面 布局"]);
});

test("继续已有会话时移除旧槽位的运行覆盖，避免切换已有会话的引擎", () => {
  const slot = { slotId: "pane", sessionId: "old", repositoryId: 1, executionEngine: "codex" as const };
  const rebound = assignCompanionSessionToPaneSlot(slot, "existing", 2);
  expect(rebound).toEqual({ slotId: "pane", sessionId: "existing", repositoryId: 2 });
  expect(slot.sessionId).toBe("old");
});


test("只显示当前仓库会话，排除同名其他仓库及子仓库，并支持切换仓库", () => {
  const options = buildPaneSessionOptions([
    session("a", 1, { repositoryPath: "/repo/a/" }),
    session("b", 2, { repositoryPath: "/repo/b" }),
    session("child", 3, { repositoryPath: "/repo/a/child" }),
  ], "main", []);
  expect(filterPaneSessionOptions(options, "/repo/a").map((option) => option.value)).toEqual(["a"]);
  expect(filterPaneSessionOptions(options, "/repo/b").map((option) => option.value)).toEqual(["b"]);
  expect(filterPaneSessionOptions(options, "")).toEqual([]);
});

test("多屏与侧栏使用相同标题、置顶和运行状态排序", () => {
  const sessions = [
    session("renamed", 1),
    session("running", 2, { status: "running" }),
    session("recent", 3),
  ];
  const preferences = { '["/repo","renamed"]': { title: "测试", pinned: true } };
  const options = buildPaneSessionOptions(sessions, "main", [], preferences);
  expect(options.map(({ value }) => value)).toEqual(["renamed", "running", "recent"]);
  expect(options[0].label).toBe("测试");
  const unpinned = buildPaneSessionOptions(sessions, "main", [], {
    '["/repo","renamed"]': { title: "已改名", pinned: false },
  });
  expect(unpinned.map(({ value }) => value)).toEqual(["running", "recent", "renamed"]);
  expect(unpinned[2].label).toBe("已改名");
});

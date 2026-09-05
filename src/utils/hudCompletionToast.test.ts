import { describe, expect, it } from "vitest";
import type { ClaudeMessage } from "../types";
import {
  beginHudToastLeave,
  collectHudSessionCompletions,
  EMPTY_HUD_TOAST_BOARD,
  enqueueHudCompletionToasts,
  formatHudCompletionToast,
  hudToastStackExtraHeight,
  parseHudCompletionToastPayload,
  removeHudToast,
  resolveHudToastMarqueeDurationSec,
  sessionStatusMap,
  HUD_TOAST_MARQUEE_PX_PER_SEC,
  HUD_TOAST_MARQUEE_TRAVEL_FRACTION,
  type HudCompletionToastItem,
} from "./hudCompletionToast";

function assistant(content: string): ClaudeMessage {
  return { id: 1, role: "assistant", content, parts: [], timestamp: 1 };
}

function toast(id: string): HudCompletionToastItem {
  return {
    id,
    sessionId: id,
    kind: "success",
    message: "已经完成，可以继续发任务。",
  };
}

describe("collectHudSessionCompletions", () => {
  it("emits success and error when busy sessions finish together", () => {
    const prev = sessionStatusMap([
      { id: "a", status: "running" },
      { id: "b", status: "connecting" },
      { id: "c", status: "running" },
    ]);
    const items = collectHudSessionCompletions(prev, [
      {
        id: "a",
        status: "completed",
        threadName: "修快捷键",
        repositoryName: "wise-tui",
        messages: [assistant("已经改成 Option+H")],
      },
      { id: "b", status: "error", threadName: "失败任务", repositoryName: "wise-tui" },
      { id: "c", status: "cancelled", threadName: "手动停", repositoryName: "wise-tui" },
    ]);
    expect(items.map((item) => item.sessionId)).toEqual(["a", "b"]);
    expect(items[0]).toMatchObject({
      kind: "success",
      message: "已经改成 Option+H",
    });
    expect(items[1]).toMatchObject({
      kind: "error",
      message: "这轮没跑通，可以再试一次。",
    });
  });

  it("ignores sessions that were never busy", () => {
    const prev = sessionStatusMap([{ id: "a", status: "idle" }]);
    expect(
      collectHudSessionCompletions(prev, [
        { id: "a", status: "completed", threadName: "旧会话", repositoryName: "demo" },
      ]),
    ).toEqual([]);
  });

  it("treats idle-after-running as success with fallback copy", () => {
    const prev = sessionStatusMap([{ id: "a", status: "running" }]);
    const items = collectHudSessionCompletions(prev, [
      { id: "a", status: "idle", threadName: "", repositoryName: "wise-tui" },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "success",
      message: "已经完成，可以继续发任务。",
    });
  });
});

describe("formatHudCompletionToast", () => {
  it("keeps the full assistant summary up to the toast cap", () => {
    const longText = "字".repeat(120);
    const item = formatHudCompletionToast({
      id: "s1",
      status: "completed",
      threadName: "很长的会话标题需要截断处理一下下下",
      repositoryName: "demo",
      messages: [assistant(longText)],
    });
    expect(item.message).toBe(longText);
    expect(item.message.length).toBe(120);
  });

  it("prefers the final assistant summary on error when available", () => {
    const item = formatHudCompletionToast({
      id: "s1",
      status: "error",
      messages: [assistant("连接中断，请检查网络后重试。")],
    });
    expect(item.message).toBe("连接中断，请检查网络后重试。");
  });

  it("does not put thinking text into the completion toast", () => {
    const item = formatHudCompletionToast({
      id: "s1",
      status: "completed",
      messages: [
        {
          id: 1,
          role: "assistant",
          content: "你好",
          parts: [
            { type: "reasoning", text: "用户持续问候，我将再次简短热情地回应。" },
            { type: "text", text: "你好" },
          ],
          timestamp: 1,
        },
      ],
    });
    expect(item.message).toBe("你好");
    expect(item.message).not.toContain("思考过程");
  });

  it("falls back when the assistant only thought", () => {
    const item = formatHudCompletionToast({
      id: "s1",
      status: "completed",
      messages: [
        {
          id: 1,
          role: "assistant",
          content: "",
          parts: [{ type: "reasoning", text: "用户持续问候，我将再次简短热情地回应。" }],
          timestamp: 1,
        },
      ],
    });
    expect(item.message).toBe("已经完成，可以继续发任务。");
  });
});

describe("resolveHudToastMarqueeDurationSec", () => {
  it("keeps a constant px/s so longer copy takes proportionally longer", () => {
    const short = resolveHudToastMarqueeDurationSec(80);
    const long = resolveHudToastMarqueeDurationSec(400);
    expect(short).toBe(80 / HUD_TOAST_MARQUEE_PX_PER_SEC / HUD_TOAST_MARQUEE_TRAVEL_FRACTION);
    expect(long).toBe(400 / HUD_TOAST_MARQUEE_PX_PER_SEC / HUD_TOAST_MARQUEE_TRAVEL_FRACTION);
    expect(long / short).toBeCloseTo(5, 5);
  });

  it("does not marquee tiny overflow", () => {
    expect(resolveHudToastMarqueeDurationSec(4)).toBe(0);
    expect(resolveHudToastMarqueeDurationSec(0)).toBe(0);
  });
});

describe("hud toast board", () => {
  it("shows three and queues the rest when many finish at once", () => {
    const board = enqueueHudCompletionToasts(EMPTY_HUD_TOAST_BOARD, [
      toast("1"),
      toast("2"),
      toast("3"),
      toast("4"),
      toast("5"),
    ]);
    expect(board.visible.map((item) => item.id)).toEqual(["1", "2", "3"]);
    expect(board.queued.map((item) => item.id)).toEqual(["4", "5"]);
  });

  it("refills from the queue after a toast leaves", () => {
    const started = enqueueHudCompletionToasts(EMPTY_HUD_TOAST_BOARD, [
      toast("1"),
      toast("2"),
      toast("3"),
      toast("4"),
    ]);
    const leaving = beginHudToastLeave(started, "1");
    expect(leaving.visible[0]?.phase).toBe("leaving");
    expect(leaving.queued.map((item) => item.id)).toEqual(["4"]);
    const next = removeHudToast(leaving, "1");
    expect(next.visible.map((item) => item.id)).toEqual(["2", "3", "4"]);
    expect(next.queued).toEqual([]);
  });
});

describe("hudToastStackExtraHeight", () => {
  it("grows by slot plus gap per rendered toast", () => {
    expect(hudToastStackExtraHeight(0)).toBe(0);
    expect(hudToastStackExtraHeight(1)).toBe(44);
    expect(hudToastStackExtraHeight(3)).toBe(132);
  });
});

describe("parseHudCompletionToastPayload", () => {
  it("keeps valid items and drops junk", () => {
    expect(
      parseHudCompletionToastPayload({
        items: [
          {
            id: " a1 ",
            sessionId: " sess ",
            kind: "success",
            message: "搞定了",
          },
          { id: "x", sessionId: "y", kind: "nope", message: "m" },
          null,
        ],
      }),
    ).toEqual([
      {
        id: "a1",
        sessionId: "sess",
        kind: "success",
        message: "搞定了",
      },
    ]);
    expect(parseHudCompletionToastPayload(null)).toEqual([]);
    expect(parseHudCompletionToastPayload({ items: "nope" })).toEqual([]);
  });
});

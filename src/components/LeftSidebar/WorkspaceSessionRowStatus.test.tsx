import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  resolveWorkspaceSessionStickyVisual,
  WorkspaceSessionRowStatus,
} from "./WorkspaceSessionRowStatus";

describe("resolveWorkspaceSessionStickyVisual", () => {
  test("maps running family to running", () => {
    expect(resolveWorkspaceSessionStickyVisual("running")).toBe("running");
    expect(resolveWorkspaceSessionStickyVisual("connecting")).toBe("running");
    expect(resolveWorkspaceSessionStickyVisual("in_progress")).toBe("running");
  });

  test("maps completed and error family", () => {
    expect(resolveWorkspaceSessionStickyVisual("completed")).toBe("completed");
    expect(resolveWorkspaceSessionStickyVisual("error")).toBe("error");
    expect(resolveWorkspaceSessionStickyVisual("cancelled")).toBe("error");
    expect(resolveWorkspaceSessionStickyVisual("failed")).toBe("error");
  });

  test("idle has no sticky visual (latched completed handled by hook until next run)", () => {
    expect(resolveWorkspaceSessionStickyVisual("idle")).toBeNull();
  });
});

describe("WorkspaceSessionRowStatus", () => {
  test("completed icon uses filled checkmark visuals", () => {
    const html = renderToStaticMarkup(<WorkspaceSessionRowStatus status="completed" />);
    expect(html).toContain("app-workspace-session-status--completed");
    expect(html).toContain("app-workspace-session-status__fill--completed");
    expect(html).toContain("app-workspace-session-status__check");
    expect(html).toContain("app-workspace-session-status__ripple");
    expect(html).toContain("已完成");
  });

  test("running icon uses spinner arc", () => {
    const html = renderToStaticMarkup(<WorkspaceSessionRowStatus status="running" />);
    expect(html).toContain("app-workspace-session-status__svg--spin");
    expect(html).toContain("app-workspace-session-status__arc");
    expect(html).toContain("运行中");
  });
});

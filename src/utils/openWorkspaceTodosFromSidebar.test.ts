import { describe, expect, test } from "bun:test";
import { WISE_WORKSPACE_TODOS_OPEN, type WorkspaceTodosOpenDetail } from "../constants/workspaceTodosEvents";
import { openWorkspaceTodosFromSidebarMenu } from "./openWorkspaceTodosFromSidebar";

describe("openWorkspaceTodosFromSidebarMenu", () => {
  test("dispatches modal surface for sidebar more menu", () => {
    const captured: WorkspaceTodosOpenDetail[] = [];
    const g = globalThis as typeof globalThis & { window?: Window };
    const prevWindow = g.window;
    g.window = {
      dispatchEvent: (event: Event) => {
        captured.push((event as CustomEvent<WorkspaceTodosOpenDetail>).detail);
        return true;
      },
    } as Window;

    try {
      openWorkspaceTodosFromSidebarMenu();
      expect(captured).toHaveLength(1);
      expect(captured[0]?.surface).toBe("modal");
      expect(captured[0]?.focusAdd).toBe(true);
      expect(WISE_WORKSPACE_TODOS_OPEN).toBe("wise:workspace-todos-open");
    } finally {
      g.window = prevWindow;
    }
  });
});

import { describe, expect, test } from "bun:test";
import { buildProjectRepositoryMoreMenuItems } from "./sidebarMoreMenuItems";

function menuLabels(items: ReturnType<typeof buildProjectRepositoryMoreMenuItems>): string[] {
  const labels: string[] = [];
  for (const item of items ?? []) {
    if (!item || typeof item !== "object") continue;
    if ("type" in item && item.type === "divider") continue;
    if ("label" in item && typeof item.label === "string") labels.push(item.label);
    if ("children" in item && Array.isArray(item.children)) {
      for (const child of item.children) {
        if (child && typeof child === "object" && "label" in child && typeof child.label === "string") {
          labels.push(child.label);
        }
      }
    }
  }
  return labels;
}

describe("buildProjectRepositoryMoreMenuItems", () => {
  test("includes run control even when chat quick action is hidden in multi-repo workspace", () => {
    const labels = menuLabels(
      buildProjectRepositoryMoreMenuItems({
        onConfigureSddMode: true,
        onMainSessionRun: true,
        runCommandRunning: false,
      }),
    );
    expect(labels).toContain("运行");
  });

  test("run submenu includes configure, start, and stop", () => {
    const labels = menuLabels(
      buildProjectRepositoryMoreMenuItems({
        onMainSessionRun: true,
        runCommandRunning: false,
      }),
    );
    expect(labels).toContain("运行");
    expect(labels).toContain("配置");
    expect(labels).toContain("启动");
    expect(labels).toContain("停止");
  });

  test("run submenu still present when main session is running", () => {
    const labels = menuLabels(
      buildProjectRepositoryMoreMenuItems({
        onMainSessionRun: true,
        runCommandRunning: true,
      }),
    );
    expect(labels).toContain("运行");
    expect(labels).toContain("停止");
    expect(labels).not.toContain("停止运行");
  });
});

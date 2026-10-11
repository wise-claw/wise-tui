import { expect, test } from "bun:test";
import { App } from "antd";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import { AppUpdateAutoCheck } from "./useAppUpdateAutoCheck";

test("更新检查位于工作台现有 Provider 内，通知 API 支持安全清理", () => {
  function Probe() {
    const { notification, modal } = App.useApp();
    expect(typeof notification.info).toBe("function");
    expect(typeof notification.destroy).toBe("function");
    expect(typeof modal.info).toBe("function");
    expect(() => notification.destroy("wise-app-update")).not.toThrow();
    return null;
  }
  expect(() => renderToString(<App><AppUpdateAutoCheck /><Probe /></App>)).not.toThrow();
  // 回归根因：父组件不能使用由子工作台提供的 Context。
  const layout = readFileSync(new URL("../components/AppWorkspaceLayout.tsx", import.meta.url), "utf8");
  expect(layout).toMatch(/<AntdApp>\s*<AppUpdateAutoCheck\s*\/>/);
  const root = readFileSync(new URL("../AppImpl.tsx", import.meta.url), "utf8");
  expect(root).not.toContain("useAppUpdateAutoCheck()");
});

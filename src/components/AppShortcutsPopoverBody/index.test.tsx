import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AppShortcutsPopoverBody } from ".";

describe("AppShortcutsPopoverBody", () => {
  test("renders the shortcut command list", () => {
    const html = renderToStaticMarkup(<AppShortcutsPopoverBody density="default" />);

    expect(html).toContain("app-shortcuts-popover--page");
    expect(html).toContain("快捷键命令清单");
    expect(html).toContain("F3");
    expect(html).toContain("⌘K · Ctrl+K");
  });

  test("keeps the compact mode available for legacy popover surfaces", () => {
    const html = renderToStaticMarkup(<AppShortcutsPopoverBody density="compact" />);

    expect(html).toContain("app-shortcuts-popover--compact");
    expect(html).toContain("F3");
  });
});

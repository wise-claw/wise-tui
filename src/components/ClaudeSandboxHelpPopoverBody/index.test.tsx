import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ClaudeSandboxHelpPopoverBody } from ".";

describe("ClaudeSandboxHelpPopoverBody", () => {
  test("renders permission and OS sandbox guidance", () => {
    const html = renderToStaticMarkup(<ClaudeSandboxHelpPopoverBody />);

    expect(html).toContain("运行边界");
    expect(html).toContain("bypassPermissions");
    expect(html).toContain("sandbox.excludedCommands");
  });
});

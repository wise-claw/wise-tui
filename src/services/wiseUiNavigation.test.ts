import { describe, expect, test } from "bun:test";
import { buildWiseAuthorLink, parseWiseUiHref } from "./wiseUiNavigation";

describe("wiseUiNavigation", () => {
  test("builds and parses author plugin hub links", () => {
    const href = buildWiseAuthorLink("claude-plugins", { tab: "installed" });
    expect(href).toBe("wise://author/claude-plugins?tab=installed");
    expect(parseWiseUiHref(href)).toEqual({
      kind: "author",
      pane: "claude-plugins",
      query: { tab: "installed" },
    });
  });

  test("rejects unknown author panes", () => {
    expect(parseWiseUiHref("wise://author/not-a-pane")).toBeNull();
  });
});

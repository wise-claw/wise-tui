import { describe, expect, test } from "bun:test";
import {
  buildOpenAppConfigureMenuChildren,
  OPEN_APP_MENU_KEY_DEFAULT,
  parseOpenAppConfigureMenuKey,
  repositoryEditorOpenMenuLabel,
  resolveEffectiveOpenAppId,
} from "./openAppScope";

describe("openAppScope", () => {
  test("resolveEffectiveOpenAppId prefers scoped override", () => {
    expect(resolveEffectiveOpenAppId("cursor")).toBe("cursor");
    expect(resolveEffectiveOpenAppId(null)).toBeTruthy();
  });

  test("repositoryEditorOpenMenuLabel reflects scoped target", () => {
    expect(repositoryEditorOpenMenuLabel("intellij")).toBe("在 IntelliJ IDEA 中打开");
  });

  test("parseOpenAppConfigureMenuKey handles default and scoped ids", () => {
    expect(parseOpenAppConfigureMenuKey(OPEN_APP_MENU_KEY_DEFAULT)).toBeNull();
    expect(parseOpenAppConfigureMenuKey("open-app-cursor")).toBe("cursor");
    expect(parseOpenAppConfigureMenuKey("editor")).toBeUndefined();
  });

  test("buildOpenAppConfigureMenuChildren includes follow-global option", () => {
    const children = buildOpenAppConfigureMenuChildren("cursor");
    expect(children[0]?.key).toBe(OPEN_APP_MENU_KEY_DEFAULT);
    expect(children.some((item) => item.label.includes("Cursor"))).toBe(true);
  });
});

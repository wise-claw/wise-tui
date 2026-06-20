import { describe, expect, test } from "bun:test";
import {
  LEGACY_MULTI_PANE_LAYOUT_STATE_STORAGE_KEY,
  multiPaneLayoutStorageKey,
  resolveCurrentMultiPaneLayoutStorageKey,
} from "./multiPaneLayoutStorage";

describe("multiPaneLayoutStorageKey", () => {
  test("scopes layout state by sanitized window label", () => {
    expect(multiPaneLayoutStorageKey("main")).toBe(
      "wise.mainLayout.multiPaneState.v1:main",
    );
    expect(multiPaneLayoutStorageKey("main-dock-123")).toBe(
      "wise.mainLayout.multiPaneState.v1:main-dock-123",
    );
  });

  test("resolveCurrentMultiPaneLayoutStorageKey falls back to main", () => {
    expect(resolveCurrentMultiPaneLayoutStorageKey(null)).toBe(
      "wise.mainLayout.multiPaneState.v1:main",
    );
    expect(resolveCurrentMultiPaneLayoutStorageKey("main-dock-abc")).toBe(
      "wise.mainLayout.multiPaneState.v1:main-dock-abc",
    );
  });

  test("legacy global key is distinct from per-window keys", () => {
    expect(LEGACY_MULTI_PANE_LAYOUT_STATE_STORAGE_KEY).toBe(
      "wise.mainLayout.multiPaneState.v1",
    );
    expect(multiPaneLayoutStorageKey("main")).not.toBe(
      LEGACY_MULTI_PANE_LAYOUT_STATE_STORAGE_KEY,
    );
  });
});

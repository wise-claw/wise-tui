import { describe, expect, test } from "bun:test";
import { resolveRepositoryDirToggleIntent } from "./repositoryExplorerToggle";

describe("resolveRepositoryDirToggleIntent", () => {
  test("loads children when session expanded but not yet fetched", () => {
    expect(
      resolveRepositoryDirToggleIntent({ isExpanded: true, childrenLoaded: false }),
    ).toBe("load-children-only");
  });

  test("expands and loads when collapsed", () => {
    expect(
      resolveRepositoryDirToggleIntent({ isExpanded: false, childrenLoaded: false }),
    ).toBe("expand-and-load");
  });

  test("collapses when expanded with children", () => {
    expect(
      resolveRepositoryDirToggleIntent({ isExpanded: true, childrenLoaded: true }),
    ).toBe("collapse");
  });
});

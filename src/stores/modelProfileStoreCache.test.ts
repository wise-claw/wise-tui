import { describe, expect, test } from "bun:test";
import type { ClaudeModelProfileStoreView } from "../types/claudeModelProfile";
import {
  getCachedModelProfileStore,
  isCachedModelProfileAutoFailoverEnabled,
  seedModelProfileStoreCache,
} from "./modelProfileStoreCache";

function minimalStore(autoFailoverEnabled?: boolean): ClaudeModelProfileStoreView {
  return {
    profiles: [],
    activeProfileId: null,
    activeCodexProfileId: null,
    activeOpencodeProfileId: null,
    autoFailoverEnabled,
    effectiveModel: null,
    effectiveCodexModel: null,
    effectiveOpencodeModel: null,
  };
}

describe("modelProfileStoreCache", () => {
  test("defaults auto failover to enabled when cache empty", () => {
    seedModelProfileStoreCache(null);
    expect(isCachedModelProfileAutoFailoverEnabled()).toBe(true);
    expect(getCachedModelProfileStore()).toBeNull();
  });

  test("reflects disabled auto failover from seeded store", () => {
    seedModelProfileStoreCache(minimalStore(false));
    expect(isCachedModelProfileAutoFailoverEnabled()).toBe(false);
    expect(getCachedModelProfileStore()?.autoFailoverEnabled).toBe(false);
  });
});

import { describe, expect, test } from "bun:test";
import {
  getRepositoryRunCommandRowPinnedMapSnapshot,
  resetRepositoryRunCommandRowPinnedStoreForTests,
  setRepositoryRunCommandRowPinnedMapSnapshotForTests,
  subscribeRepositoryRunCommandRowPinnedMap,
} from "./repositoryRunCommandRowPinnedStore";

describe("repositoryRunCommandRowPinnedStore", () => {
  test("notifies subscribers when snapshot changes", () => {
    resetRepositoryRunCommandRowPinnedStoreForTests();
    setRepositoryRunCommandRowPinnedMapSnapshotForTests({});
    let revision = 0;
    const unsub = subscribeRepositoryRunCommandRowPinnedMap(() => {
      revision += 1;
    });

    setRepositoryRunCommandRowPinnedMapSnapshotForTests({ 42: true });
    expect(getRepositoryRunCommandRowPinnedMapSnapshot()[42]).toBe(true);
    expect(revision).toBe(1);

    unsub();
  });
});

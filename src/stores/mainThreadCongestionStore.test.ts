import { describe, expect, test } from "bun:test";
import {
  isMainThreadCongested,
  resetMainThreadCongestionStoreForTests,
} from "./mainThreadCongestionStore";

describe("mainThreadCongestionStore", () => {
  test("starts uncongested", () => {
    resetMainThreadCongestionStoreForTests();
    expect(isMainThreadCongested()).toBe(false);
  });
});

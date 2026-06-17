import { describe, expect, test } from "bun:test";
import {
  isBackgroundContextCompactInFlight,
  resetBackgroundContextCompactStoreForTests,
  setBackgroundContextCompactInFlight,
} from "./backgroundContextCompactStore";

describe("backgroundContextCompactStore", () => {
  test("tracks in-flight session ids", () => {
    resetBackgroundContextCompactStoreForTests();
    expect(isBackgroundContextCompactInFlight("tab-1")).toBe(false);
    setBackgroundContextCompactInFlight("tab-1", true);
    expect(isBackgroundContextCompactInFlight("tab-1")).toBe(true);
    setBackgroundContextCompactInFlight("tab-1", false);
    expect(isBackgroundContextCompactInFlight("tab-1")).toBe(false);
  });
});

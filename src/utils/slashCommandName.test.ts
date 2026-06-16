import { describe, expect, test } from "bun:test";
import { isSlashCommandName } from "./slashCommandName";

describe("isSlashCommandName", () => {
  test("accepts colon namespaced commands", () => {
    expect(isSlashCommandName("loom:init")).toBe(true);
    expect(isSlashCommandName("foo:bar:baz")).toBe(true);
  });

  test("rejects empty or invalid names", () => {
    expect(isSlashCommandName("")).toBe(false);
    expect(isSlashCommandName(":init")).toBe(false);
    expect(isSlashCommandName("loom/init")).toBe(false);
  });
});

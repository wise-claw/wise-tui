import { describe, expect, test } from "bun:test";
import {
  buildComposerAtPathMentionsInsertion,
  detectAtSlashTrigger,
  replaceSlashCommandLine,
  reportAtSlashTriggerFromPlain,
} from "./composer-plain-utils";
import type { TriggerInfo } from "./slash-trigger";

function collectTrigger(plain: string, cursor: number): TriggerInfo {
  let trigger: TriggerInfo = { mode: null, query: "", rect: null };
  reportAtSlashTriggerFromPlain(plain, cursor, (next) => {
    trigger = next;
  }, null);
  return trigger;
}

describe("reportAtSlashTriggerFromPlain", () => {
  test("slash at line start still works", () => {
    expect(collectTrigger("/autopilot", 11)).toEqual({
      mode: "slash",
      query: "autopilot",
      rect: null,
    });
  });

  test("slash after inline text triggers", () => {
    expect(collectTrigger("sds/", 4)).toEqual({ mode: "slash", query: "", rect: null });
    expect(collectTrigger("请先 /aut", 8)).toEqual({
      mode: "slash",
      query: "aut",
      rect: null,
    });
  });

  test("at after inline text triggers", () => {
    expect(collectTrigger("sds@", 4)).toEqual({ mode: "at", query: "", rect: null });
    expect(collectTrigger("hello @foo", 10)).toEqual({
      mode: "at",
      query: "foo",
      rect: null,
    });
  });

  test("does not treat URL path segments as slash commands", () => {
    expect(collectTrigger("see http://example.com", 24)).toEqual({
      mode: null,
      query: "",
      rect: null,
    });
    expect(collectTrigger("path/to/file", 13)).toEqual({
      mode: null,
      query: "",
      rect: null,
    });
  });

  test("does not treat @ file path slash as slash command", () => {
    expect(collectTrigger("@src/App.tsx ", 13)).toEqual({
      mode: null,
      query: "",
      rect: null,
    });
    expect(collectTrigger("@src/App.tsx /compact", 21)).toEqual({
      mode: "slash",
      query: "compact",
      rect: null,
    });
  });

  test("at wins over slash when both could match at cursor", () => {
    expect(collectTrigger("@/", 2)).toEqual({ mode: "at", query: "/", rect: null });
  });
});

describe("detectAtSlashTrigger", () => {
  test("returns triggerStart at @ character", () => {
    expect(detectAtSlashTrigger("hello @foo", 10)).toEqual({
      mode: "at",
      query: "foo",
      triggerStart: 6,
    });
    expect(detectAtSlashTrigger("@", 1)).toEqual({
      mode: "at",
      query: "",
      triggerStart: 0,
    });
  });

  test("returns triggerStart at / for slash mode", () => {
    expect(detectAtSlashTrigger("/autopilot", 11)).toEqual({
      mode: "slash",
      query: "autopilot",
      triggerStart: 0,
    });
    expect(detectAtSlashTrigger("请先 /aut", 8)).toEqual({
      mode: "slash",
      query: "aut",
      triggerStart: 3,
    });
    expect(detectAtSlashTrigger("/plugin install", 15)).toEqual({
      mode: "slash",
      query: "plugin install",
      triggerStart: 0,
    });
    expect(detectAtSlashTrigger("/plugin ins", 12)).toEqual({
      mode: "slash",
      query: "plugin ins",
      triggerStart: 0,
    });
    expect(detectAtSlashTrigger("/loom:init", 11)).toEqual({
      mode: "slash",
      query: "loom:init",
      triggerStart: 0,
    });
    expect(detectAtSlashTrigger("/loom:", 6)).toEqual({
      mode: "slash",
      query: "loom:",
      triggerStart: 0,
    });
  });
});

describe("replaceSlashCommandLine", () => {
  test("replaces inline slash token", () => {
    expect(replaceSlashCommandLine("sds/aut", 7, "autopilot")).toEqual({
      plain: "sds/autopilot ",
      cursor: 14,
    });
  });

  test("replaces multi-word plugin slash token", () => {
    expect(
      replaceSlashCommandLine("/plugin ins", 12, "plugin install oh-my-claudecode@omc"),
    ).toEqual({
      plain: "/plugin install oh-my-claudecode@omc ",
      cursor: 37,
    });
  });
});

describe("buildComposerAtPathMentionsInsertion", () => {
  test("inserts @path with trailing space so @ trigger stays closed", () => {
    const built = buildComposerAtPathMentionsInsertion("", 0, ["src/App.tsx"]);
    expect(built).toEqual({
      insertion: "@src/App.tsx ",
      nextPlain: "@src/App.tsx ",
      nextCursor: 13,
    });
    expect(detectAtSlashTrigger(built!.nextPlain, built!.nextCursor)).toBeNull();
  });

  test("batches multiple paths and adds leading space after existing text", () => {
    const built = buildComposerAtPathMentionsInsertion("please", 6, ["a.ts", "b/dir"]);
    expect(built).toEqual({
      insertion: " @a.ts @b/dir ",
      nextPlain: "please @a.ts @b/dir ",
      nextCursor: 20,
    });
    expect(detectAtSlashTrigger(built!.nextPlain, built!.nextCursor)).toBeNull();
  });

  test("returns null for empty paths", () => {
    expect(buildComposerAtPathMentionsInsertion("x", 1, ["  ", ""])).toBeNull();
  });
});

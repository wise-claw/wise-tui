import { describe, expect, test } from "bun:test";
import {
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

  test("at wins over slash when both could match at cursor", () => {
    expect(collectTrigger("@/", 2)).toEqual({ mode: "at", query: "/", rect: null });
  });
});

describe("replaceSlashCommandLine", () => {
  test("replaces inline slash token", () => {
    expect(replaceSlashCommandLine("sds/aut", 7, "autopilot")).toEqual({
      plain: "sds/autopilot ",
      cursor: 14,
    });
  });
});

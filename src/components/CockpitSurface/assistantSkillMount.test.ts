import { describe, expect, test } from "bun:test";
import type { ScannedSkill } from "../../services/skills";
import {
  addSkillMount,
  filterSkillMountCandidates,
  removeSkillMount,
  scannedSkillToMountCandidate,
} from "./assistantSkillMount";

const scanned: ScannedSkill = {
  name: "officecli-docx",
  location: "/skills/officecli-docx",
  isSymlink: false,
  hasSkillMd: true,
  source: "builtin",
};

describe("assistantSkillMount", () => {
  test("converts scanned skill into assistant bundle candidate", () => {
    expect(scannedSkillToMountCandidate(scanned)).toEqual({
      id: "officecli-docx",
      label: "officecli-docx",
      sourcePath: "/skills/officecli-docx",
      origin: "builtin",
      hasSkillMd: true,
    });
  });

  test("adds skill mount with dedupe and enables it", () => {
    const candidate = scannedSkillToMountCandidate(scanned);
    const bundle = addSkillMount(
      {
        disabled: ["officecli-docx"],
        custom: [{ id: "old", label: "Old", origin: "custom", sourcePath: "/skills/old" }],
      },
      candidate,
    );

    expect(bundle.disabled).toEqual([]);
    expect(bundle.custom.map((item) => item.id)).toEqual(["old", "officecli-docx"]);

    const again = addSkillMount(bundle, candidate);
    expect(again.custom.filter((item) => item.id === "officecli-docx")).toHaveLength(1);
  });

  test("removes mounted skill and clears disabled reference", () => {
    const bundle = removeSkillMount(
      {
        disabled: ["officecli-docx"],
        custom: [
          { id: "officecli-docx", label: "DOCX", origin: "builtin", sourcePath: "/skills/docx" },
          { id: "officecli-pptx", label: "PPTX", origin: "builtin", sourcePath: "/skills/pptx" },
        ],
      },
      "officecli-docx",
    );

    expect(bundle.disabled).toEqual([]);
    expect(bundle.custom.map((item) => item.id)).toEqual(["officecli-pptx"]);
  });

  test("filters candidates by id label or path", () => {
    const candidates = [
      scannedSkillToMountCandidate(scanned),
      {
        id: "reviewer",
        label: "Reviewer",
        sourcePath: "/other/reviewer",
        origin: "custom",
        hasSkillMd: true,
      },
    ];

    expect(filterSkillMountCandidates(candidates, "docx").map((item) => item.id)).toEqual([
      "officecli-docx",
    ]);
    expect(filterSkillMountCandidates(candidates, "OTHER").map((item) => item.id)).toEqual([
      "reviewer",
    ]);
  });
});

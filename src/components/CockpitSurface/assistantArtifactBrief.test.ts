import { describe, expect, test } from "bun:test";
import {
  assistantRefsToBundleItems,
  buildArtifactAssistantBrief,
  getEnabledBundleItems,
} from "./assistantArtifactBrief";

describe("assistantArtifactBrief", () => {
  test("converts assistant refs to runtime bundle items", () => {
    expect(
      assistantRefsToBundleItems([
        { id: "officecli-docx", label: "OfficeCLI DOCX", sourcePath: "/skills/docx" },
      ]),
    ).toEqual([
      {
        id: "officecli-docx",
        label: "OfficeCLI DOCX",
        origin: "builtin",
        sourcePath: "/skills/docx",
      },
    ]);
  });

  test("filters disabled bundle items", () => {
    expect(
      getEnabledBundleItems({
        disabled: ["officecli-docx"],
        custom: [
          { id: "officecli-docx", label: "DOCX", origin: "builtin" },
          { id: "review", label: "Review", origin: "custom", sourcePath: "/skills/review" },
        ],
      }).map((item) => item.id),
    ).toEqual(["review"]);
  });

  test("builds execution brief with skills and format profile", () => {
    const brief = buildArtifactAssistantBrief({
      assistant: {
        id: "builtin:ppt-deck",
        name: "PPT 演示助手",
        description: "创建 PPT",
        engineId: "claude",
      },
      activeProjectName: "Demo Workspace",
      userRequest: "做一份融资路演。",
      engineering: { formatProfile: "深色高对比,每页一个核心观点。" },
      enabledSkills: [
        {
          id: "officecli-pptx",
          label: "OfficeCLI PPTX",
          origin: "builtin",
          sourcePath: "/skills/pptx",
        },
      ],
      enabledMcps: [],
    });

    expect(brief).toContain("# PPT 演示助手 执行 Brief");
    expect(brief).toContain("做一份融资路演。");
    expect(brief).toContain("- officecli-pptx (OfficeCLI PPTX) - /skills/pptx");
    expect(brief).toContain("必须使用 `officecli-pptx`");
    expect(brief).toContain("`.pptx`");
    expect(brief).toContain("深色高对比,每页一个核心观点。");
    expect(brief).toContain("Demo Workspace");
  });

  test("adds DOCX requirements for Word assistants", () => {
    const brief = buildArtifactAssistantBrief({
      assistant: {
        id: "builtin:word-doc",
        name: "Word 文档助手",
        description: "创建 Word",
        engineId: "claude",
      },
      activeProjectName: "Demo Workspace",
      userRequest: "整理成项目周报。",
      engineering: {},
      enabledSkills: [
        {
          id: "officecli-docx",
          label: "OfficeCLI DOCX",
          origin: "builtin",
          sourcePath: "/skills/docx",
        },
      ],
      enabledMcps: [],
    });

    expect(brief).toContain("必须使用 `officecli-docx`");
    expect(brief).toContain("`.docx`");
  });
});

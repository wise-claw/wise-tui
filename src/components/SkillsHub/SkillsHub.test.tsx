import { describe, expect, mock, test } from "bun:test";
import { App as AntApp } from "antd";
import { renderToStaticMarkup } from "react-dom/server";
import { SkillsHub } from "./SkillsHub";

mock.module("../../services/claude", () => ({
  listClaudeProjectSkills: mock(async () => [{ name: "review" }]),
  listClaudeUserSkills: mock(async () => []),
}));

mock.module("../../services/skills", () => ({
  addExternalSkillPath: mock(async () => ({
    id: "custom",
    path: "/skills/custom",
    exists: true,
    count: 1,
    isDefault: false,
  })),
  deleteImportedSkill: mock(async () => undefined),
  detectExternalSkillPaths: mock(async () => [
    {
      id: null,
      path: "/Users/test/.claude/skills",
      exists: true,
      count: 2,
      isDefault: true,
    },
  ]),
  importSkillCopy: mock(async () => ({ name: "review", location: "/skills/review", isSymlink: false })),
  importSkillSymlink: mock(async () => ({ name: "review", location: "/skills/review", isSymlink: true })),
  removeExternalSkillPath: mock(async () => undefined),
  scanSkillPath: mock(async () => []),
}));

mock.module("../../services/extensions", () => ({
  getExtensionSkills: mock(async () => [
    {
      id: "writer.skill.polish",
      extension: "writer-kit",
      name: "润色",
      description: "改写文本",
      location: "/ext/writer/skills/polish",
    },
  ]),
}));

mock.module("../../services/skillsSh", () => ({
  skillsCliAddFromRegistry: mock(async () => "ok"),
  skillsCliRemoveFromRegistry: mock(async () => "ok"),
  skillsShSearch: mock(async () => ({ query: "re", searchType: "skill", skills: [], count: 0 })),
}));

describe("SkillsHub", () => {
  test("renders the skill source segments", () => {
    const html = renderToStaticMarkup(
      <AntApp>
        <SkillsHub repositoryPath="/repo/wise" />
      </AntApp>,
    );

    expect(html).toContain("技能市场");
    expect(html).toContain("公开目录");
    expect(html).toContain("本机外部");
    expect(html).toContain("扩展贡献");
    expect(html).toContain("同步安装态");
  });
});

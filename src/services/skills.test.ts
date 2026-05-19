import { beforeEach, describe, expect, mock, test } from "bun:test";

const invokeMock = mock<(cmd: string, args?: unknown) => Promise<unknown>>(async () => undefined);
mock.module("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  // Other exports kept as no-op stubs so this mock doesn't break tests that
  // share the bun process and reach for unrelated parts of the module.
  transformCallback: () => 0,
  Channel: class {},
  PluginListener: class {},
  addPluginListener: async () => ({ id: 0 }),
  convertFileSrc: (s: string) => s,
}));

import {
  addExternalSkillPath,
  deleteImportedSkill,
  detectExternalSkillPaths,
  exportSkillSymlink,
  getWiseSkillsHome,
  importSkillCopy,
  importSkillSymlink,
  listExternalSkillPaths,
  readSkillInstruction,
  removeExternalSkillPath,
  scanSkillPath,
} from "./skills";

beforeEach(() => {
  invokeMock.mockReset();
});

describe("skills service", () => {
  test("detectExternalSkillPaths calls skills_detect_external_paths", async () => {
    invokeMock.mockResolvedValueOnce([]);
    await detectExternalSkillPaths();
    expect(invokeMock).toHaveBeenCalledWith("skills_detect_external_paths");
  });

  test("scanSkillPath wraps path arg", async () => {
    invokeMock.mockResolvedValueOnce([]);
    await scanSkillPath("/tmp/skills");
    expect(invokeMock).toHaveBeenCalledWith("skills_scan_path", {
      arg: { path: "/tmp/skills" },
    });
  });

  test("readSkillInstruction wraps id and sourcePath", async () => {
    invokeMock.mockResolvedValueOnce({ id: "officecli-docx", sourcePath: "/skills/docx", skillPath: "/skills/docx/SKILL.md", content: "# Skill" });
    await readSkillInstruction("officecli-docx", "/skills/docx");
    expect(invokeMock).toHaveBeenCalledWith("skills_read_instruction", {
      arg: { id: "officecli-docx", sourcePath: "/skills/docx" },
    });
  });

  test("addExternalSkillPath wraps path arg", async () => {
    invokeMock.mockResolvedValueOnce({});
    await addExternalSkillPath("/tmp/skills");
    expect(invokeMock).toHaveBeenCalledWith("skills_add_external_path", {
      arg: { path: "/tmp/skills" },
    });
  });

  test("removeExternalSkillPath wraps id arg", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await removeExternalSkillPath("abc");
    expect(invokeMock).toHaveBeenCalledWith("skills_remove_external_path", {
      arg: { id: "abc" },
    });
  });

  test("listExternalSkillPaths calls skills_list_external_paths", async () => {
    invokeMock.mockResolvedValueOnce([]);
    await listExternalSkillPaths();
    expect(invokeMock).toHaveBeenCalledWith("skills_list_external_paths");
  });

  test("importSkillCopy wraps sourcePath in camelCase", async () => {
    invokeMock.mockResolvedValueOnce({});
    await importSkillCopy("/src/foo");
    expect(invokeMock).toHaveBeenCalledWith("skills_import_copy", {
      arg: { sourcePath: "/src/foo" },
    });
  });

  test("importSkillSymlink wraps sourcePath", async () => {
    invokeMock.mockResolvedValueOnce({});
    await importSkillSymlink("/src/foo");
    expect(invokeMock).toHaveBeenCalledWith("skills_import_symlink", {
      arg: { sourcePath: "/src/foo" },
    });
  });

  test("deleteImportedSkill wraps name", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await deleteImportedSkill("foo");
    expect(invokeMock).toHaveBeenCalledWith("skills_delete_imported", {
      arg: { name: "foo" },
    });
  });

  test("exportSkillSymlink wraps both args", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await exportSkillSymlink("/src/foo", "/dest/foo");
    expect(invokeMock).toHaveBeenCalledWith("skills_export_symlink", {
      arg: { sourcePath: "/src/foo", destPath: "/dest/foo" },
    });
  });

  test("getWiseSkillsHome calls skills_wise_home", async () => {
    invokeMock.mockResolvedValueOnce(null);
    await getWiseSkillsHome();
    expect(invokeMock).toHaveBeenCalledWith("skills_wise_home");
  });
});

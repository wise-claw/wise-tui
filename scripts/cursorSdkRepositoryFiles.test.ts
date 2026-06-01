import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeRepositoryFiles } from "./cursorSdkRepositoryFiles.ts";

describe("probeRepositoryFiles", () => {
  test("detects missing demo.html and verifies write probe", () => {
    const dir = mkdtempSync(join(tmpdir(), "wise-repo-files-"));
    try {
      writeFileSync(join(dir, "package.json"), '{"name":"probe"}', "utf8");
      const result = probeRepositoryFiles({
        repositoryPath: dir,
        targetRelativePath: "public/demo.html",
      });
      expect(result.targetExists).toBe(false);
      expect(result.repositoryWriteOk).toBe(true);
      expect(result.writeProbeVerified).toBe(true);
      expect(existsSync(join(dir, "public/demo.html"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

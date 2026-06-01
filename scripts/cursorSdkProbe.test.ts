import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  probeRepositoryReadAccess,
  probeRepositoryWriteAccess,
  probeSdkPackageInstalled,
  probeSubprocessFilesystem,
  runCursorSdkDeepProbe,
} from "./cursorSdkProbe.ts";

describe("cursorSdkProbe", () => {
  test("probeSubprocessFilesystem succeeds in normal environment", () => {
    expect(probeSubprocessFilesystem().ok).toBe(true);
  });

  test("probeSdkPackageInstalled finds Wise workspace package", () => {
    const root = join(import.meta.dir, "..");
    expect(probeSdkPackageInstalled(root).ok).toBe(true);
  });

  test("probeRepositoryReadAccess reads package.json in temp repo", () => {
    const dir = mkdtempSync(join(tmpdir(), "wise-probe-repo-"));
    try {
      writeFileSync(join(dir, "package.json"), '{"name":"probe"}', "utf8");
      expect(probeRepositoryReadAccess(dir).ok).toBe(true);
      expect(probeRepositoryWriteAccess(dir).ok).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("runCursorSdkDeepProbe aggregates repository failure", () => {
    const root = join(import.meta.dir, "..");
    const result = runCursorSdkDeepProbe({
      sdkRoot: root,
      repositoryPath: "/nonexistent/wise-probe-repo",
    });
    expect(result.sdkPackageOk).toBe(true);
    expect(result.repositoryAccessOk).toBe(false);
    expect(result.repositoryWriteOk).toBe(false);
    expect(result.toolsAvailable).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

import { accessSync, constants, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type CursorSdkDeepProbeResult = {
  toolsAvailable: boolean;
  filesystemOk: boolean;
  sdkPackageOk: boolean;
  repositoryAccessOk: boolean | null;
  repositoryWriteOk: boolean | null;
  errors: string[];
};

function pushError(errors: string[], message: string): void {
  if (!errors.includes(message)) errors.push(message);
}

export function probeSdkPackageInstalled(sdkRoot: string): { ok: boolean; error?: string } {
  const root = sdkRoot.trim();
  if (!root) {
    return { ok: false, error: "sdkRoot 为空" };
  }
  const pkgDir = join(root, "node_modules", "@cursor", "sdk");
  try {
    accessSync(pkgDir, constants.R_OK);
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: `未在 ${root} 找到 node_modules/@cursor/sdk（安装包需设置 WISE_CURSOR_SDK_ROOT 或保留 Wise 源码目录）`,
    };
  }
}

export function probeSubprocessFilesystem(): { ok: boolean; error?: string } {
  const probeFile = join(tmpdir(), `wise-cursor-probe-${process.pid}.txt`);
  try {
    writeFileSync(probeFile, "ok", "utf8");
    const text = readFileSync(probeFile, "utf8");
    unlinkSync(probeFile);
    if (text !== "ok") {
      return { ok: false, error: "临时文件读写校验失败" };
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: `子进程无法读写临时目录（可为 Wise 开启「完全磁盘访问权限」）: ${message}`,
    };
  }
}

export function probeRepositoryReadAccess(repositoryPath: string): { ok: boolean; error?: string } {
  const root = repositoryPath.trim();
  if (!root) return { ok: true };
  try {
    accessSync(root, constants.R_OK);
    readFileSync(join(root, "package.json"), "utf8");
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: `无法从子进程读取仓库 ${root}（macOS 请为 Wise 开启完全磁盘访问权限）: ${message}`,
    };
  }
}

export function probeRepositoryWriteAccess(repositoryPath: string): { ok: boolean; error?: string } {
  const root = repositoryPath.trim();
  if (!root) return { ok: true };
  const probeFile = join(root, ".wise-cursor-write-probe");
  try {
    accessSync(root, constants.W_OK);
    writeFileSync(probeFile, "ok", "utf8");
    const text = readFileSync(probeFile, "utf8");
    unlinkSync(probeFile);
    if (text !== "ok") {
      return { ok: false, error: `仓库写入校验失败: ${root}` };
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: `无法从子进程写入仓库 ${root}（macOS 请为 Wise 开启完全磁盘访问权限）: ${message}`,
    };
  }
}

export function runCursorSdkDeepProbe(params: {
  sdkRoot: string;
  repositoryPath?: string;
}): CursorSdkDeepProbeResult {
  const errors: string[] = [];

  const fsProbe = probeSubprocessFilesystem();
  if (!fsProbe.ok && fsProbe.error) pushError(errors, fsProbe.error);

  const pkgProbe = probeSdkPackageInstalled(params.sdkRoot);
  if (!pkgProbe.ok && pkgProbe.error) pushError(errors, pkgProbe.error);

  const repoPath = params.repositoryPath?.trim() ?? "";
  let repositoryAccessOk: boolean | null = null;
  let repositoryWriteOk: boolean | null = null;
  if (repoPath) {
    const repoProbe = probeRepositoryReadAccess(repoPath);
    repositoryAccessOk = repoProbe.ok;
    if (!repoProbe.ok && repoProbe.error) pushError(errors, repoProbe.error);

    const writeProbe = probeRepositoryWriteAccess(repoPath);
    repositoryWriteOk = writeProbe.ok;
    if (!writeProbe.ok && writeProbe.error) pushError(errors, writeProbe.error);
  }

  const toolsAvailable =
    fsProbe.ok &&
    pkgProbe.ok &&
    (repositoryAccessOk === null || repositoryAccessOk === true) &&
    (repositoryWriteOk === null || repositoryWriteOk === true);

  return {
    toolsAvailable,
    filesystemOk: fsProbe.ok,
    sdkPackageOk: pkgProbe.ok,
    repositoryAccessOk,
    repositoryWriteOk,
    errors,
  };
}

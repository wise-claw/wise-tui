import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { probeRepositoryReadAccess, probeRepositoryWriteAccess } from "./cursorSdkProbe.ts";

export type RepositoryFilesProbeResult = {
  repositoryPath: string;
  targetRelativePath: string;
  targetExists: boolean;
  targetSizeBytes: number | null;
  targetPreview: string | null;
  repositoryReadOk: boolean;
  repositoryWriteOk: boolean;
  writeProbeRelativePath: string;
  writeProbeVerified: boolean;
  errors: string[];
};

export function probeRepositoryFiles(params: {
  repositoryPath: string;
  targetRelativePath?: string;
}): RepositoryFilesProbeResult {
  const repositoryPath = params.repositoryPath.trim();
  const targetRelativePath = (params.targetRelativePath ?? "public/demo.html").trim();
  const errors: string[] = [];
  const targetAbs = join(repositoryPath, targetRelativePath);

  let targetExists = false;
  let targetSizeBytes: number | null = null;
  let targetPreview: string | null = null;

  if (existsSync(targetAbs)) {
    try {
      const stat = statSync(targetAbs);
      targetExists = true;
      targetSizeBytes = stat.size;
      if (stat.isFile()) {
        const raw = readFileSync(targetAbs, "utf8");
        targetPreview = raw.length > 240 ? `${raw.slice(0, 240)}…` : raw;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`读取 ${targetRelativePath} 失败: ${message}`);
    }
  }

  const readProbe = probeRepositoryReadAccess(repositoryPath);
  if (!readProbe.ok && readProbe.error) errors.push(readProbe.error);

  const writeProbe = probeRepositoryWriteAccess(repositoryPath);
  if (!writeProbe.ok && writeProbe.error) errors.push(writeProbe.error);

  const writeProbeRelativePath = `public/.wise-cursor-write-probe-${process.pid}.txt`;
  let writeProbeVerified = false;
  try {
    const probeAbs = join(repositoryPath, writeProbeRelativePath);
    mkdirSync(dirname(probeAbs), { recursive: true });
    writeFileSync(probeAbs, "wise-ok", "utf8");
    const text = readFileSync(probeAbs, "utf8");
    unlinkSync(probeAbs);
    writeProbeVerified = text === "wise-ok";
    if (!writeProbeVerified) {
      errors.push(`写入探针校验失败: ${writeProbeRelativePath}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`无法写入 ${writeProbeRelativePath}: ${message}`);
  }

  return {
    repositoryPath,
    targetRelativePath,
    targetExists,
    targetSizeBytes,
    targetPreview,
    repositoryReadOk: readProbe.ok,
    repositoryWriteOk: writeProbe.ok && writeProbeVerified,
    writeProbeRelativePath,
    writeProbeVerified,
    errors,
  };
}

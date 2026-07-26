import type { CodeReviewFinding, CodeReviewRun } from "../types/codeReview";

export type CodeReviewFindingsSnapshot = {
  repositoryPath: string;
  runId: string;
  findings: CodeReviewFinding[];
  updatedAtMs: number;
  /** Full last published run (for reopening drawer from editor glyphs). */
  run: CodeReviewRun;
  /** True when live diff fingerprint no longer matches the published run. */
  stale: boolean;
  lastCheckedFingerprint?: string | null;
};

export type CodeReviewFindingSeverityCounts = {
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
  highOrCritical: number;
};

type Listener = () => void;

const snapshotsByRepo = new Map<string, CodeReviewFindingsSnapshot>();
const listeners = new Set<Listener>();

function normalizeRepoPath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/\/+$/, "");
}

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function countCodeReviewFindingSeverities(
  findings: ReadonlyArray<{ severity: string }>,
): CodeReviewFindingSeverityCounts {
  const counts: CodeReviewFindingSeverityCounts = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    total: findings.length,
    highOrCritical: 0,
  };
  for (const finding of findings) {
    switch (finding.severity) {
      case "CRITICAL":
        counts.critical += 1;
        counts.highOrCritical += 1;
        break;
      case "HIGH":
        counts.high += 1;
        counts.highOrCritical += 1;
        break;
      case "MEDIUM":
        counts.medium += 1;
        break;
      default:
        counts.low += 1;
        break;
    }
  }
  return counts;
}

export function publishCodeReviewFindings(run: CodeReviewRun): void {
  const repositoryPath = normalizeRepoPath(run.repositoryPath);
  if (!repositoryPath) return;
  snapshotsByRepo.set(repositoryPath, {
    repositoryPath,
    runId: run.id,
    findings: run.findings.filter((finding) => finding.path.trim().length > 0),
    updatedAtMs: Date.now(),
    run,
    stale: false,
    lastCheckedFingerprint: run.diffFingerprint ?? null,
  });
  emit();
}

export function clearCodeReviewFindings(repositoryPath: string): void {
  const key = normalizeRepoPath(repositoryPath);
  if (!key) return;
  if (!snapshotsByRepo.delete(key)) return;
  emit();
}

/**
 * Mark findings stale when the live diff fingerprint diverges from the published run.
 */
export function syncCodeReviewFindingsFreshness(
  repositoryPath: string,
  currentFingerprint: string,
): void {
  const key = normalizeRepoPath(repositoryPath);
  if (!key) return;
  const snap = snapshotsByRepo.get(key);
  if (!snap) return;

  const published = snap.run.diffFingerprint?.trim() ?? "";
  const current = currentFingerprint.trim();
  const stale = !published || !current || published !== current;
  if (
    snap.stale === stale &&
    (snap.lastCheckedFingerprint ?? null) === (current || null)
  ) {
    return;
  }

  snapshotsByRepo.set(key, {
    ...snap,
    stale,
    lastCheckedFingerprint: current || null,
    updatedAtMs: Date.now(),
  });
  emit();
}

export function getCodeReviewFindingsSnapshot(
  repositoryPath: string,
): CodeReviewFindingsSnapshot | null {
  const key = normalizeRepoPath(repositoryPath);
  if (!key) return null;
  return snapshotsByRepo.get(key) ?? null;
}

export function getCodeReviewFindingsForFile(
  repositoryPath: string,
  relativePath: string,
): CodeReviewFinding[] {
  const snapshot = getCodeReviewFindingsSnapshot(repositoryPath);
  if (!snapshot) return [];
  const norm = relativePath.trim().replace(/\\/g, "/");
  if (!norm) return [];
  return snapshot.findings.filter((finding) => finding.path.replace(/\\/g, "/") === norm);
}

export function subscribeCodeReviewFindings(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

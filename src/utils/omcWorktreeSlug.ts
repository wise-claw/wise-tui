/**
 * OMC 批量 worktree：目录名与分支名（须与 `src-tauri` 中 `omc_batch_worktree_slug_hex` / `git_worktree_add_omc_batch` 一致）。
 */

const FNV_OFFSET = 14695981039346656037n;
const FNV_PRIME = 1099511628211n;
const U64_MASK = 0xffff_ffff_ffff_ffffn;

function fnv1aHash64Utf8Bytes(enc: Uint8Array): bigint {
  let h = FNV_OFFSET;
  for (let i = 0; i < enc.length; i += 1) {
    h ^= BigInt(enc[i]);
    h = (h * FNV_PRIME) & U64_MASK;
  }
  return h;
}

function u64RotateLeft(v: bigint, bits: number): bigint {
  const b = BigInt(bits) & 63n;
  const x = v & U64_MASK;
  return ((x << b) | (x >> (64n - b))) & U64_MASK;
}

function attemptToLeI64Bytes(attempt: number): Uint8Array {
  const floored = Number.isFinite(attempt) ? Math.floor(attempt) : 0;
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setBigInt64(0, BigInt.asIntN(64, BigInt(floored)), true);
  return new Uint8Array(buf);
}

/** 与 Rust `omc_batch_worktree_slug_hex` 同源（FNV-1a + attempt 小端字节 + 混合）。 */
export function omcBatchWorktreeSlugHash(taskId: string, attempt: number): bigint {
  let h = fnv1aHash64Utf8Bytes(new TextEncoder().encode(taskId));
  h ^= fnv1aHash64Utf8Bytes(attemptToLeI64Bytes(attempt));
  h = u64RotateLeft(h, 13);
  h = (h * FNV_PRIME) & U64_MASK;
  h ^= h >> 33n;
  return h & U64_MASK;
}

/** 10 位小写十六进制，用作 `wise-worktrees/<slug>` 目录名与 `wise/o/<slug>` 分支末段。 */
export function omcWorktreeSlugHex(taskId: string, attempt: number): string {
  const h = omcBatchWorktreeSlugHash(taskId, attempt);
  return (h & 0xffffffffffn).toString(16).padStart(10, "0");
}

export function omcWorktreeBranchNameHint(taskId: string, attempt: number): string {
  return `wise/o/${omcWorktreeSlugHex(taskId, attempt)}`;
}

export function omcWorktreeRelativeDirHint(taskId: string, attempt: number): string {
  return `../wise-worktrees/${omcWorktreeSlugHex(taskId, attempt)}`;
}

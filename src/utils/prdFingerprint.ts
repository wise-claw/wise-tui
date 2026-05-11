/**
 * 对 PRD 原文做稳定指纹（FNV-1a 32-bit），用于进化日志聚类分析。
 * 非加密用途，仅用于本地统计与追踪。
 */
export function computePrdFingerprint(raw: string): string {
  const normalized = raw.replace(/\r\n/g, "\n").trim();
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

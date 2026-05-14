/**
 * Requirements index v2 helpers — 计算稳定哈希用于 diff replay。
 *
 * 不依赖 Node `crypto`（前端运行在 Tauri webview 内）；使用 FNV-1a 64-bit 同步计算，
 * 对 UTF-8 字节流处理，结果固定 16 位 hex，足以唯一标识本工具的需求体。
 */

const FNV_OFFSET_64 = BigInt("0xcbf29ce484222325");
const FNV_PRIME_64 = BigInt("0x100000001b3");
const MASK_64 = BigInt("0xffffffffffffffff");

/** UTF-8 字节流 FNV-1a 64 位哈希，输出 16 位定长 hex。 */
export function fnv1a64Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let h = FNV_OFFSET_64;
  for (let i = 0; i < bytes.length; i++) {
    h ^= BigInt(bytes[i]);
    h = (h * FNV_PRIME_64) & MASK_64;
  }
  return h.toString(16).padStart(16, "0");
}

/** 把 requirement.content 折叠为可比较的稳定文本（去前后空白，统一行末）。 */
export function normalizeRequirementContent(content: string): string {
  return content.replace(/\r\n/g, "\n").trim();
}

export function computeBodyHash(content: string): string {
  return fnv1a64Hex(normalizeRequirementContent(content));
}

export interface RequirementIndexEntryV2 {
  id: string;
  content: string;
  bodyHash: string;
}

export interface RequirementsIndexV2 {
  schemaVersion: 2;
  version: string;
  requirements: RequirementIndexEntryV2[];
}

export interface RequirementsIndexRawV1 {
  schemaVersion?: 1;
  version?: string;
  requirements: Array<{ id: string; content: string; bodyHash?: string }>;
}

/** 给定 entries 计算整体 version：按 id 排序后 (id,bodyHash) 串接的 FNV-1a。 */
export function computeIndexVersion(entries: RequirementIndexEntryV2[]): string {
  const sorted = [...entries].sort((a, b) => a.id.localeCompare(b.id));
  const joined = sorted.map((e) => `${e.id}:${e.bodyHash}`).join("|");
  return fnv1a64Hex(joined);
}

/** 把 v1 index（无 version / bodyHash）升级到 v2；已是 v2 时原样返回（重算 hash 以兜底）。 */
export function upgradeRequirementsIndex(
  input: RequirementsIndexRawV1 | RequirementsIndexV2,
): RequirementsIndexV2 {
  const requirements: RequirementIndexEntryV2[] = input.requirements.map((r) => ({
    id: r.id,
    content: r.content,
    bodyHash: r.bodyHash && /^[0-9a-f]{16}$/i.test(r.bodyHash)
      ? r.bodyHash
      : computeBodyHash(r.content),
  }));
  const version = computeIndexVersion(requirements);
  return {
    schemaVersion: 2,
    version,
    requirements,
  };
}

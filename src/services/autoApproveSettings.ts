import {
  getAppSetting,
  setAppSetting,
  deleteAppSetting,
} from "./appSettingsStore";
import {
  normalizeAutoApproveMode,
  type AutoApproveMode,
} from "../utils/autoApproveDecide";

/** 全局默认（最低优先级）。 */
const GLOBAL_KEY = "auto_approve_mode";

/**
 * 仓库覆盖（最高优先级）。
 *
 * 用 repositoryPath（而非 repositoryId）作为副 key，原因：
 * - useClaudeSessions 在运行时只能拿到 session.repositoryPath，无 ID 反查表。
 * - app_setting 的 key 上限 256 字符，绝对路径足够容纳。
 * - path 是用户可读的，dump app_setting 调试时一眼能看明白。
 */
const REPO_KEY_PREFIX = "auto_approve_mode:repo:";

/** 仓库级覆盖语义：`inherit` 表示「跟随全局默认」（不覆盖）。 */
export type RepoAutoApproveOverride = AutoApproveMode | "inherit";

/**
 * 写入端在变更后广播；读取端可订阅以失效本地缓存或触发重渲染。
 *
 * 仅作为 UI 内的 in-process pubsub，不跨窗口；持久化语义仍由 app_setting 表保证。
 */
type Listener = () => void;
const listeners = new Set<Listener>();

function notifyChange(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch (err) {
      // 单个订阅者抛错不应阻断其它订阅者
      console.warn("[wise:auto-approve] listener threw", err);
    }
  }
}

export function subscribeAutoApproveSettings(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function normalizeRepoPath(path: string | null | undefined): string | null {
  if (typeof path !== "string") return null;
  const trimmed = path.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function repoKey(repoPath: string): string {
  return `${REPO_KEY_PREFIX}${repoPath}`;
}

/**
 * 读取全局默认 auto-approve 模式。非法/空值降级为 `"off"`，永不抛出。
 */
export async function getGlobalAutoApproveMode(): Promise<AutoApproveMode> {
  const raw = await getAppSetting(GLOBAL_KEY);
  return normalizeAutoApproveMode(raw);
}

/**
 * 写入全局默认。`off` 也显式落库（不删 key），便于审计区分「未设置」与「主动关闭」。
 */
export async function setGlobalAutoApproveMode(mode: AutoApproveMode): Promise<void> {
  const normalized = normalizeAutoApproveMode(mode);
  await setAppSetting(GLOBAL_KEY, normalized);
  notifyChange();
}

/**
 * 读取仓库级覆盖。
 * - 未设置 / 空 / 非法 → `"inherit"`（跟随全局）。
 * - 显式 off/edits/all → 返回该值。
 *
 * 注：空字符串 / null / undefined 的 repoPath 视为非法，返回 `"inherit"`。
 */
export async function getRepoAutoApproveOverride(
  repoPath: string | null | undefined,
): Promise<RepoAutoApproveOverride> {
  const norm = normalizeRepoPath(repoPath);
  if (!norm) return "inherit";
  const raw = await getAppSetting(repoKey(norm));
  if (raw === null || raw === undefined || raw === "") return "inherit";
  if (raw === "off" || raw === "edits" || raw === "all") return raw;
  return "inherit";
}

/**
 * 写入仓库级覆盖：
 * - `"inherit"` → 删除 key（恢复跟随全局）。
 * - `"off" | "edits" | "all"` → 显式写入。
 *
 * 非法 repoPath 直接 no-op，不抛错（保持调用方简单）。
 */
export async function setRepoAutoApproveOverride(
  repoPath: string | null | undefined,
  value: RepoAutoApproveOverride,
): Promise<void> {
  const norm = normalizeRepoPath(repoPath);
  if (!norm) return;
  if (value === "inherit") {
    await deleteAppSetting(repoKey(norm));
    notifyChange();
    return;
  }
  const normalized = normalizeAutoApproveMode(value);
  await setAppSetting(repoKey(norm), normalized);
  notifyChange();
}

/**
 * 解析当前会话的 effective mode。
 * 优先级：仓库覆盖（≠ inherit） > 全局默认 > `"off"`。
 *
 * `repoPath` 缺失（未绑定仓库的会话）时仅回落到全局默认。
 */
export async function resolveEffectiveAutoApproveMode(
  repoPath: string | null | undefined,
): Promise<AutoApproveMode> {
  const norm = normalizeRepoPath(repoPath);
  if (norm) {
    const repoLevel = await getRepoAutoApproveOverride(norm);
    if (repoLevel !== "inherit") return repoLevel;
  }
  return getGlobalAutoApproveMode();
}

// 测试用：导出常量便于断言（不参与公开 API）。
export const __TEST__ = { GLOBAL_KEY, REPO_KEY_PREFIX, repoKey };

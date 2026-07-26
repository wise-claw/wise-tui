import { getAppSettingJson, setAppSettingJson } from "../appSettingsStore";

export const WISE_CODE_REVIEW_SETTINGS_KEY = "wise.codeReview.v1";

export const WISE_CODE_REVIEW_SETTINGS_CHANGED = "wise:code-review-settings-changed";

/** 推送前审查策略（对标 Cursor 本地 pre-push review）。 */
export type CodeReviewPrePushMode = "off" | "warn" | "block";

/** 代码变化导致审查结果过期后，编辑器标注的处理方式。 */
export type CodeReviewStaleFindingsPolicy = "dim" | "clear";

export type CodeReviewSettingsV1 = {
  version: 1;
  /** 推送前自动跑审查：关闭 / 有高危时确认 / 有高危时阻断 */
  prePushMode: CodeReviewPrePushMode;
  /** 默认审查范围 */
  defaultScope: "uncommitted" | "branch";
  /** 与上次审查 diff 完全相同则复用结果（对标 Cursor patch sync） */
  reuseIdenticalDiff: boolean;
  /** 本地提交成功后自动打开并审查「相对主干」 */
  autoReviewAfterCommit: boolean;
  /** 审查结果过期后：淡化标注 / 直接清除标注 */
  staleFindingsPolicy: CodeReviewStaleFindingsPolicy;
};

export const DEFAULT_CODE_REVIEW_SETTINGS: CodeReviewSettingsV1 = {
  version: 1,
  prePushMode: "off",
  defaultScope: "uncommitted",
  reuseIdenticalDiff: true,
  autoReviewAfterCommit: false,
  staleFindingsPolicy: "dim",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeCodeReviewSettings(raw: unknown): CodeReviewSettingsV1 {
  if (!isRecord(raw)) return { ...DEFAULT_CODE_REVIEW_SETTINGS };
  const prePushMode =
    raw.prePushMode === "warn" || raw.prePushMode === "block" || raw.prePushMode === "off"
      ? raw.prePushMode
      : DEFAULT_CODE_REVIEW_SETTINGS.prePushMode;
  const defaultScope =
    raw.defaultScope === "branch" || raw.defaultScope === "uncommitted"
      ? raw.defaultScope
      : DEFAULT_CODE_REVIEW_SETTINGS.defaultScope;
  const reuseIdenticalDiff =
    typeof raw.reuseIdenticalDiff === "boolean"
      ? raw.reuseIdenticalDiff
      : DEFAULT_CODE_REVIEW_SETTINGS.reuseIdenticalDiff;
  const autoReviewAfterCommit =
    typeof raw.autoReviewAfterCommit === "boolean"
      ? raw.autoReviewAfterCommit
      : DEFAULT_CODE_REVIEW_SETTINGS.autoReviewAfterCommit;
  const staleFindingsPolicy =
    raw.staleFindingsPolicy === "clear" || raw.staleFindingsPolicy === "dim"
      ? raw.staleFindingsPolicy
      : DEFAULT_CODE_REVIEW_SETTINGS.staleFindingsPolicy;
  return {
    version: 1,
    prePushMode,
    defaultScope,
    reuseIdenticalDiff,
    autoReviewAfterCommit,
    staleFindingsPolicy,
  };
}

export async function loadCodeReviewSettings(): Promise<CodeReviewSettingsV1> {
  const raw = await getAppSettingJson<unknown>(WISE_CODE_REVIEW_SETTINGS_KEY);
  return normalizeCodeReviewSettings(raw);
}

export async function saveCodeReviewSettings(
  patch: Partial<Omit<CodeReviewSettingsV1, "version">>,
): Promise<CodeReviewSettingsV1> {
  const current = await loadCodeReviewSettings();
  const next = normalizeCodeReviewSettings({ ...current, ...patch, version: 1 });
  await setAppSettingJson(WISE_CODE_REVIEW_SETTINGS_KEY, next);
  window.dispatchEvent(
    new CustomEvent<CodeReviewSettingsV1>(WISE_CODE_REVIEW_SETTINGS_CHANGED, { detail: next }),
  );
  return next;
}

export function isBlockingCodeReviewRecommendation(
  recommendation: string,
  findings: ReadonlyArray<{ severity: string; confidence: string }>,
): boolean {
  if (recommendation === "REQUEST_CHANGES") {
    return findings.some(
      (f) =>
        (f.severity === "CRITICAL" || f.severity === "HIGH") &&
        (f.confidence === "HIGH" || f.confidence === "MEDIUM"),
    );
  }
  return findings.some(
    (f) => f.severity === "CRITICAL" && f.confidence === "HIGH",
  );
}

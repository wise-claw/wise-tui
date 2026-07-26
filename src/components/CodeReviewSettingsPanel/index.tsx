import { Alert, Radio, Spin, Switch, Typography, message } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  loadCodeReviewSettings,
  saveCodeReviewSettings,
  type CodeReviewPrePushMode,
  type CodeReviewSettingsV1,
  type CodeReviewStaleFindingsPolicy,
} from "../../services/codeReview";
import "./index.css";

const { Text } = Typography;

const PRE_PUSH_OPTIONS: Array<{ value: CodeReviewPrePushMode; label: string; hint: string }> = [
  {
    value: "off",
    label: "关闭（默认）",
    hint: "推送前不跑审查，仅在手动发起时执行。",
  },
  {
    value: "warn",
    label: "有高危时确认",
    hint: "推送前自动审查；出现高危问题时弹出确认，可选择查看详情或继续推送。",
  },
  {
    value: "block",
    label: "有高危时阻断",
    hint: "推送前自动审查；出现高危问题时直接中止推送并打开审查结果。",
  },
];

const SCOPE_OPTIONS: Array<{ value: CodeReviewSettingsV1["defaultScope"]; label: string; hint: string }> = [
  { value: "uncommitted", label: "未提交", hint: "审查工作区里尚未提交的改动。" },
  { value: "branch", label: "相对主干", hint: "审查当前分支相对主干已落地的提交。" },
];

const STALE_OPTIONS: Array<{ value: CodeReviewStaleFindingsPolicy; label: string; hint: string }> = [
  {
    value: "dim",
    label: "淡化标注（默认）",
    hint: "代码变化后保留上次结果，但在编辑器中淡化显示并标记为「可能过期」。",
  },
  {
    value: "clear",
    label: "自动清除标注",
    hint: "代码一旦变化就清除编辑器标注，避免陈旧结论误导。",
  },
];

/**
 * 工作台配置 / 代码审查 面板。读写 `wise.codeReview.v1`（app_setting）。
 *
 * 面板只负责策略配置；实际审查执行、findings 标注与推送门闸分别由
 * `services/codeReview` 与 Git 面板消费同一份设置。
 */
export function CodeReviewSettingsPanel() {
  const [settings, setSettings] = useState<CodeReviewSettingsV1 | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadCodeReviewSettings()
      .then((loaded) => {
        if (!cancelled) setSettings(loaded);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const patchSettings = useCallback(
    async (patch: Partial<Omit<CodeReviewSettingsV1, "version">>, successText: string) => {
      setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
      try {
        const next = await saveCodeReviewSettings(patch);
        setSettings(next);
        message.success(successText);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        try {
          setSettings(await loadCodeReviewSettings());
        } catch {
          /* 回滚失败时保留当前显示 */
        }
      }
    },
    [],
  );

  if (!settings) {
    return (
      <div className="code-review-settings-panel code-review-settings-panel--loading">
        {error ? (
          <Alert type="error" showIcon message="读取代码审查设置失败" description={error} />
        ) : (
          <Spin />
        )}
      </div>
    );
  }

  return (
    <div className="code-review-settings-panel">
      {error ? (
        <Alert
          type="error"
          showIcon
          message="保存代码审查设置失败"
          description={error}
          closable
          onClose={() => setError(null)}
          style={{ marginBottom: 8 }}
        />
      ) : null}

      <section className="code-review-settings-panel__section">
        <header className="code-review-settings-panel__section-head">
          <Text strong className="code-review-settings-panel__section-title">
            推送前审查
          </Text>
          <Text type="secondary" className="code-review-settings-panel__section-desc">
            在「提交并推送」前跑一轮本地审查。有未提交改动时审查未提交内容，否则审查相对主干的提交。
          </Text>
        </header>
        <div className="code-review-settings-panel__mode-shell">
          <Radio.Group
            value={settings.prePushMode}
            className="code-review-settings-panel__mode-group"
            onChange={(e) =>
              void patchSettings(
                { prePushMode: e.target.value as CodeReviewPrePushMode },
                "已更新推送前审查策略",
              )
            }
          >
            {PRE_PUSH_OPTIONS.map((opt) => (
              <Radio key={opt.value} value={opt.value}>
                <span className="code-review-settings-panel__mode-label">{opt.label}</span>
                <Text type="secondary" className="code-review-settings-panel__mode-hint">
                  {opt.hint}
                </Text>
              </Radio>
            ))}
          </Radio.Group>
        </div>
      </section>

      <section className="code-review-settings-panel__section">
        <header className="code-review-settings-panel__section-head">
          <Text strong className="code-review-settings-panel__section-title">
            默认审查范围
          </Text>
          <Text type="secondary" className="code-review-settings-panel__section-desc">
            从 Git 面板或自动化发起审查时的默认范围。
          </Text>
        </header>
        <div className="code-review-settings-panel__mode-shell">
          <Radio.Group
            value={settings.defaultScope}
            className="code-review-settings-panel__mode-group"
            onChange={(e) =>
              void patchSettings(
                { defaultScope: e.target.value as CodeReviewSettingsV1["defaultScope"] },
                "已更新默认审查范围",
              )
            }
          >
            {SCOPE_OPTIONS.map((opt) => (
              <Radio key={opt.value} value={opt.value}>
                <span className="code-review-settings-panel__mode-label">{opt.label}</span>
                <Text type="secondary" className="code-review-settings-panel__mode-hint">
                  {opt.hint}
                </Text>
              </Radio>
            ))}
          </Radio.Group>
        </div>
      </section>

      <section className="code-review-settings-panel__section">
        <header className="code-review-settings-panel__section-head">
          <Text strong className="code-review-settings-panel__section-title">
            结果过期处理
          </Text>
          <Text type="secondary" className="code-review-settings-panel__section-desc">
            审查结果基于当次 diff，代码继续改动后结论可能不再成立。
          </Text>
        </header>
        <div className="code-review-settings-panel__mode-shell">
          <Radio.Group
            value={settings.staleFindingsPolicy}
            className="code-review-settings-panel__mode-group"
            onChange={(e) =>
              void patchSettings(
                { staleFindingsPolicy: e.target.value as CodeReviewStaleFindingsPolicy },
                "已更新过期结果处理方式",
              )
            }
          >
            {STALE_OPTIONS.map((opt) => (
              <Radio key={opt.value} value={opt.value}>
                <span className="code-review-settings-panel__mode-label">{opt.label}</span>
                <Text type="secondary" className="code-review-settings-panel__mode-hint">
                  {opt.hint}
                </Text>
              </Radio>
            ))}
          </Radio.Group>
        </div>
      </section>

      <section className="code-review-settings-panel__section">
        <header className="code-review-settings-panel__section-head">
          <Text strong className="code-review-settings-panel__section-title">
            执行策略
          </Text>
        </header>
        <ul className="code-review-settings-panel__toggle-list">
          <li className="code-review-settings-panel__toggle-row">
            <div className="code-review-settings-panel__toggle-meta">
              <Text strong className="code-review-settings-panel__toggle-label">
                复用相同 diff 的结果
              </Text>
              <Text type="secondary" className="code-review-settings-panel__toggle-hint">
                改动与上次审查完全一致时直接复用结论，不重复消耗执行环境。
              </Text>
            </div>
            <Switch
              size="small"
              checked={settings.reuseIdenticalDiff}
              onChange={(checked) =>
                void patchSettings(
                  { reuseIdenticalDiff: checked },
                  checked ? "相同 diff 将复用上次结果" : "每次审查都会重新执行",
                )
              }
            />
          </li>
          <li className="code-review-settings-panel__toggle-row">
            <div className="code-review-settings-panel__toggle-meta">
              <Text strong className="code-review-settings-panel__toggle-label">
                提交后自动审查
              </Text>
              <Text type="secondary" className="code-review-settings-panel__toggle-hint">
                本地提交成功后自动打开审查抽屉，按「相对主干」审查刚落地的提交。
              </Text>
            </div>
            <Switch
              size="small"
              checked={settings.autoReviewAfterCommit}
              onChange={(checked) =>
                void patchSettings(
                  { autoReviewAfterCommit: checked },
                  checked ? "提交成功后将自动审查相对主干" : "已关闭提交后自动审查",
                )
              }
            />
          </li>
        </ul>
      </section>

      <Text type="secondary" className="code-review-settings-panel__footnote">
        审查记录保存在 ~/.wise/code-reviews，可在审查抽屉的「历史」中查看与复用。
      </Text>
    </div>
  );
}

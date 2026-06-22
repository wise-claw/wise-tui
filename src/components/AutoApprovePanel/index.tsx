import { Alert, Empty, Radio, Spin, Typography } from "antd";
import type { RadioChangeEvent } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { loadRepositories } from "../../services/repository";
import {
  getGlobalAutoApproveMode,
  getRepoAutoApproveOverride,
  setGlobalAutoApproveMode,
  setRepoAutoApproveOverride,
  type RepoAutoApproveOverride,
} from "../../services/autoApproveSettings";
import type { AutoApproveMode } from "../../utils/autoApproveDecide";
import type { Repository } from "../../types";
import "./index.css";

const { Text } = Typography;

const MODE_OPTIONS: Array<{ value: AutoApproveMode; label: string; hint: string }> = [
  {
    value: "off",
    label: "关闭（默认）",
    hint: "所有 Permission / AskUserQuestion 都进入右下方坞栏，由人手动决策。",
  },
  {
    value: "plans",
    label: "仅计划批准",
    hint: "仅计划批准（ExitPlanMode）自动通过；文件编辑与其它工具仍走坞栏。",
  },
  {
    value: "edits",
    label: "仅文件编辑自动批准",
    hint: "Edit / Write / MultiEdit / NotebookEdit 与计划批准（ExitPlanMode）自动通过；其它工具与问题仍走坞栏。",
  },
  {
    value: "all",
    label: "完全自动",
    hint: "所有 Permission 自动 allow，AskUserQuestion 自动选首项（multiSelect 全选）。请仅对受信会话开启。",
  },
];

const OVERRIDE_OPTIONS: Array<{ value: RepoAutoApproveOverride; label: string }> = [
  { value: "inherit", label: "跟随全局" },
  { value: "off", label: "关闭" },
  { value: "plans", label: "仅计划" },
  { value: "edits", label: "仅编辑" },
  { value: "all", label: "完全自动" },
];

/**
 * 工作台配置 / 自动批准 面板。
 * - 全局默认：写 `auto_approve_mode`。
 * - 仓库覆盖：写 `auto_approve_mode:repo:{path}`，`inherit` 删除 key。
 *
 * 该面板只读写 app_setting；运行时由 `useClaudeSessions` 拦截 PermissionRequest /
 * QuestionRequest 后落到 `decidePermissionAutoApprove` / `decideQuestionAutoApprove` 决策。
 */
export function AutoApprovePanel() {
  const [globalMode, setGlobalMode] = useState<AutoApproveMode | null>(null);
  const [repos, setRepos] = useState<Repository[] | null>(null);
  const [overrides, setOverrides] = useState<Record<number, RepoAutoApproveOverride>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [mode, repositoryList] = await Promise.all([
          getGlobalAutoApproveMode(),
          loadRepositories(),
        ]);
        if (cancelled) return;
        setGlobalMode(mode);
        setRepos(repositoryList);
        const next: Record<number, RepoAutoApproveOverride> = {};
        await Promise.all(
          repositoryList.map(async (repo) => {
            const override = await getRepoAutoApproveOverride(repo.path);
            if (!cancelled) next[repo.id] = override;
          }),
        );
        if (!cancelled) {
          setOverrides(next);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleGlobalChange = useCallback(async (e: RadioChangeEvent) => {
    const next = e.target.value as AutoApproveMode;
    setGlobalMode(next);
    try {
      await setGlobalAutoApproveMode(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleRepoOverrideChange = useCallback(
    async (repo: Repository, value: RepoAutoApproveOverride) => {
      setOverrides((prev) => ({ ...prev, [repo.id]: value }));
      try {
        await setRepoAutoApproveOverride(repo.path, value);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [],
  );

  const sortedRepos = useMemo(() => {
    if (!repos) return [];
    return [...repos].sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
  }, [repos]);

  if (loading || globalMode === null) {
    return (
      <div className="auto-approve-panel auto-approve-panel--loading">
        <Spin />
      </div>
    );
  }

  return (
    <div className="auto-approve-panel">
      {error ? (
        <Alert
          type="error"
          showIcon
          message="自动批准设置出错"
          description={error}
          closable
          onClose={() => setError(null)}
          style={{ marginBottom: 8 }}
        />
      ) : null}

      <section className="auto-approve-panel__section">
        <header className="auto-approve-panel__section-head">
          <Text strong className="auto-approve-panel__section-title">
            全局默认
          </Text>
          <Text type="secondary" className="auto-approve-panel__section-desc">
            所有未单独配置的仓库会沿用此设置。完全自动模式建议仅在受信、可回滚的工作树中开启。
          </Text>
        </header>
        <div className="auto-approve-panel__mode-shell">
          <Radio.Group
            value={globalMode}
            onChange={handleGlobalChange}
            className="auto-approve-panel__mode-group"
          >
            {MODE_OPTIONS.map((opt) => (
              <Radio key={opt.value} value={opt.value}>
                <span className="auto-approve-panel__mode-label">{opt.label}</span>
                <Text type="secondary" className="auto-approve-panel__mode-hint">
                  {opt.hint}
                </Text>
              </Radio>
            ))}
          </Radio.Group>
        </div>
      </section>

      <section className="auto-approve-panel__section">
        <header className="auto-approve-panel__section-head">
          <Text strong className="auto-approve-panel__section-title">
            按仓库覆盖
          </Text>
          <Text type="secondary" className="auto-approve-panel__section-desc">
            为单个仓库设置不同的策略。`跟随全局` 表示删除覆盖、回到全局默认。
          </Text>
        </header>
        {sortedRepos.length === 0 ? (
          <Empty description="尚未注册仓库" />
        ) : (
          <ul className="auto-approve-panel__repo-list">
            {sortedRepos.map((repo) => {
              const value = overrides[repo.id] ?? "inherit";
              return (
                <li key={repo.id} className="auto-approve-panel__repo-row">
                  <div className="auto-approve-panel__repo-meta">
                    <Text strong className="auto-approve-panel__repo-name">
                      {repo.name}
                    </Text>
                    <Text type="secondary" className="auto-approve-panel__repo-path">
                      {repo.path}
                    </Text>
                  </div>
                  <Radio.Group
                    size="small"
                    value={value}
                    onChange={(e) =>
                      void handleRepoOverrideChange(
                        repo,
                        e.target.value as RepoAutoApproveOverride,
                      )
                    }
                    optionType="button"
                    buttonStyle="solid"
                    options={OVERRIDE_OPTIONS}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

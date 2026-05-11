import { CloseOutlined, LinkOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { App, Alert, Button, Empty, Input, Segmented, Spin, Tooltip, Typography } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { listClaudeProjectSkills, listClaudeUserSkills } from "../../services/claude";
import {
  skillsCliAddFromRegistry,
  skillsCliRemoveFromRegistry,
  skillsShSearch,
  type SkillsInstallScope,
  type SkillsShSkillEntry,
} from "../../services/skillsSh";
import "./SkillsHub.css";

interface Props {
  repositoryPath?: string | null;
  onClose?: () => void;
}

function formatInstalls(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function SkillsHub({ repositoryPath, onClose }: Props) {
  const { message } = App.useApp();
  const [installScope, setInstallScope] = useState<SkillsInstallScope>("project");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState<SkillsShSkillEntry[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [installedNames, setInstalledNames] = useState<ReadonlySet<string>>(new Set());
  const [listLoading, setListLoading] = useState(false);
  const [busySkillId, setBusySkillId] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(query.trim()), 350);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const loadInstalled = useCallback(async () => {
    const path = repositoryPath?.trim() ?? "";
    if (installScope === "project" && !path) {
      setInstalledNames(new Set());
      return;
    }
    setListLoading(true);
    try {
      const list =
        installScope === "global" ? await listClaudeUserSkills() : await listClaudeProjectSkills(path);
      setInstalledNames(new Set(list.map((s) => s.name)));
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
      setInstalledNames(new Set());
    } finally {
      setListLoading(false);
    }
  }, [installScope, message, repositoryPath]);

  useEffect(() => {
    void loadInstalled();
  }, [loadInstalled]);

  useEffect(() => {
    if (debouncedQuery.length < 2) {
      setResults([]);
      setSearchError(null);
      setSearchLoading(false);
      return;
    }
    let cancelled = false;
    setSearchLoading(true);
    void skillsShSearch(debouncedQuery, 24)
      .then((r) => {
        if (!cancelled) {
          setResults(r.skills);
          setSearchError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setResults([]);
          setSearchError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setSearchLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  const hasRepo = Boolean(repositoryPath?.trim());
  const canInstallOrRemove = installScope === "global" || hasRepo;

  const handleInstall = useCallback(
    async (entry: SkillsShSkillEntry) => {
      const repoPath = repositoryPath?.trim() ?? "";
      if (installScope === "project" && !repoPath) {
        message.warning("请先在侧栏选择仓库，仓库级技能将安装到该仓库根目录的 .claude/skills/");
        return;
      }
      setBusySkillId(entry.skillId);
      try {
        await skillsCliAddFromRegistry(
          installScope === "global" ? null : repoPath,
          entry.source,
          entry.skillId,
          installScope,
        );
        message.success(
          installScope === "global"
            ? `已全局安装「${entry.skillId}」（~/.claude/skills/）`
            : `已安装「${entry.skillId}」到当前仓库`,
        );
        await loadInstalled();
      } catch (e) {
        message.error(e instanceof Error ? e.message : String(e));
      } finally {
        setBusySkillId(null);
      }
    },
    [installScope, loadInstalled, message, repositoryPath],
  );

  const handleUninstall = useCallback(
    async (entry: SkillsShSkillEntry) => {
      const repoPath = repositoryPath?.trim() ?? "";
      if (installScope === "project" && !repoPath) return;
      setBusySkillId(entry.skillId);
      try {
        await skillsCliRemoveFromRegistry(
          installScope === "global" ? null : repoPath,
          entry.skillId,
          installScope,
        );
        message.success(`已卸载「${entry.skillId}」`);
        await loadInstalled();
      } catch (e) {
        message.error(e instanceof Error ? e.message : String(e));
      } finally {
        setBusySkillId(null);
      }
    },
    [installScope, loadInstalled, message, repositoryPath],
  );

  const emptyHint = useMemo(() => {
    if (query.trim().length > 0 && query.trim().length < 2) {
      return "请至少输入 2 个字符再搜索";
    }
    if (debouncedQuery.length >= 2 && !searchLoading && results.length === 0 && !searchError) {
      return "未找到匹配的技能";
    }
    return "在上方搜索 skills.sh 目录中的技能";
  }, [debouncedQuery.length, query, results.length, searchError, searchLoading]);

  return (
    <div className="app-skills-hub-root">
      <header className="app-skills-hub-header">
        <div className="app-skills-hub-header-top">
          <Typography.Title level={5} className="app-skills-hub-title">
            技能
          </Typography.Title>
          {onClose ? (
            <Tooltip title="关闭" mouseEnterDelay={0.35}>
              <Button
                type="text"
                size="small"
                className="app-skills-hub-close-btn"
                icon={<CloseOutlined />}
                aria-label="关闭"
                onClick={onClose}
              />
            </Tooltip>
          ) : null}
        </div>
        <Typography.Paragraph type="secondary" className="app-skills-hub-subtitle">
          搜索来自{" "}
          <Typography.Link href="https://skills.sh/" target="_blank" rel="noreferrer">
            skills.sh
            <LinkOutlined style={{ marginLeft: 4, fontSize: 10 }} />
          </Typography.Link>
          的公开技能目录；安装使用官方 <Typography.Text code>skills</Typography.Text> CLI（<Typography.Text code>npx</Typography.Text>
          ，需网络与本机 Node）。<strong>仓库级</strong>写入{" "}
          <Typography.Text code>{"<仓库>/.claude/skills/"}</Typography.Text>，<strong>全局</strong>写入{" "}
          <Typography.Text code>~/.claude/skills/</Typography.Text>（对应 CLI 的 <Typography.Text code>-g</Typography.Text>）。
        </Typography.Paragraph>
        <div className="app-skills-hub-scope-row">
          <span className="app-skills-hub-scope-label">安装范围</span>
          <Segmented<SkillsInstallScope>
            size="small"
            value={installScope}
            onChange={(v) => setInstallScope(v)}
            className="app-skills-hub-scope-segmented"
            options={[
              { label: "当前仓库", value: "project" },
              { label: "全局（用户）", value: "global" },
            ]}
          />
        </div>
        <div className="app-skills-hub-search-row">
          <Input
            allowClear
            size="small"
            prefix={<SearchOutlined />}
            placeholder="搜索技能（至少 2 个字符）…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="app-skills-hub-search"
          />
          <Button size="small" icon={<ReloadOutlined />} loading={listLoading} onClick={() => void loadInstalled()}>
            同步已安装
          </Button>
        </div>
      </header>

      {installScope === "project" && !hasRepo ? (
        <Alert
          type="warning"
          showIcon
          className="app-skills-hub-alert app-skills-hub-alert--compact"
          message={
            <span className="app-skills-hub-alert-inline">
              <Typography.Text strong>未选择仓库</Typography.Text>
              <Typography.Text type="secondary"> 仓库级安装与「同步已安装」需先在侧栏选择仓库。</Typography.Text>
            </span>
          }
        />
      ) : null}
      {installScope === "global" ? (
        <Alert
          type="info"
          showIcon
          className="app-skills-hub-alert app-skills-hub-alert--compact"
          message={
            <span className="app-skills-hub-alert-inline">
              <Typography.Text strong>全局技能</Typography.Text>
              <Typography.Text type="secondary">
                {" "}
                对所有本机 Claude Code 会话可见；与当前侧栏仓库无关。
              </Typography.Text>
            </span>
          }
        />
      ) : null}

      {searchError ? (
        <Alert type="error" showIcon className="app-skills-hub-alert app-skills-hub-alert--compact" message={searchError} />
      ) : null}

      {searchLoading ? (
        <div className="app-skills-hub-loading">
          <Spin size="small" />
        </div>
      ) : results.length > 0 ? (
        <div className="app-skills-hub-grid">
          {results.map((entry) => {
            const installed = installedNames.has(entry.skillId);
            const busy = busySkillId === entry.skillId;
            return (
              <article key={entry.id} className="app-skills-hub-card">
                <div className="app-skills-hub-card-name">{entry.name}</div>
                <div className="app-skills-hub-card-meta">安装量约 {formatInstalls(entry.installs)}</div>
                <div className="app-skills-hub-card-source" title={entry.id}>
                  {entry.source} · {entry.skillId}
                </div>
                <div className="app-skills-hub-card-actions">
                  {installed ? (
                    <Button
                      size="small"
                      danger
                      loading={busy}
                      disabled={!canInstallOrRemove || busy}
                      onClick={() => void handleUninstall(entry)}
                    >
                      卸载
                    </Button>
                  ) : (
                    <Button
                      type="primary"
                      size="small"
                      loading={busy}
                      disabled={!canInstallOrRemove || busy}
                      onClick={() => void handleInstall(entry)}
                    >
                      安装
                    </Button>
                  )}
                  <Typography.Link
                    className="app-skills-hub-card-link"
                    href={`https://skills.sh/${entry.source}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    目录
                  </Typography.Link>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <Empty className="app-skills-hub-empty" description={emptyHint} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}
    </div>
  );
}

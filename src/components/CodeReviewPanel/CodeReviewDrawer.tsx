import { Button, Collapse, Drawer, Dropdown, Empty, Segmented, Space, Tag, Typography, message } from "antd";
import {
  BugOutlined,
  ClearOutlined,
  CloseCircleOutlined,
  DownOutlined,
  ExportOutlined,
  HistoryOutlined,
  LoadingOutlined,
  SettingOutlined,
  StopOutlined,
  ToolOutlined,
  UpOutlined,
} from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SessionExecutionEngine } from "../../constants/sessionExecutionEngine";
import type { CodeReviewFocusFinding } from "../../constants/workflowUiEvents";
import { requestCodeReviewFix } from "../../constants/workflowUiEvents";
import { cancelClaudeInvocation } from "../../services/claude";
import {
  buildCodeReviewFixPrompt,
  buildCodeReviewFindingEntries,
  buildCodeReviewJsonReport,
  buildCodeReviewMarkdownReport,
  codeReviewReportBasename,
  copyTextToClipboard,
  describeCodeReviewIncremental,
  downloadTextFile,
  filterCodeReviewFindingEntries,
  findCodeReviewEntryIndex,
  groupCodeReviewFindingsByFile,
  describeCodeReviewSettingsSummary,
  ingestCodeReviewNotification,
  listCodeReviewRuns,
  loadCodeReviewSettings,
  runCodeReview,
  type CodeReviewExportFilter,
  type CodeReviewFileSetDelta,
  type CodeReviewSettingsV1,
  type CodeReviewSeverityFilter,
} from "../../services/codeReview";
import { dispatchWiseUiNavigation } from "../../services/wiseUiNavigation";
import { useCodeReviewFindingsSnapshot } from "../../hooks/useCodeReviewFindingsSnapshot";
import {
  clearCodeReviewFindings,
  publishCodeReviewFindings,
} from "../../stores/codeReviewFindingsStore";
import type {
  CodeReviewFinding,
  CodeReviewRecommendation,
  CodeReviewRun,
  CodeReviewScope,
} from "../../types/codeReview";
import {
  codeReviewFindingListKey,
  findingMatchesCodeReviewFocus,
} from "../../utils/monacoCodeReviewFindingDecorations";
import type { GitPanelOpenFileOptions } from "../GitPanel/types";
import "./codeReviewDrawer.css";

const { Text } = Typography;

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: "magenta",
  HIGH: "red",
  MEDIUM: "orange",
  LOW: "default",
};

function recommendationLabel(value: CodeReviewRecommendation | string): string {
  switch (value) {
    case "APPROVE":
      return "建议通过";
    case "REQUEST_CHANGES":
      return "需要修改";
    default:
      return "仅评论";
  }
}

function recommendationColor(value: CodeReviewRecommendation | string): string {
  switch (value) {
    case "APPROVE":
      return "success";
    case "REQUEST_CHANGES":
      return "error";
    default:
      return "processing";
  }
}

function formatRunTime(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString("zh-CN", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isHighSeverityFinding(finding: CodeReviewFinding): boolean {
  return finding.severity === "CRITICAL" || finding.severity === "HIGH";
}

export interface CodeReviewDrawerProps {
  open: boolean;
  onClose: () => void;
  repositoryPath: string;
  repositoryName?: string;
  executionEngine?: SessionExecutionEngine;
  onOpenFile?: (path: string, options?: GitPanelOpenFileOptions) => void;
  autoStart?: boolean;
  initialScope?: CodeReviewScope;
  /** 外部注入的审查结果（例如推送门闸刚跑完） */
  seededRun?: CodeReviewRun | null;
  /** 打开后滚动并高亮对应 finding */
  focusFinding?: CodeReviewFocusFinding | null;
  focusNonce?: number;
  onRunCompleted?: (run: CodeReviewRun) => void;
}

export function CodeReviewDrawer({
  open,
  onClose,
  repositoryPath,
  repositoryName,
  executionEngine,
  onOpenFile,
  autoStart = false,
  initialScope = "uncommitted",
  seededRun = null,
  focusFinding = null,
  focusNonce = 0,
  onRunCompleted,
}: CodeReviewDrawerProps) {
  const [pane, setPane] = useState<"review" | "history">("review");
  const [scope, setScope] = useState<CodeReviewScope>(initialScope);
  const [loading, setLoading] = useState(false);
  const [run, setRun] = useState<CodeReviewRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [history, setHistory] = useState<CodeReviewRun[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [settings, setSettings] = useState<CodeReviewSettingsV1 | null>(null);
  const [reused, setReused] = useState(false);
  const [incremental, setIncremental] = useState<CodeReviewFileSetDelta | null>(null);
  const [activeFocusKey, setActiveFocusKey] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<CodeReviewSeverityFilter>("ALL");
  const [expandedFiles, setExpandedFiles] = useState<string[]>([]);
  const invocationKeyRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);
  const autoStartedRef = useRef(false);
  const findingItemRefs = useRef(new Map<string, HTMLLIElement>());
  const findingsSnapshot = useCodeReviewFindingsSnapshot(repositoryPath);
  const findingsStale = Boolean(findingsSnapshot?.stale && findingsSnapshot.runId === run?.id);

  const refreshHistory = useCallback(async () => {
    const path = repositoryPath.trim();
    if (!path) {
      setHistory([]);
      return;
    }
    setHistoryLoading(true);
    try {
      const runs = await listCodeReviewRuns(path, 20);
      setHistory(runs);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [repositoryPath]);

  useEffect(() => {
    if (!open) {
      autoStartedRef.current = false;
      return;
    }
    setScope(initialScope);
    setPane("review");
    setReused(false);
    setIncremental(null);
    setSeverityFilter("ALL");
    setActiveFocusKey(null);
    void loadCodeReviewSettings().then(setSettings);
    void refreshHistory();
    if (seededRun) {
      setRun(seededRun);
      setError(null);
      setReused(false);
      setIncremental(null);
      publishCodeReviewFindings(seededRun);
      onRunCompleted?.(seededRun);
    }
  }, [initialScope, onRunCompleted, open, refreshHistory, seededRun]);

  const cancelReview = useCallback(() => {
    cancelledRef.current = true;
    const key = invocationKeyRef.current;
    if (key) {
      void cancelClaudeInvocation(key).catch(() => {});
    }
    invocationKeyRef.current = null;
    setLoading(false);
  }, []);

  const startReview = useCallback(
    async (opts?: { force?: boolean }) => {
      const path = repositoryPath.trim();
      if (!path || loading) return;
      cancelledRef.current = false;
      invocationKeyRef.current = null;
      setLoading(true);
      setError(null);
      setReused(false);
      setIncremental(null);
      setActiveFocusKey(null);
      setPane("review");
      try {
        const result = await runCodeReview({
          repositoryPath: path,
          scope,
          executionEngine,
          force: opts?.force,
          onInvocationKey: (key) => {
            invocationKeyRef.current = key;
          },
        });
        if (cancelledRef.current) return;
        if (!result.ok) {
          setRun(null);
          setError(result.error);
          if (!result.empty) {
            message.error(result.error);
          }
          return;
        }
        setRun(result.run);
        setTruncated(result.truncated);
        setReused(result.reused);
        setIncremental(result.incremental);
        publishCodeReviewFindings(result.run);
        onRunCompleted?.(result.run);
        void refreshHistory();
        void ingestCodeReviewNotification(result.run, { reused: result.reused });
        if (result.reused) {
          message.info(
            result.run.findings.length === 0
              ? "变更与上次相同，已复用审查结果（未发现问题）"
              : `变更与上次相同，已复用审查结果（${result.run.findings.length} 项）`,
          );
        } else if (result.run.findings.length === 0) {
          message.success(result.run.summary || "未发现问题");
        } else {
          const incr = result.incremental
            ? describeCodeReviewIncremental(result.incremental)
            : "";
          message.info(
            incr
              ? `增量审查完成：${result.run.findings.length} 项（${incr}）`
              : `审查完成：${result.run.findings.length} 项发现（已标注到编辑器）`,
          );
        }
      } finally {
        if (!cancelledRef.current) {
          setLoading(false);
        }
        invocationKeyRef.current = null;
      }
    },
    [executionEngine, loading, onRunCompleted, refreshHistory, repositoryPath, scope],
  );

  useEffect(() => {
    if (!open || !autoStart || autoStartedRef.current || seededRun) return;
    autoStartedRef.current = true;
    void startReview();
  }, [autoStart, open, seededRun, startReview]);

  useEffect(() => {
    if (!open) {
      cancelReview();
    }
  }, [cancelReview, open]);

  useEffect(() => {
    if (!open || !run || !focusFinding?.path?.trim()) {
      return;
    }
    const matchIndex = run.findings.findIndex((finding) =>
      findingMatchesCodeReviewFocus(finding, focusFinding),
    );
    if (matchIndex < 0) return;
    const key = codeReviewFindingListKey(run.findings[matchIndex]!, matchIndex);
    const path = (run.findings[matchIndex]!.path || "(unknown)").replace(/\\/g, "/");
    setPane("review");
    setSeverityFilter("ALL");
    setActiveFocusKey(key);
    setExpandedFiles((prev) => (prev.includes(path) ? prev : [...prev, path]));
    const frame = window.requestAnimationFrame(() => {
      findingItemRefs.current.get(key)?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusFinding, focusNonce, open, run]);

  const findings = run?.findings ?? [];
  const findingEntries = useMemo(() => buildCodeReviewFindingEntries(findings), [findings]);
  const filteredEntries = useMemo(
    () => filterCodeReviewFindingEntries(findingEntries, severityFilter),
    [findingEntries, severityFilter],
  );
  const fileGroups = useMemo(
    () => groupCodeReviewFindingsByFile(filteredEntries),
    [filteredEntries],
  );
  const highFindings = useMemo(() => findings.filter(isHighSeverityFinding), [findings]);
  const incrementalHint = useMemo(
    () => (incremental ? describeCodeReviewIncremental(incremental) : ""),
    [incremental],
  );

  useEffect(() => {
    if (!run) {
      setExpandedFiles([]);
      return;
    }
    const paths = [
      ...new Set(
        run.findings
          .map((finding) => finding.path.trim().replace(/\\/g, "/") || "(unknown)")
          .filter(Boolean),
      ),
    ];
    setExpandedFiles(paths);
  }, [run?.id]);

  const counts = useMemo(() => {
    const map = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const finding of findings) {
      const key = finding.severity in map ? (finding.severity as keyof typeof map) : "LOW";
      map[key] += 1;
    }
    return map;
  }, [findings]);

  const activeFilteredIndex = useMemo(
    () => findCodeReviewEntryIndex(filteredEntries, activeFocusKey),
    [activeFocusKey, filteredEntries],
  );

  const handleOpenFinding = useCallback(
    (finding: CodeReviewFinding) => {
      if (!onOpenFile || !finding.path.trim()) return;
      onOpenFile(finding.path, {
        fromGitChanges: "unstaged",
        line: finding.line,
      });
    },
    [onOpenFile],
  );

  const focusEntry = useCallback(
    (key: string, finding: CodeReviewFinding, openFile: boolean) => {
      const path = (finding.path || "(unknown)").replace(/\\/g, "/");
      setActiveFocusKey(key);
      setExpandedFiles((prev) => (prev.includes(path) ? prev : [...prev, path]));
      if (openFile) {
        handleOpenFinding(finding);
      }
      window.requestAnimationFrame(() => {
        findingItemRefs.current.get(key)?.scrollIntoView({
          block: "nearest",
          behavior: "smooth",
        });
      });
    },
    [handleOpenFinding],
  );

  const goAdjacentFinding = useCallback(
    (delta: -1 | 1) => {
      if (filteredEntries.length === 0) return;
      const current = activeFilteredIndex >= 0 ? activeFilteredIndex : delta > 0 ? -1 : 0;
      const nextIndex =
        (current + delta + filteredEntries.length * 10) % filteredEntries.length;
      const entry = filteredEntries[nextIndex];
      if (!entry) return;
      focusEntry(entry.key, entry.finding, true);
    },
    [activeFilteredIndex, filteredEntries, focusEntry],
  );

  const handleFixFinding = useCallback(
    (finding: CodeReviewFinding) => {
      const path = repositoryPath.trim();
      if (!path) return;
      requestCodeReviewFix({
        repositoryPath: path,
        repositoryName,
        prompt: buildCodeReviewFixPrompt({
          repositoryPath: path,
          finding: {
            path: finding.path,
            line: finding.line,
            title: finding.title,
            detail: finding.detail,
            fix: finding.fix,
            severity: String(finding.severity),
          },
        }),
      });
    },
    [repositoryName, repositoryPath],
  );

  const handleFixHighFindings = useCallback(() => {
    const path = repositoryPath.trim();
    if (!path || highFindings.length === 0) return;
    const body = highFindings
      .map((finding, index) => {
        const loc =
          finding.line != null ? `${finding.path}:${finding.line}` : finding.path || "unknown";
        return [
          `${index + 1}. [${finding.severity}] ${loc}`,
          `   ${finding.title}`,
          finding.detail ? `   ${finding.detail}` : "",
          finding.fix ? `   建议: ${finding.fix}` : "",
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n");
    requestCodeReviewFix({
      repositoryPath: path,
      repositoryName,
      prompt: [
        "请按优先级修复以下代码审查中的 CRITICAL/HIGH 问题。只改必要代码，完成后逐条说明。",
        "",
        `仓库: ${path}`,
        "",
        body,
      ].join("\n"),
    });
  }, [highFindings, repositoryName, repositoryPath]);

  const settingsSummary = settings
    ? describeCodeReviewSettingsSummary(settings)
    : "读取审查设置中…";

  const handleOpenSettings = useCallback(() => {
    dispatchWiseUiNavigation({ kind: "author", pane: "code-review" });
    onClose();
  }, [onClose]);

  const handleClearFindings = useCallback(() => {
    const path = repositoryPath.trim();
    if (!path) return;
    clearCodeReviewFindings(path);
    message.success("已清除编辑器标注");
  }, [repositoryPath]);

  const handleExport = useCallback(
    async (
      kind: "copy-md" | "copy-json" | "download-md" | "download-json",
      filter: CodeReviewExportFilter = "all",
    ) => {
      if (!run) return;
      const options = { filter };
      const highOnly = filter === "highOrCritical";
      try {
        if (kind === "copy-md") {
          await copyTextToClipboard(buildCodeReviewMarkdownReport(run, options));
          message.success(highOnly ? "已复制仅高危 Markdown" : "已复制 Markdown 报告");
          return;
        }
        if (kind === "copy-json") {
          await copyTextToClipboard(buildCodeReviewJsonReport(run, options));
          message.success(highOnly ? "已复制仅高危 JSON" : "已复制 JSON 报告");
          return;
        }
        if (kind === "download-md") {
          downloadTextFile(
            codeReviewReportBasename(run, "md", options),
            buildCodeReviewMarkdownReport(run, options),
            "text/markdown;charset=utf-8",
          );
          message.success(highOnly ? "已下载仅高危 Markdown" : "已下载 Markdown 报告");
          return;
        }
        downloadTextFile(
          codeReviewReportBasename(run, "json", options),
          buildCodeReviewJsonReport(run, options),
          "application/json;charset=utf-8",
        );
        message.success(highOnly ? "已下载仅高危 JSON" : "已下载 JSON 报告");
      } catch (error) {
        message.error(error instanceof Error ? error.message : "导出失败");
      }
    },
    [run],
  );

  return (
    <Drawer
      title={
        <Space size={8}>
          <BugOutlined />
          <span>代码审查</span>
          {run ? (
            <Tag color={recommendationColor(run.recommendation)}>
              {recommendationLabel(run.recommendation)}
            </Tag>
          ) : null}
          {reused ? <Tag>已复用</Tag> : null}
          {findingsStale ? <Tag color="warning">可能过期</Tag> : null}
        </Space>
      }
      placement="right"
      size={520}
      open={open}
      onClose={() => {
        cancelReview();
        onClose();
      }}
      destroyOnHidden
      className="code-review-drawer"
      extra={
        <Space size={6}>
          {loading ? (
            <Button size="small" icon={<StopOutlined />} onClick={cancelReview}>
              取消
            </Button>
          ) : (
            <>
              {run ? (
                <Dropdown
                  menu={{
                    items: [
                      {
                        key: "copy-md",
                        label: "复制 Markdown",
                        onClick: () => void handleExport("copy-md"),
                      },
                      {
                        key: "copy-json",
                        label: "复制 JSON",
                        onClick: () => void handleExport("copy-json"),
                      },
                      {
                        key: "copy-md-high",
                        label: "复制仅高危 Markdown",
                        onClick: () => void handleExport("copy-md", "highOrCritical"),
                      },
                      {
                        key: "copy-json-high",
                        label: "复制仅高危 JSON",
                        onClick: () => void handleExport("copy-json", "highOrCritical"),
                      },
                      { type: "divider" },
                      {
                        key: "download-md",
                        label: "下载 Markdown",
                        onClick: () => void handleExport("download-md"),
                      },
                      {
                        key: "download-json",
                        label: "下载 JSON",
                        onClick: () => void handleExport("download-json"),
                      },
                      {
                        key: "download-md-high",
                        label: "下载仅高危 Markdown",
                        onClick: () => void handleExport("download-md", "highOrCritical"),
                      },
                      {
                        key: "download-json-high",
                        label: "下载仅高危 JSON",
                        onClick: () => void handleExport("download-json", "highOrCritical"),
                      },
                    ],
                  }}
                  trigger={["click"]}
                >
                  <Button size="small" icon={<ExportOutlined />} title="导出审查报告">
                    导出
                  </Button>
                </Dropdown>
              ) : null}
              {run ? (
                <Button
                  size="small"
                  icon={<ClearOutlined />}
                  onClick={handleClearFindings}
                  title="清除编辑器标注"
                >
                  清除标注
                </Button>
              ) : null}
              {run ? (
                <Button
                  size="small"
                  onClick={() => void startReview({ force: true })}
                  disabled={!repositoryPath.trim()}
                  title="忽略相同 diff 复用，强制重新执行"
                >
                  强制重审
                </Button>
              ) : null}
              <Button
                size="small"
                type="primary"
                icon={<BugOutlined />}
                onClick={() => void startReview()}
                disabled={!repositoryPath.trim()}
              >
                {run ? "重新审查" : "开始审查"}
              </Button>
            </>
          )}
        </Space>
      }
    >
      <div className="code-review-drawer__toolbar">
        <Segmented
          size="small"
          value={pane}
          onChange={(value) => setPane(value as "review" | "history")}
          options={[
            { label: "本次", value: "review" },
            {
              label: (
                <span>
                  <HistoryOutlined /> 历史
                </span>
              ),
              value: "history",
            },
          ]}
        />
        {pane === "review" ? (
          <>
            <Segmented
              size="small"
              value={scope}
              disabled={loading}
              onChange={(value) => setScope(value as CodeReviewScope)}
              options={[
                { label: "未提交", value: "uncommitted" },
                { label: "相对主干", value: "branch" },
              ]}
            />
            <div className="code-review-drawer__setting-row">
              <Text type="secondary">{settingsSummary}</Text>
              <Button size="small" type="link" icon={<SettingOutlined />} onClick={handleOpenSettings}>
                审查设置
              </Button>
            </div>
          </>
        ) : null}
      </div>

      {pane === "history" ? (
        <div className="code-review-drawer__history">
          {historyLoading ? (
            <div className="code-review-drawer__loading" role="status">
              <LoadingOutlined />
              <span>加载历史…</span>
            </div>
          ) : history.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无审查历史" />
          ) : (
            <ul className="code-review-drawer__history-list">
              {history.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="code-review-drawer__history-item"
                    onClick={() => {
                      setRun(item);
                      setError(null);
                      setReused(false);
                      setIncremental(null);
                      setActiveFocusKey(null);
                      setSeverityFilter("ALL");
                      setPane("review");
                      publishCodeReviewFindings(item);
                    }}
                  >
                    <span className="code-review-drawer__history-meta">
                      <Tag color={recommendationColor(item.recommendation)}>
                        {recommendationLabel(item.recommendation)}
                      </Tag>
                      <span>{formatRunTime(item.createdAtMs)}</span>
                      <span>{item.scope === "branch" ? "相对主干" : "未提交"}</span>
                    </span>
                    <span className="code-review-drawer__history-summary">
                      {item.summary || `${item.findings.length} 项发现`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
          {loading ? (
            <div className="code-review-drawer__loading" role="status">
              <LoadingOutlined />
              <span>正在审查…</span>
            </div>
          ) : null}

          {!loading && error ? (
            <div className="code-review-drawer__error" role="alert">
              <CloseCircleOutlined />
              <span>{error}</span>
            </div>
          ) : null}

          {!loading && run ? (
            <div className="code-review-drawer__summary">
              <Text>{run.summary}</Text>
              {findingsStale ? (
                <div className="code-review-drawer__stale">
                  <Text type="warning">
                    工作区已变更，当前结果可能过期。建议重新审查（相同文件可增量重审）。
                  </Text>
                  <Button
                    size="small"
                    type="primary"
                    onClick={() => void startReview({ force: true })}
                    disabled={!repositoryPath.trim()}
                  >
                    重新审查
                  </Button>
                </div>
              ) : null}
              {reused ? (
                <Text type="secondary" className="code-review-drawer__hint">
                  变更指纹未变，已复用历史审查结果。可点「强制重审」重新执行。
                </Text>
              ) : null}
              {!reused && incrementalHint ? (
                <Text type="secondary" className="code-review-drawer__hint">
                  增量：{incrementalHint}
                  {incremental?.focusFiles?.length
                    ? `（焦点 ${incremental.focusFiles.slice(0, 3).join(", ")}${
                        incremental.focusFiles.length > 3 ? "…" : ""
                      }）`
                    : incremental?.added.length
                      ? `（优先 ${incremental.added.slice(0, 3).join(", ")}${
                          incremental.added.length > 3 ? "…" : ""
                        }）`
                      : ""}
                </Text>
              ) : null}
              <div className="code-review-drawer__counts">
                <button
                  type="button"
                  className={`code-review-drawer__count-btn${
                    severityFilter === "ALL" ? " is-active" : ""
                  }`}
                  onClick={() => setSeverityFilter("ALL")}
                >
                  全部 {findings.length}
                </button>
                <button
                  type="button"
                  className={`code-review-drawer__count-btn${
                    severityFilter === "HIGH_PLUS" ? " is-active" : ""
                  }`}
                  onClick={() => setSeverityFilter("HIGH_PLUS")}
                >
                  高危+ {counts.CRITICAL + counts.HIGH}
                </button>
                <button
                  type="button"
                  className={`code-review-drawer__count-btn code-review-drawer__count-btn--critical${
                    severityFilter === "CRITICAL" ? " is-active" : ""
                  }`}
                  onClick={() => setSeverityFilter("CRITICAL")}
                >
                  严重 {counts.CRITICAL}
                </button>
                <button
                  type="button"
                  className={`code-review-drawer__count-btn code-review-drawer__count-btn--high${
                    severityFilter === "HIGH" ? " is-active" : ""
                  }`}
                  onClick={() => setSeverityFilter("HIGH")}
                >
                  高 {counts.HIGH}
                </button>
                <button
                  type="button"
                  className={`code-review-drawer__count-btn code-review-drawer__count-btn--medium${
                    severityFilter === "MEDIUM" ? " is-active" : ""
                  }`}
                  onClick={() => setSeverityFilter("MEDIUM")}
                >
                  中 {counts.MEDIUM}
                </button>
                <button
                  type="button"
                  className={`code-review-drawer__count-btn${
                    severityFilter === "LOW" ? " is-active" : ""
                  }`}
                  onClick={() => setSeverityFilter("LOW")}
                >
                  低 {counts.LOW}
                </button>
              </div>
              {findings.length > 0 ? (
                <div className="code-review-drawer__nav">
                  <Button
                    size="small"
                    icon={<UpOutlined />}
                    disabled={filteredEntries.length === 0}
                    onClick={() => goAdjacentFinding(-1)}
                    title="上一条"
                  />
                  <Button
                    size="small"
                    icon={<DownOutlined />}
                    disabled={filteredEntries.length === 0}
                    onClick={() => goAdjacentFinding(1)}
                    title="下一条"
                  />
                  <Text type="secondary" className="code-review-drawer__nav-label">
                    {filteredEntries.length === 0
                      ? "无匹配"
                      : activeFilteredIndex >= 0
                        ? `${activeFilteredIndex + 1} / ${filteredEntries.length}`
                        : `— / ${filteredEntries.length}`}
                  </Text>
                </div>
              ) : null}
              {highFindings.length > 0 ? (
                <Button
                  size="small"
                  type="primary"
                  icon={<ToolOutlined />}
                  onClick={handleFixHighFindings}
                >
                  修复全部高危（{highFindings.length}）
                </Button>
              ) : null}
              {truncated ? (
                <Text type="warning" className="code-review-drawer__truncated">
                  Diff 已截断，结果仅覆盖可见部分。
                </Text>
              ) : null}
            </div>
          ) : null}

          {!loading && run && findings.length === 0 && !error ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未发现需要修改的问题" />
          ) : null}

          {!loading && findings.length > 0 && filteredEntries.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="当前严重度筛选下没有发现"
            />
          ) : null}

          {!loading && filteredEntries.length > 0 ? (
            <Collapse
              size="small"
              className="code-review-drawer__file-collapse"
              activeKey={expandedFiles}
              onChange={(keys) =>
                setExpandedFiles(Array.isArray(keys) ? keys.map(String) : [String(keys)])
              }
              items={fileGroups.map((group) => ({
                key: group.path,
                label: (
                  <span className="code-review-drawer__file-label">
                    <span className="code-review-drawer__file-path" title={group.path}>
                      {group.path}
                    </span>
                    <Tag>{group.entries.length}</Tag>
                    {group.highOrCritical > 0 ? (
                      <Tag color="red">高危 {group.highOrCritical}</Tag>
                    ) : null}
                  </span>
                ),
                children: (
                  <ul className="code-review-drawer__list">
                    {group.entries.map((entry) => {
                      const { finding, key: itemKey } = entry;
                      const loc =
                        finding.line != null
                          ? `${finding.path}:${finding.line}`
                          : finding.path || "unknown";
                      const focused = activeFocusKey === itemKey;
                      return (
                        <li
                          key={itemKey}
                          ref={(node) => {
                            if (node) findingItemRefs.current.set(itemKey, node);
                            else findingItemRefs.current.delete(itemKey);
                          }}
                          className={`code-review-drawer__item${
                            focused ? " code-review-drawer__item--focused" : ""
                          }`}
                        >
                          <div className="code-review-drawer__item-head">
                            <Tag color={SEVERITY_COLOR[finding.severity] ?? "default"}>
                              {finding.severity}
                            </Tag>
                            <Tag>{finding.confidence}</Tag>
                            <button
                              type="button"
                              className="code-review-drawer__loc"
                              onClick={() => focusEntry(itemKey, finding, true)}
                              title="在编辑器中打开"
                            >
                              {loc}
                            </button>
                          </div>
                          <div className="code-review-drawer__title">{finding.title}</div>
                          {finding.detail && finding.detail !== finding.title ? (
                            <div className="code-review-drawer__detail">{finding.detail}</div>
                          ) : null}
                          {finding.fix ? (
                            <div className="code-review-drawer__fix">
                              修复建议：{finding.fix}
                            </div>
                          ) : null}
                          <div className="code-review-drawer__actions">
                            <Button
                              size="small"
                              onClick={() => focusEntry(itemKey, finding, true)}
                            >
                              定位
                            </Button>
                            <Button
                              size="small"
                              type="primary"
                              icon={<ToolOutlined />}
                              onClick={() => handleFixFinding(finding)}
                            >
                              在会话中修复
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ),
              }))}
            />
          ) : null}

          {!loading && run?.openQuestions?.length ? (
            <div className="code-review-drawer__questions">
              <Text type="secondary">待确认</Text>
              <ul>
                {run.openQuestions.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {!loading && !run && !error ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="选择范围后开始审查。可开启推送前审查，对标 Cursor 本地 /review。"
            />
          ) : null}
        </>
      )}
    </Drawer>
  );
}

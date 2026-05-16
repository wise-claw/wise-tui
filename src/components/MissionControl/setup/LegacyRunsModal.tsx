import { Empty, Input, Spin, Tag, Typography, message } from "antd";
import {
  SearchOutlined,
  HistoryOutlined,
  FileTextOutlined,
  ApartmentOutlined,
  ClockCircleOutlined,
  InboxOutlined,
} from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";
import {
  listLegacyRuns,
  readLegacyRun,
  type LegacyRunSummary,
} from "../../../services/prdSplit/legacyRunsImport";

interface LegacyRunsModalProps {
  open: boolean;
  onClose: () => void;
  onPick: (markdown: string) => void;
}

export function LegacyRunsModal({ open, onClose, onPick }: LegacyRunsModalProps) {
  const [loading, setLoading] = useState(false);
  const [runs, setRuns] = useState<LegacyRunSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSearch("");
    listLegacyRuns()
      .then((list) => {
        if (!cancelled) setRuns(list);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return runs;
    return runs.filter(
      (r) =>
        r.prdPreview.toLowerCase().includes(s) ||
        r.runId.toLowerCase().includes(s) ||
        (r.repositoryName ?? "").toLowerCase().includes(s),
    );
  }, [runs, search]);

  const handlePick = async (summary: LegacyRunSummary) => {
    setPicking(summary.runId);
    try {
      const detail = await readLegacyRun(summary.runId);
      if (!detail.prdMarkdown.trim()) {
        message.error("该记录无 PRD 内容");
        return;
      }
      onPick(detail.prdMarkdown);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setPicking(null);
    }
  };

  if (!open) return null;

  return (
    <div className="mission-legacy-overlay" onClick={onClose}>
      <div className="mission-legacy-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="mission-legacy-header">
          <div className="mission-legacy-header__left">
            <HistoryOutlined />
            <Typography.Text className="mission-legacy-header__title" strong>
              历史 PRD
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {runs.length} 条记录
            </Typography.Text>
          </div>
          <button type="button" className="mission-legacy-close" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Search */}
        <div className="mission-legacy-search">
          <Input
            prefix={<SearchOutlined />}
            placeholder="搜索 PRD 内容、Run ID 或仓库名…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            allowClear
            size="small"
          />
        </div>

        {/* Content */}
        <div className="mission-legacy-scroll">
          {error ? (
            <div className="mission-legacy-error">{error}</div>
          ) : loading ? (
            <div className="mission-legacy-loading">
              <Spin size="small" />
            </div>
          ) : filtered.length === 0 ? (
            <Empty
              image={<InboxOutlined style={{ fontSize: 48, color: "var(--mission-dim)" }} />}
              description={search ? "无匹配记录" : "暂无历史 PRD 记录"}
            />
          ) : (
            <div className="mission-legacy-grid">
              {filtered.map((item) => (
                <button
                  key={item.runId}
                  type="button"
                  className="mission-legacy-card"
                  onClick={() => handlePick(item)}
                  disabled={picking === item.runId}
                >
                  <div className="mission-legacy-card__top">
                    <span className="mission-legacy-card__runid">{item.runId.slice(0, 12)}</span>
                    <span className="mission-legacy-card__date">
                      <ClockCircleOutlined />
                      {formatRelativeDate(item.createdAtMs)}
                    </span>
                  </div>

                  <Typography.Paragraph
                    className="mission-legacy-card__preview"
                    type="secondary"
                    ellipsis={{ rows: 3 }}
                  >
                    {item.prdPreview || "无预览"}
                  </Typography.Paragraph>

                  <div className="mission-legacy-card__meta">
                    {item.repositoryName ? (
                      <Tag icon={<FileTextOutlined />} style={{ fontSize: 10, margin: 0 }}>
                        {item.repositoryName}
                      </Tag>
                    ) : null}
                    {item.hasSplitResult ? (
                      <Tag
                        icon={<ApartmentOutlined />}
                        color="success"
                        style={{ fontSize: 10, margin: 0 }}
                      >
                        {item.taskCount} 个任务
                      </Tag>
                    ) : (
                      <Tag style={{ fontSize: 10, margin: 0 }}>仅 PRD</Tag>
                    )}
                  </div>

                  {picking === item.runId ? (
                    <div className="mission-legacy-card__loading">
                      <Spin size="small" />
                    </div>
                  ) : (
                    <span className="mission-legacy-card__action">导入此 PRD →</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatRelativeDate(ms: number): string {
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(ms).toLocaleDateString("zh-CN");
}

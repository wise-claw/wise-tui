import { useEffect, useState } from "react";
import { Empty, Spin, Tag, Timeline, Typography } from "antd";
import { FileTextOutlined, ClockCircleOutlined } from "@ant-design/icons";
import {
  listTrellisSpecRevisions,
  type TrellisSpecRevision,
} from "../../../services/trellisRuntime";

interface SpecRevisionTimelineProps {
  rootPath?: string | null;
  filePath?: string | null;
  limit?: number;
  onSelectFilePath?: (filePath: string | null) => void;
}

export function SpecRevisionTimeline({
  rootPath,
  filePath,
  limit = 20,
  onSelectFilePath,
}: SpecRevisionTimelineProps) {
  const [revisions, setRevisions] = useState<TrellisSpecRevision[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<TrellisSpecRevision | null>(null);

  useEffect(() => {
    setSelected(null);
    onSelectFilePath?.(null);
    if (!rootPath) { setRevisions([]); return; }
    let cancelled = false;
    setLoading(true);
    listTrellisSpecRevisions({ rootPath, filePath, limit })
      .then((list) => { if (!cancelled) setRevisions(list); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [rootPath, filePath, limit, onSelectFilePath]);

  if (!rootPath) return null;

  return (
    <section className="spec-timeline">
      <div className="spec-timeline__header">
        <FileTextOutlined />
        <Typography.Text strong style={{ fontSize: 12 }}>Spec 版本历史</Typography.Text>
        <Tag style={{ fontSize: 10 }}>{revisions.length}</Tag>
        {filePath ? (
          <Tag style={{ fontSize: 10, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>
            {filePath.split("/").pop()}
          </Tag>
        ) : null}
      </div>

      {loading && revisions.length === 0 ? (
        <div style={{ padding: 16, textAlign: "center" }}><Spin size="small" /></div>
      ) : revisions.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 Spec 版本" />
      ) : (
        <div className="spec-timeline__body">
          <div className="spec-timeline__list">
            <Timeline
              items={revisions.map((rev) => ({
                dot: <ClockCircleOutlined style={{ fontSize: 12 }} />,
                children: (
                  <button
                    type="button"
                    className={`spec-timeline-entry ${selected?.revisionId === rev.revisionId ? "spec-timeline-entry--active" : ""}`}
                    onClick={() => {
                      const next = selected?.revisionId === rev.revisionId ? null : rev;
                      setSelected(next);
                      onSelectFilePath?.(next?.filePath ?? null);
                    }}
                  >
                    <div className="spec-timeline-entry__head">
                      <span className="spec-timeline-entry__file">{rev.filePath.split("/").pop()}</span>
                      <span className="spec-timeline-entry__time">
                        {new Date(rev.createdAt).toLocaleString("zh-CN")}
                      </span>
                    </div>
                    {rev.reason ? (
                      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                        {rev.reason}
                      </Typography.Text>
                    ) : null}
                    <div className="spec-timeline-entry__meta">
                      {rev.author ? <Tag style={{ fontSize: 9 }}>{rev.author}</Tag> : null}
                      <span className="spec-timeline-entry__hash">{rev.fileHash.slice(0, 8)}</span>
                    </div>
                  </button>
                ),
              }))}
            />
          </div>

          {selected ? (
            <div className="spec-timeline__detail">
              <div className="spec-timeline__detail-head">
                <Typography.Text strong style={{ fontSize: 13 }}>
                  {selected.filePath.split("/").pop()}
                </Typography.Text>
                <Tag style={{ fontSize: 10 }}>{selected.fileHash.slice(0, 12)}</Tag>
              </div>
              <pre className="spec-timeline__detail-content">{selected.content.slice(0, 2000)}</pre>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

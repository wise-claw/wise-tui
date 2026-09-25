import { useEffect, useState } from "react";
import { Button, List, Space, Tag, Typography } from "antd";
import { getCollabLegacyHistory } from "../../../services/collaboration";
import { openWorkspaceRequirementExecutionSession } from "../../../stores/workspaceMemoPanelStore";
import { REQUIREMENT_OUTCOME_LABELS, type RequirementExecutionRecord } from "../../../types/requirementExecutionRecord";
import { formatTime } from "./detailContext";

function parseRecords(raw: unknown): RequirementExecutionRecord[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { records?: unknown }).records)
      ? (raw as { records: unknown[] }).records
      : [];
  return list.filter(
    (r): r is RequirementExecutionRecord =>
      typeof r === "object" && r !== null && typeof (r as RequirementExecutionRecord).id === "string" && typeof (r as RequirementExecutionRecord).outcome === "string",
  );
}

/** 旧单仓库需求升级后保留的执行记录与人工验收日志（只读）。 */
export function LegacyHistorySection({ requirementId }: { requirementId: string }) {
  const [records, setRecords] = useState<RequirementExecutionRecord[] | null>(null);

  useEffect(() => {
    let alive = true;
    void getCollabLegacyHistory(requirementId)
      .then((h) => alive && setRecords(parseRecords(h.legacyRecords)))
      .catch(() => alive && setRecords([]));
    return () => {
      alive = false;
    };
  }, [requirementId]);

  if (!records?.length) return null;
  return (
    <div>
      <div className="collab-section-title">旧版执行与验收记录</div>
      <List
        size="small"
        dataSource={[...records].sort((a, b) => b.finishedAt - a.finishedAt)}
        renderItem={(r) => (
          <List.Item
            actions={
              r.sessionId
                ? [
                    <Button key="s" size="small" type="link" onClick={() => openWorkspaceRequirementExecutionSession(r.sessionId)}>
                      会话
                    </Button>,
                  ]
                : []
            }
          >
            <Space direction="vertical" size={0}>
              <Space size={6}>
                <Tag>{r.kind === "review" ? "验收" : "执行"}</Tag>
                <Typography.Text>{REQUIREMENT_OUTCOME_LABELS[r.outcome] ?? r.outcome}</Typography.Text>
                <Typography.Text type="secondary">{formatTime(r.finishedAt)}</Typography.Text>
              </Space>
              {r.summary ? <Typography.Text type="secondary">{r.summary}</Typography.Text> : null}
            </Space>
          </List.Item>
        )}
      />
    </div>
  );
}

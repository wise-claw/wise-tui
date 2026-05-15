import { Alert, Button, List, Modal, Space, Spin, Tag, Typography, message } from "antd";
import { useEffect, useState } from "react";
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

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
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

  return (
    <Modal open={open} onCancel={onClose} footer={null} width="min(900px, 92vw)" title="历史 PRD 记录">
      {error ? <Alert type="error" showIcon message="读取失败" description={error} /> : null}
      {loading ? <Spin /> : null}
      <List
        dataSource={runs}
        renderItem={(item) => (
          <List.Item
            actions={[
              <Button
                key="pick"
                type="primary"
                size="small"
                loading={picking === item.runId}
                onClick={() => handlePick(item)}
              >
                导入
              </Button>,
            ]}
          >
            <List.Item.Meta
              title={
                <Space>
                  <Typography.Text code>{item.runId.slice(0, 8)}…</Typography.Text>
                  <Tag>{new Date(item.createdAtMs).toLocaleString()}</Tag>
                  {item.hasSplitResult ? <Tag color="success">{item.taskCount} 个任务</Tag> : <Tag>仅 PRD</Tag>}
                </Space>
              }
              description={item.prdPreview || "无预览"}
            />
          </List.Item>
        )}
      />
    </Modal>
  );
}

import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  List,
  Modal,
  Space,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import { HistoryOutlined } from "@ant-design/icons";
import type { PlannerRepo } from "../../../services/prdSplit/clusterPlanner";
import { repositoryTypeChineseLabel } from "../../../utils/repositoryType";
import type { UseSplitWizardStateApi } from "../useSplitWizardState";
import {
  listLegacyRuns,
  readLegacyRun,
  type LegacyRunSummary,
} from "../../../services/prdSplit/legacyRunsImport";
import { PrdMarkdownEditor, type PrdImageBucket } from "../components/PrdMarkdownEditor";

interface Props {
  api: UseSplitWizardStateApi;
}

export function InputStage({ api }: Props) {
  const { state } = api;
  const [legacyOpen, setLegacyOpen] = useState(false);

  const reposByType = useMemo(() => {
    const groups: Record<string, PlannerRepo[]> = { frontend: [], backend: [], document: [] };
    for (const repo of state.repositories) {
      const bucket = groups[repo.type] ?? (groups[repo.type] = []);
      bucket.push(repo);
    }
    return groups;
  }, [state.repositories]);

  const imageBucket = useMemo<PrdImageBucket | null>(() => {
    const firstSelectedId = state.selectedRepositoryIds[0];
    const repo = firstSelectedId != null
      ? state.repositories.find((r) => r.id === firstSelectedId)
      : state.repositories[0];
    if (!repo && !state.project) return null;
    return {
      repositoryPath: repo?.path ?? state.project?.rootPath ?? "",
      repositoryName: repo?.name ?? null,
      repositoryId: repo?.id ?? null,
      projectName: state.project?.name ?? null,
      projectId: state.project?.id ?? null,
    };
  }, [state.repositories, state.selectedRepositoryIds, state.project]);

  const projectTagLabel = state.project ? `${state.project.name}` : "（未选择项目）";

  return (
    <div className="prd-split-wizard__stage" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Alert
        type="info"
        showIcon
        message="第 1 步 · 输入 PRD"
        description={
          <Typography.Paragraph style={{ margin: 0 }}>
            将 PRD 粘贴为 Markdown，系统会自动解析「功能 / 非功能 / 验收」三类需求，按当前项目下的仓库类型与名称匹配自动归簇。
            目标项目：<Tag color="processing">{projectTagLabel}</Tag>
            {state.project?.rootPath ? <Tag>{state.project.rootPath}</Tag> : null}
          </Typography.Paragraph>
        }
      />

      <Card size="small" title="参与拆分的仓库" bordered>
        {state.repositories.length === 0 ? (
          <Typography.Text type="warning">当前项目下未识别到仓库（请在外部为项目挂载至少一个仓库再回来）。</Typography.Text>
        ) : (
          <Checkbox.Group
            value={state.selectedRepositoryIds}
            onChange={(values) => api.setSelectedRepos(values as number[])}
            style={{ display: "flex", flexWrap: "wrap", gap: 12 }}
          >
            {(["frontend", "backend", "document"] as const).map((type) => (
              <div key={type} style={{ minWidth: 200 }}>
                <Typography.Text strong style={{ display: "block", marginBottom: 4 }}>
                  {repositoryTypeChineseLabel(type)}
                </Typography.Text>
                {(reposByType[type] ?? []).length === 0 ? (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>—</Typography.Text>
                ) : (
                  (reposByType[type] ?? []).map((repo) => (
                    <div key={repo.id} style={{ paddingBlock: 2 }}>
                      <Checkbox value={repo.id}>
                        <Tag color={typeColor(type)} style={{ marginInlineEnd: 4 }}>
                          {repositoryTypeChineseLabel(type)}
                        </Tag>
                        {repo.name}
                      </Checkbox>
                    </div>
                  ))
                )}
              </div>
            ))}
          </Checkbox.Group>
        )}
      </Card>

      <Card
        size="small"
        title="PRD（Markdown 文本）"
        bordered
        extra={
          <Tooltip title="从 ~/.wise/prd-runs/ 旧拆分历史里挑一份 PRD，覆盖当前文本。Trellis 落盘动作仍由你在 Review 阶段触发。">
            <Button size="small" icon={<HistoryOutlined />} onClick={() => setLegacyOpen(true)}>
              从历史 PRD 运行导入
            </Button>
          </Tooltip>
        }
      >
        <PrdMarkdownEditor
          value={state.prdMarkdown}
          onChange={api.setPrdMarkdown}
          imageBucket={imageBucket}
          floatingToolbar
          minHeight={320}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {state.prdMarkdown.length} 字符
        </Typography.Text>
      </Card>

      {state.globalError ? (
        <Alert type="error" showIcon message="解析或规划失败" description={state.globalError} />
      ) : null}

      <LegacyRunsModal
        open={legacyOpen}
        onClose={() => setLegacyOpen(false)}
        onPick={(markdown, summary) => {
          api.setPrdMarkdown(markdown);
          setLegacyOpen(false);
          message.success(`已导入历史 PRD（${summary.runId.slice(0, 8)}…）`);
        }}
      />
    </div>
  );
}

function LegacyRunsModal({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (markdown: string, summary: LegacyRunSummary) => void;
}) {
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
        if (cancelled) return;
        setRuns(list);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
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
        message.error("该运行没有可恢复的 prd.md 内容");
        return;
      }
      onPick(detail.prdMarkdown, summary);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      message.error(`读取失败：${m}`);
    } finally {
      setPicking(null);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width="min(900px, 92vw)"
      title="历史 PRD 运行（~/.wise/prd-runs/）"
    >
      {error ? (
        <Alert type="error" showIcon message="读取历史目录失败" description={error} />
      ) : null}
      {!error && !loading && runs.length === 0 ? (
        <Alert
          type="info"
          showIcon
          message="没有历史运行可导入"
          description="`~/.wise/prd-runs/` 目录为空，或刚刚被清理。"
        />
      ) : null}
      <List
        loading={loading}
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
                disabled={!item.hasSplitResult && item.taskCount === 0 && !item.prdPreview}
              >
                导入这份 PRD
              </Button>,
            ]}
          >
            <List.Item.Meta
              title={
                <Space>
                  <Typography.Text code>{item.runId.slice(0, 8)}…</Typography.Text>
                  {item.repositoryName ? (
                    <Tag color="processing">{item.repositoryName}</Tag>
                  ) : null}
                  <Tag>{new Date(item.createdAtMs).toLocaleString()}</Tag>
                  {item.hasSplitResult ? (
                    <Tag color="success">{item.taskCount} tasks</Tag>
                  ) : (
                    <Tag>仅 PRD</Tag>
                  )}
                </Space>
              }
              description={
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {item.prdPreview || "（无 PRD 预览）"}
                </Typography.Text>
              }
            />
          </List.Item>
        )}
      />
    </Modal>
  );
}

function typeColor(type: "frontend" | "backend" | "document"): string {
  if (type === "frontend") return "blue";
  if (type === "backend") return "green";
  return "purple";
}

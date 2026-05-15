import { Alert, Button, Checkbox, Drawer, List, Modal, Space, Spin, Tag, Typography, message } from "antd";
import { HistoryOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";
import type { ProjectItem, Repository } from "../../../types";
import {
  listLegacyRuns,
  readLegacyRun,
  type LegacyRunSummary,
} from "../../../services/prdSplit/legacyRunsImport";
import type { UseSplitWizardStateApi } from "../../PrdSplitWizard/useSplitWizardState";
import { projectToPrdSplitTarget, repositoryToPrdSplitTarget, type PrdSplitTargetKind } from "../../PrdSplitWizard/targetModel";
import { PrdMarkdownEditor, type PrdImageBucket } from "../../PrdSplitWizard/components/PrdMarkdownEditor";
import { repositoryTypeChineseLabel } from "../../../utils/repositoryType";
import { COPY } from "../copy";
import { MissionTargetPicker } from "./MissionTargetPicker";

interface MissionSetupDrawerProps {
  open: boolean;
  api: UseSplitWizardStateApi;
  projects: ProjectItem[];
  repositories: Repository[];
  onClose: () => void;
  onSubmitted: () => void;
}

export function MissionSetupDrawer({
  open,
  api,
  projects,
  repositories,
  onClose,
  onSubmitted,
}: MissionSetupDrawerProps) {
  const { state } = api;
  const [targetKind, setTargetKind] = useState<PrdSplitTargetKind>("project");
  const [legacyOpen, setLegacyOpen] = useState(false);
  const eligibleProjects = useMemo(
    () => projects.filter((project) => (project.rootPath ?? "").trim().length > 0),
    [projects],
  );
  const eligibleRepositories = useMemo(
    () => repositories.filter((repository) => (repository.path ?? "").trim().length > 0),
    [repositories],
  );
  const selectedRepositoryIds = state.selectedRepositoryIds;
  const imageBucket = useMemo<PrdImageBucket | null>(() => {
    const firstSelectedId = selectedRepositoryIds[0];
    const repo = firstSelectedId != null
      ? state.repositories.find((item) => item.id === firstSelectedId)
      : state.repositories[0];
    if (!repo && !state.project) return null;
    return {
      repositoryPath: repo?.path ?? state.project?.rootPath ?? "",
      repositoryName: repo?.name ?? null,
      repositoryId: repo?.id ?? null,
      projectName: state.project?.name ?? null,
      projectId: state.project?.id ?? null,
    };
  }, [selectedRepositoryIds, state.project, state.repositories]);

  const pickProject = (projectId: string) => {
    const project = eligibleProjects.find((item) => item.id === projectId);
    if (!project) return;
    const target = projectToPrdSplitTarget(project, repositories);
    api.reset(target.project, target.repositories, target.context);
  };
  const pickRepository = (repositoryId: number) => {
    const repository = eligibleRepositories.find((item) => item.id === repositoryId);
    if (!repository) return;
    const target = repositoryToPrdSplitTarget(repository);
    api.reset(target.project, target.repositories, target.context);
  };
  const submit = () => {
    if (!state.project) {
      api.setGlobalError("请先选择目标");
      return;
    }
    const result = api.parseAndPlan();
    if (!result.ok) {
      api.setGlobalError(result.reason);
      return;
    }
    onSubmitted();
  };
  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={620}
      title={COPY.setupDrawer.title}
      extra={
        <Space>
          <Button icon={<HistoryOutlined />} onClick={() => setLegacyOpen(true)}>
            {COPY.setupDrawer.importLegacy}
          </Button>
          <Button type="primary" onClick={submit}>
            {COPY.setupDrawer.submit}
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size={16} className="mission-setup">
        <MissionTargetPicker
          targetKind={targetKind}
          projects={eligibleProjects}
          repositories={eligibleRepositories}
          selectedProjectId={state.context?.mode === "project" ? state.project?.id ?? null : null}
          selectedRepositoryId={state.context?.mode === "repository" ? state.context.repositoryId ?? null : null}
          onTargetKindChange={(kind) => {
            setTargetKind(kind);
            api.reset(null, [], null);
          }}
          onProjectChange={pickProject}
          onRepositoryChange={pickRepository}
        />
        {state.repositories.length > 0 ? (
          <section className="mission-setup__section">
            <Typography.Text strong>{COPY.setupDrawer.participatingRepos}</Typography.Text>
            <Checkbox.Group
              value={selectedRepositoryIds}
              onChange={(values) => api.setSelectedRepos(values as number[])}
              className="mission-setup__repo-list"
            >
              {state.repositories.map((repository) => (
                <Checkbox key={repository.id} value={repository.id}>
                  <Tag>{repositoryTypeChineseLabel(repository.type)}</Tag>
                  {repository.name}
                </Checkbox>
              ))}
            </Checkbox.Group>
          </section>
        ) : (
          <Alert type="info" showIcon message="选择目标后会显示参与仓位" />
        )}
        <section className="mission-setup__section">
          <Typography.Text strong>{COPY.setupDrawer.prdEditor}</Typography.Text>
          <PrdMarkdownEditor
            value={state.prdMarkdown}
            onChange={api.setPrdMarkdown}
            imageBucket={imageBucket}
            floatingToolbar
            minHeight={360}
          />
          <Typography.Text type="secondary">{state.prdMarkdown.length} 字符</Typography.Text>
        </section>
        {state.globalError ? (
          <Alert type="error" showIcon message="无法进入规划" description={state.globalError} />
        ) : null}
      </Space>
      <LegacyRunsModal
        open={legacyOpen}
        onClose={() => setLegacyOpen(false)}
        onPick={(markdown, summary) => {
          api.setPrdMarkdown(markdown);
          setLegacyOpen(false);
          message.success(`已导入历史 PRD（${summary.runId.slice(0, 8)}...）`);
        }}
      />
    </Drawer>
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
        message.error("该运行没有可恢复的 PRD 内容");
        return;
      }
      onPick(detail.prdMarkdown, summary);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setPicking(null);
    }
  };

  return (
    <Modal open={open} onCancel={onClose} footer={null} width="min(900px, 92vw)" title="历史 PRD 运行">
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
                  <Typography.Text code>{item.runId.slice(0, 8)}...</Typography.Text>
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

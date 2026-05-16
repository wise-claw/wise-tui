import { Alert, Badge, Button, Collapse, Empty, Space, Spin, Tag, Typography } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  compileTrellisWorkflow,
  type TrellisWorkflowCompiled,
  type TrellisWorkflowStep,
} from "../../../services/trellisRuntime";

interface WorkflowGraphPanelProps {
  projectId?: string | null;
  rootPath?: string | null;
  selectedFilePath?: string | null;
  enabled?: boolean;
}

type WorkflowStepWithFile = TrellisWorkflowStep & {
  filePath?: string | null;
};

export function WorkflowGraphPanel({
  projectId,
  rootPath,
  selectedFilePath,
  enabled = true,
}: WorkflowGraphPanelProps) {
  const [compiled, setCompiled] = useState<TrellisWorkflowCompiled | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!enabled || !rootPath) {
      setCompiled(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    compileTrellisWorkflow({ projectId, rootPath })
      .then((next) => {
        if (!cancelled) setCompiled(next);
      })
      .catch((err) => {
        if (!cancelled) {
          setCompiled(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, projectId, rootPath]);

  useEffect(() => load(), [load]);

  const platformTags = useMemo(() => {
    const set = new Set<string>();
    for (const block of compiled?.platformBlocks ?? []) {
      for (const platform of block.platforms) {
        if (platform.trim()) set.add(platform.trim());
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [compiled?.platformBlocks]);

  if (!rootPath) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前项目没有 Trellis rootPath" />;
  }

  if (loading && !compiled) {
    return (
      <div className="mission-workflow-panel__loading">
        <Spin size="small" />
      </div>
    );
  }

  if (error && !compiled) {
    return (
      <div className="mission-workflow-panel__empty">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无法读取 workflow.md" />
        <Typography.Paragraph type="secondary">{error}</Typography.Paragraph>
        <Button size="small" onClick={load}>
          重试
        </Button>
      </div>
    );
  }

  if (!compiled) {
    return null;
  }

  return (
    <section className="mission-workflow-panel">
      <div className="mission-workflow-panel__header">
        <div>
          <Typography.Text strong>Workflow phases</Typography.Text>
          <Typography.Paragraph type="secondary" className="mission-workflow-panel__path">
            {compiled.workflowPath}
          </Typography.Paragraph>
        </div>
        <Space size={6} wrap>
          <Badge count={compiled.validationIssues.length} size="small">
            <Tag color={compiled.validationIssues.length > 0 ? "warning" : "success"}>validation</Tag>
          </Badge>
          {loading ? <Tag color="processing">refreshing</Tag> : null}
        </Space>
      </div>

      {platformTags.length > 0 ? (
        <div className="mission-workflow-panel__platforms">
          <Typography.Text type="secondary">平台分支</Typography.Text>
          <Space size={4} wrap>
            {platformTags.map((platform) => (
              <Tag key={platform}>{platform}</Tag>
            ))}
          </Space>
        </div>
      ) : null}

      {compiled.validationIssues.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          message="Workflow validation issues"
          description={compiled.validationIssues.map((issue) => `${issue.severity}: ${issue.message}`).join("\n")}
        />
      ) : null}

      <Collapse
        size="small"
        defaultActiveKey={compiled.phases.map((phase) => phase.id)}
        items={compiled.phases.map((phase) => ({
          key: phase.id,
          label: (
            <Space size={6} wrap>
              <Typography.Text strong>{`Phase ${phase.id}`}</Typography.Text>
              <Typography.Text>{phase.title}</Typography.Text>
              <Tag>{phase.steps.length} steps</Tag>
            </Space>
          ),
          children: (
            <div className="mission-workflow-panel__steps">
              {phase.steps.map((step) => (
                <WorkflowStepRow
                  key={step.id}
                  step={step}
                  selectedFilePath={selectedFilePath}
                />
              ))}
            </div>
          ),
        }))}
      />
    </section>
  );
}

function WorkflowStepRow({
  step,
  selectedFilePath,
}: {
  step: WorkflowStepWithFile;
  selectedFilePath?: string | null;
}) {
  const filePath = step.filePath?.trim() || ".trellis/workflow.md";
  const highlighted = matchesSelectedFile(filePath, selectedFilePath);
  return (
    <div className={`mission-workflow-step ${highlighted ? "mission-workflow-step--highlighted" : ""}`}>
      <div className="mission-workflow-step__main">
        <Typography.Text code>{step.id}</Typography.Text>
        <Typography.Text>{step.title}</Typography.Text>
      </div>
      <Space size={4} wrap>
        {step.required ? <Tag color="red">required</Tag> : null}
        {step.repeatable ? <Tag color="blue">repeatable</Tag> : null}
        {step.once ? <Tag color="purple">once</Tag> : null}
        <Tag>{filePath}</Tag>
      </Space>
    </div>
  );
}

function matchesSelectedFile(stepFilePath: string, selectedFilePath?: string | null): boolean {
  const selected = normalizeFilePath(selectedFilePath);
  const stepPath = normalizeFilePath(stepFilePath);
  if (!selected || !stepPath) return false;
  return selected === stepPath || selected.endsWith(`/${stepPath}`) || stepPath.endsWith(`/${selected}`);
}

function normalizeFilePath(value?: string | null): string {
  return (value ?? "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

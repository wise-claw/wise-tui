import { Space, Typography } from "antd";
import type { SplitResult, TaskItem } from "../../types";

interface Props {
  task: TaskItem;
  activeResult: SplitResult | null;
  anchorResolvedInEditor: boolean;
}

export function TaskAnchorPopoverBody({ task, activeResult, anchorResolvedInEditor }: Props) {
  if (!activeResult) {
    return <Typography.Text type="secondary">暂无拆分结果。</Typography.Text>;
  }
  const descriptor = task.taskAnchors ?? activeResult.taskAnchorDescriptors?.[task.id];
  const position = activeResult.taskAnchorPositions?.[task.id];
  const anchorText = (activeResult.taskAnchorTexts?.[task.id] ?? "").trim();
  const link = activeResult.claudeSplitMapping?.taskRequirementLinks?.find((l) => l.taskId === task.id);
  const hasAny = Boolean(descriptor || position || anchorText || link);
  if (!hasAny) {
    return <Typography.Text type="secondary">当前任务尚无锚点与映射记录。</Typography.Text>;
  }
  return (
    <div
      className="app-prd-task-panel__task-anchor-popover-inner"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <Space orientation="vertical" size={10} style={{ width: "100%" }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          任务 id：<Typography.Text code>{task.id}</Typography.Text>
          {anchorResolvedInEditor ? " · 已在需求侧解析到锚点" : ""}
        </Typography.Text>
        {descriptor ? (
          <>
            <Typography.Text strong>结构化 taskAnchors</Typography.Text>
            <pre className="app-prd-task-panel__task-anchor-popover-pre">
              {JSON.stringify(descriptor, null, 2)}
            </pre>
          </>
        ) : null}
        {position ? (
          <>
            <Typography.Text strong>文档选区 taskAnchorPositions</Typography.Text>
            <Typography.Text copyable code>
              {`from=${position.from}, to=${position.to}`}
            </Typography.Text>
          </>
        ) : null}
        {anchorText ? (
          <>
            <Typography.Text strong>缓存文本 taskAnchorTexts</Typography.Text>
            <Typography.Paragraph className="app-prd-task-panel__task-anchor-popover-text" style={{ marginBottom: 0 }}>
              {anchorText}
            </Typography.Paragraph>
          </>
        ) : null}
        {link ? (
          <>
            <Typography.Text strong>需求映射</Typography.Text>
            <Typography.Text code copyable>
              {`requirementIds: ${(link.requirementIds ?? []).join(", ") || "（空）"}`}
            </Typography.Text>
            {link.rationale?.trim() ? (
              <Typography.Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 12 }}>
                {link.rationale.trim()}
              </Typography.Paragraph>
            ) : null}
          </>
        ) : null}
      </Space>
    </div>
  );
}

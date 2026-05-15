import { Alert, Button, Drawer, Empty, InputNumber, Space, Tag, Typography, message } from "antd";
import { useMemo, useRef, useState } from "react";
import type { PrdDocument, TaskItem } from "../../../types";
import type { RequirementsIndexV2 } from "../../../services/prdSplit/requirementsIndexVersion";
import {
  buildClusterPrdMarkdown,
  buildHighlightSegments,
  type HighlightRange,
} from "../../../services/prdSplit/clusterPrdSlice";
import {
  captureSelectionOffset,
  deriveAnchorFromRange,
  shiftAnchorEdge,
} from "../../PrdSplitWizard/anchorEdits";
import type { TaskEvidenceVM } from "../presenter/types";

interface PrdAnchorDrawerProps {
  open: boolean;
  evidence: TaskEvidenceVM | null;
  prd: PrdDocument | null;
  requirementsIndex: RequirementsIndexV2 | null;
  taskGroups: Array<{ id: string; title: string }>;
  onClose: () => void;
  onPatchAnchor: (clusterId: string, taskId: string, anchor: TaskItem["taskAnchors"], isManual: boolean) => void;
  onClearAnchor: (clusterId: string, taskId: string, isManual: boolean) => void;
}

export function PrdAnchorDrawer({
  open,
  evidence,
  prd,
  requirementsIndex,
  taskGroups,
  onClose,
  onPatchAnchor,
  onClearAnchor,
}: PrdAnchorDrawerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [shiftDelta, setShiftDelta] = useState(10);
  const [selectionVersion, setSelectionVersion] = useState(0);
  const groupTitle = taskGroups.find((group) => group.id === evidence?.clusterId)?.title ?? evidence?.technical.clusterTitle ?? "";
  const prdMarkdown = useMemo(() => {
    if (!prd || !requirementsIndex || !evidence) return "";
    return buildClusterPrdMarkdown(
      prd,
      requirementsIndex,
      evidence.technical.clusterRequirementIds,
    );
  }, [evidence, prd, requirementsIndex]);
  const ranges = useMemo<HighlightRange[]>(() => {
    if (!evidence?.taskAnchor) return [];
    return [{ from: evidence.taskAnchor.from, to: evidence.taskAnchor.to, taskId: evidence.taskId }];
  }, [evidence]);
  const segments = useMemo(() => buildHighlightSegments(prdMarkdown, ranges), [prdMarkdown, ranges]);

  const commitSelection = () => {
    if (!evidence || !containerRef.current) return;
    const offset = captureSelectionOffset(containerRef.current);
    if (!offset) {
      message.warning("请先在 PRD 文本中选中一段内容");
      return;
    }
    onPatchAnchor(
      evidence.clusterId,
      evidence.taskId,
      deriveAnchorFromRange(prdMarkdown, offset.from, offset.to),
      evidence.isManual,
    );
    window.getSelection()?.removeAllRanges();
    setSelectionVersion((current) => current + 1);
  };

  const shiftEdge = (edge: "start" | "end", delta: number) => {
    if (!evidence?.taskAnchor) return;
    onPatchAnchor(
      evidence.clusterId,
      evidence.taskId,
      shiftAnchorEdge(evidence.taskAnchor, edge, delta, prdMarkdown),
      evidence.isManual,
    );
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="min(880px, 92vw)"
      title={
        <Space>
          <Typography.Text>PRD 锚点</Typography.Text>
          {evidence ? <Tag>{evidence.taskId}</Tag> : null}
          {groupTitle ? <Typography.Text type="secondary">{groupTitle}</Typography.Text> : null}
        </Space>
      }
    >
      {!evidence ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="先选择一个任务" />
      ) : !prdMarkdown ? (
        <Alert type="warning" showIcon message="当前没有可查看的 PRD 文本" />
      ) : (
        <Space direction="vertical" size={12} className="mission-prd-anchor">
          <Space wrap>
            <Button type="primary" onClick={commitSelection}>
              选段写入锚点
            </Button>
            <Button disabled={!evidence.taskAnchor} onClick={() => onClearAnchor(evidence.clusterId, evidence.taskId, evidence.isManual)}>
              清除锚点
            </Button>
            <Typography.Text type="secondary">微调步长</Typography.Text>
            <InputNumber
              size="small"
              min={1}
              max={500}
              value={shiftDelta}
              onChange={(value) => setShiftDelta(typeof value === "number" ? value : 10)}
            />
            <Button disabled={!evidence.taskAnchor} onClick={() => shiftEdge("start", -shiftDelta)}>
              起点左移
            </Button>
            <Button disabled={!evidence.taskAnchor} onClick={() => shiftEdge("start", shiftDelta)}>
              起点右移
            </Button>
            <Button disabled={!evidence.taskAnchor} onClick={() => shiftEdge("end", -shiftDelta)}>
              终点左移
            </Button>
            <Button disabled={!evidence.taskAnchor} onClick={() => shiftEdge("end", shiftDelta)}>
              终点右移
            </Button>
          </Space>
          <div
            ref={containerRef}
            className="mission-prd-anchor__text"
            onMouseUp={() => setSelectionVersion((current) => current + 1)}
            onKeyUp={() => setSelectionVersion((current) => current + 1)}
          >
            {segments.map((segment, index) => {
              if (segment.taskIds.length === 0) return <span key={index}>{segment.text}</span>;
              return (
                <mark key={index} className="mission-prd-anchor__mark">
                  {segment.text}
                </mark>
              );
            })}
            <span hidden>{selectionVersion}</span>
          </div>
        </Space>
      )}
    </Drawer>
  );
}

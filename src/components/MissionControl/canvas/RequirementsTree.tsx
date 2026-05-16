import { useState } from "react";
import { Empty, Tree, Tag, Typography, Select } from "antd";
import {
  FileTextOutlined,
  CheckCircleOutlined,
  SwapOutlined,
} from "@ant-design/icons";
import type { RequirementTreeNodeVM } from "../presenter/types";
import { COPY } from "../copy";

interface RequirementsTreeProps {
  tree: RequirementTreeNodeVM[];
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  onMoveRequirement: (requirementId: string, targetTaskGroupId: string) => void;
  targetClusters?: Array<{ id: string; title: string }>;
}

export function RequirementsTree({
  tree,
  onSelect,
  onHover,
  onMoveRequirement,
  targetClusters = [],
}: RequirementsTreeProps) {
  const [reassignId, setReassignId] = useState<string | null>(null);
  const treeData = tree.map((node) => toTreeNode(node, onHover));

  return (
    <section className="mission-column mission-column--tree">
      <div className="mission-column__header">
        <span className="mission-column__title">
          <FileTextOutlined />
          {COPY.columns.requirements}
        </span>
        <span className="mission-column__count">{tree.length} 条</span>
      </div>
      <div className="mission-column__scroll">
        {tree.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="分析 PRD 后自动生成需求列表"
          />
        ) : (
          <Tree
            treeData={treeData}
            selectedKeys={tree.filter((n) => n.isHighlighted).map((n) => n.id)}
            onSelect={(keys) => {
              if (keys.length > 0) onSelect(String(keys[0]));
            }}
            blockNode
            showIcon
            motion
          />
        )}
      </div>

      {/* Requirement reassign — pick target cluster */}
      {targetClusters.length > 1 ? (
        <div className="mission-column__reassign">
          <SwapOutlined style={{ color: "var(--mission-dim)", fontSize: 12 }} />
          <Select
            size="small"
            style={{ flex: 1, minWidth: 0 }}
            placeholder="选择目标集群以重新分配…"
            value={reassignId}
            onChange={(val) => {
              setReassignId(val ?? null);
            }}
            options={targetClusters.map((c) => ({ value: c.id, label: c.title }))}
            allowClear
          />
          <button
            type="button"
            className="mission-btn-primary" style={{padding: "2px 12px", fontSize: 11}}
            disabled={!reassignId}
            onClick={() => {
              const selected = tree.find((n) => n.isHighlighted);
              if (selected && reassignId) {
                onMoveRequirement(selected.id, reassignId);
                setReassignId(null);
              }
            }}
          >
            移动
          </button>
        </div>
      ) : null}
    </section>
  );
}

const PRIORITY_COLORS: Record<string, string> = { P0: "red", P1: "orange", P2: "default" };

function toTreeNode(
  node: RequirementTreeNodeVM,
  onHover: (id: string | null) => void,
): any {
  const donePercent =
    node.taskCount > 0 ? Math.round((node.completedTaskCount / node.taskCount) * 100) : 0;
  const doneIcon =
    node.completedTaskCount > 0 && donePercent === 100 ? (
      <CheckCircleOutlined style={{ color: "var(--mission-success)", fontSize: 13 }} />
    ) : undefined;

  return {
    key: node.id,
    title: (
      <span
        className={`mission-tree-node ${node.isHighlighted ? "mission-tree-node--highlighted" : ""}`}
        onMouseEnter={() => onHover(node.id)}
        onMouseLeave={() => onHover(null)}
      >
        <Typography.Text
          className="mission-tree-node__label"
          strong={node.isHighlighted}
        >
          {node.label}
        </Typography.Text>
        <span className="mission-tree-node__meta">
          <Typography.Text className="mission-tree-node__id" type="secondary">
            {node.machineId}
          </Typography.Text>
          {node.priority ? (
            <Tag color={PRIORITY_COLORS[node.priority]} style={{ fontSize: 10, lineHeight: "16px", margin: 0 }}>
              {node.priority}
            </Tag>
          ) : null}
          {node.taskCount > 0 ? (
            <span className="mission-tree-node__count">{node.taskCount}</span>
          ) : null}
        </span>
      </span>
    ),
    icon: doneIcon,
    children: node.children?.map((child) => toTreeNode(child, onHover)),
  };
}

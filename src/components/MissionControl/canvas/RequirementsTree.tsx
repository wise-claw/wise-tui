import { Empty, Tree, Tag, Typography } from "antd";
import {
  FileTextOutlined,
  CheckCircleOutlined,
} from "@ant-design/icons";
import type { RequirementTreeNodeVM } from "../presenter/types";
import { COPY } from "../copy";

interface RequirementsTreeProps {
  tree: RequirementTreeNodeVM[];
  onSelect: (id: string) => void;
  onMoveRequirement: (requirementId: string, targetTaskGroupId: string) => void;
}

export function RequirementsTree({ tree, onSelect }: RequirementsTreeProps) {
  const treeData = tree.map(toTreeNode);

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
    </section>
  );
}

const PRIORITY_COLORS: Record<string, string> = { P0: "red", P1: "orange", P2: "default" };

function toTreeNode(node: RequirementTreeNodeVM): any {
  const donePercent =
    node.taskCount > 0 ? Math.round((node.completedTaskCount / node.taskCount) * 100) : 0;
  const doneIcon =
    node.completedTaskCount > 0 && donePercent === 100 ? (
      <CheckCircleOutlined style={{ color: "var(--mission-success)", fontSize: 13 }} />
    ) : undefined;

  return {
    key: node.id,
    title: (
      <span className={`mission-tree-node ${node.isHighlighted ? "mission-tree-node--highlighted" : ""}`}>
        <Typography.Text
          className="mission-tree-node__label"
          strong={node.isHighlighted}
        >
          {node.label}
        </Typography.Text>
        <span className="mission-tree-node__meta">
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
    children: node.children?.map(toTreeNode),
  };
}

import { CodeOutlined, FileOutlined, FolderOpenOutlined, GlobalOutlined } from "@ant-design/icons";
import { Button, Descriptions, Tag, Typography } from "antd";
import type { GraphNode } from "../../types/codeKnowledgeGraph";

const { Text } = Typography;

interface InspectorPanelProps {
  node: GraphNode | null;
  onNodeExpand?: (node: GraphNode) => void;
  onOpenRepositoryFile?: (relativePath: string) => void;
  repositoryId: number | null;
}

const KIND_ICONS: Record<string, typeof FileOutlined> = {
  repo: GlobalOutlined,
  folder: FolderOpenOutlined,
  file: FileOutlined,
  symbol: CodeOutlined,
  api_operation: CodeOutlined,
  schema: FileOutlined,
};

const KIND_LABELS: Record<string, string> = {
  repo: "仓库",
  folder: "目录",
  file: "文件",
  symbol: "符号",
  api_operation: "API 操作",
  schema: "模型",
};

export function InspectorPanel({ node, onNodeExpand, onOpenRepositoryFile, repositoryId }: InspectorPanelProps) {
  if (!node) {
    return (
      <div className="app-code-graph-inspector app-code-graph-inspector--empty">
        <Text type="secondary">点击图谱中的节点查看详情</Text>
      </div>
    );
  }

  const Icon = KIND_ICONS[node.kind] ?? FileOutlined;
  const lineRangeLabel =
    node.range != null
      ? `${node.range.start.line + 1}–${node.range.end.line + 1}`
      : null;

  return (
    <div className="app-code-graph-inspector">
      <div className="app-code-graph-inspector-header">
        <Icon className="app-code-graph-inspector-icon" />
        <div className="app-code-graph-inspector-title-block">
          <Text strong className="app-code-graph-inspector-title">
            {node.label}
          </Text>
          <Tag color="blue" className="app-code-graph-inspector-kind-tag">
            {KIND_LABELS[node.kind] ?? node.kind}
          </Tag>
        </div>
      </div>

      {node.kind === "file" && onOpenRepositoryFile ? (
        <Button
          type="primary"
          size="small"
          block
          className="app-code-graph-inspector-open-btn"
          onClick={() => onOpenRepositoryFile(node.path)}
        >
          在编辑器中打开
        </Button>
      ) : null}

      <Descriptions
        className="app-code-graph-inspector-desc"
        column={1}
        size="small"
        bordered
        styles={{
          label: { width: 52, padding: "4px 8px", fontSize: 12 },
          content: { padding: "4px 8px", fontSize: 12, wordBreak: "break-all" },
        }}
      >
        <Descriptions.Item label="ID">
          <Text copyable={{ text: node.id }} className="app-code-graph-inspector-id">
            {node.id}
          </Text>
        </Descriptions.Item>
        <Descriptions.Item label="路径">{node.path}</Descriptions.Item>
        <Descriptions.Item label="仓库">{node.repoId}</Descriptions.Item>
        {node.symbolKind ? <Descriptions.Item label="符号">{node.symbolKind}</Descriptions.Item> : null}
        {lineRangeLabel ? <Descriptions.Item label="行号">{lineRangeLabel}</Descriptions.Item> : null}
      </Descriptions>

      {onNodeExpand && repositoryId && node.kind !== "repo" ? (
        <Button type="link" size="small" className="app-code-graph-inspector-expand-link" onClick={() => onNodeExpand(node)}>
          展开子图（1-hop）
        </Button>
      ) : null}
    </div>
  );
}

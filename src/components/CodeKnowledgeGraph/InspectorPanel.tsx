import { CodeOutlined, FileOutlined, FolderOpenOutlined, GlobalOutlined } from "@ant-design/icons";
import { Button, Descriptions, Tag, Typography } from "antd";
import type { GraphNode } from "../../types/codeKnowledgeGraph";

const { Text, Title } = Typography;

interface InspectorPanelProps {
  node: GraphNode | null;
  onNodeExpand?: (node: GraphNode) => void;
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

export function InspectorPanel({ node, onNodeExpand, repositoryId }: InspectorPanelProps) {
  if (!node) {
    return (
      <div style={{ padding: 24, textAlign: "center" }}>
        <Text type="secondary">点击图谱中的节点查看详情</Text>
      </div>
    );
  }

  const Icon = KIND_ICONS[node.kind] ?? FileOutlined;
  const kindLabels: Record<string, string> = {
    repo: "仓库",
    folder: "目录",
    file: "文件",
    symbol: "符号",
    api_operation: "API 操作",
    schema: "模型",
  };

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <Icon style={{ fontSize: 20, color: "var(--ant-color-primary)" }} />
        <Title level={5} style={{ margin: 0 }}>{node.label}</Title>
        <Tag color="blue">{kindLabels[node.kind] ?? node.kind}</Tag>
      </div>
      <Descriptions column={1} size="small" bordered>
        <Descriptions.Item label="ID">
          <Text copyable={{ text: node.id }} style={{ fontSize: 11 }}>{node.id}</Text>
        </Descriptions.Item>
        <Descriptions.Item label="路径">{node.path}</Descriptions.Item>
        <Descriptions.Item label="仓库 ID">{node.repoId}</Descriptions.Item>
        {node.symbolKind && (
          <Descriptions.Item label="符号类型">{node.symbolKind}</Descriptions.Item>
        )}
        {node.range && (
          <>
            <Descriptions.Item label="起始行">{node.range.start.line + 1}</Descriptions.Item>
            <Descriptions.Item label="结束行">{node.range.end.line + 1}</Descriptions.Item>
          </>
        )}
      </Descriptions>
      {onNodeExpand && repositoryId && node.kind !== "repo" && (
        <Button
          type="link"
          size="small"
          style={{ marginTop: 12, padding: 0 }}
          onClick={() => onNodeExpand(node)}
        >
          展开子图（1-hop）
        </Button>
      )}
    </div>
  );
}

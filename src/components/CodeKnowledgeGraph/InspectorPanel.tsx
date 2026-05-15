import { CodeOutlined, FileOutlined, FolderOpenOutlined, GlobalOutlined } from "@ant-design/icons";
import { Button, Descriptions, Tag, Typography } from "antd";
import { openCodeGraphNodeInIde } from "../../services/openCodeGraphNodeInIde";
import type { GraphNode } from "../../types/codeKnowledgeGraph";
import { isMonacoSupportedFilePath } from "../../utils/repositoryFilePreview";

const { Text, Link } = Typography;

interface InspectorPanelProps {
  node: GraphNode | null;
  /** 仓库根目录绝对路径，用于「IDE 中打开」 */
  repositoryPath?: string | null;
  /** 多仓合并时用于把 `repoId` 显示为仓库名称 */
  repositorySummaries?: { id: number; name: string }[];
  onOpenRepositoryFile?: (relativePath: string) => void;
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

/** GitNexus-style `symbolKind` (Class, Method, Property, …) → 中文 */
const SYMBOL_KIND_LABELS: Record<string, string> = {
  Class: "类",
  Interface: "接口",
  Function: "函数",
  Method: "方法",
  Property: "属性",
  Struct: "结构体",
  Enum: "枚举",
  Trait: "Trait",
  TypeAlias: "类型别名",
  Module: "模块",
};

export function InspectorPanel({
  node,
  repositoryPath,
  repositorySummaries,
  onOpenRepositoryFile,
}: InspectorPanelProps) {
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

  const repoName = repositorySummaries?.find((r) => r.id === node.repoId)?.name;
  const repoDisplay = repoName != null ? `${repoName}（#${node.repoId}）` : String(node.repoId);

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

      {node.kind === "file" && onOpenRepositoryFile && !isMonacoSupportedFilePath(node.path) ? (
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
          label: {
            width: 88,
            minWidth: 88,
            maxWidth: 88,
            padding: "4px 10px",
            fontSize: 12,
            whiteSpace: "nowrap",
          },
          content: { padding: "4px 8px", fontSize: 12, wordBreak: "break-all" },
        }}
      >
        <Descriptions.Item label="ID">
          <Text copyable={{ text: node.id }} className="app-code-graph-inspector-id">
            {node.id}
          </Text>
        </Descriptions.Item>
        <Descriptions.Item label="路径">
          <div className="app-code-graph-inspector-path-row">
            <Text copyable={{ text: node.path }} className="app-code-graph-inspector-path-text">
              {node.path}
            </Text>
            {repositoryPath ? (
              <Link
                className="app-code-graph-inspector-ide-link"
                onClick={() => void openCodeGraphNodeInIde(repositoryPath, node)}
              >
                IDE 中打开
              </Link>
            ) : null}
          </div>
        </Descriptions.Item>
        <Descriptions.Item label="仓库">{repoDisplay}</Descriptions.Item>
        {node.symbolKind ? (
          <Descriptions.Item label="符号">
            {SYMBOL_KIND_LABELS[node.symbolKind] ?? node.symbolKind}
          </Descriptions.Item>
        ) : null}
        {lineRangeLabel ? <Descriptions.Item label="行号">{lineRangeLabel}</Descriptions.Item> : null}
      </Descriptions>
    </div>
  );
}

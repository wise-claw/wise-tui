import { Button, Empty, Space, Typography } from "antd";
import { FileSearchOutlined } from "@ant-design/icons";
import {
  WORKFLOW_UI_EVENT_OPEN_REPOSITORY_FILE,
  type OpenRepositoryFileDetail,
} from "../../../constants/workflowUiEvents";
import type { TaskEvidenceVM } from "../presenter/types";

interface AnchorSectionProps {
  evidence: TaskEvidenceVM;
  onOpenPrdAnchor: () => void;
}

export function AnchorSection({ evidence, onOpenPrdAnchor }: AnchorSectionProps) {
  const openCodeAnchor = (anchor: TaskEvidenceVM["codeAnchors"][number]) => {
    if (!anchor.filePath.trim()) return;
    const detail: OpenRepositoryFileDetail = {
      repositoryId: anchor.repositoryId,
      relativePath: anchor.filePath,
      line: anchor.line,
    };
    window.dispatchEvent(new CustomEvent(WORKFLOW_UI_EVENT_OPEN_REPOSITORY_FILE, { detail }));
  };
  return (
    <section className="mission-evidence-section">
      <Typography.Text className="mission-evidence-section__title">PRD 锚点</Typography.Text>
      {evidence.prdAnchor ? (
        <div className="mission-anchor-preview">
          <Typography.Paragraph>{evidence.prdAnchor.preview}</Typography.Paragraph>
          <Typography.Text type="secondary">
            位置 {evidence.prdAnchor.from} - {evidence.prdAnchor.to}
          </Typography.Text>
          <Button size="small" icon={<FileSearchOutlined />} onClick={onOpenPrdAnchor}>
            在 PRD 中查看
          </Button>
        </div>
      ) : (
        <div className="mission-anchor-preview">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚无 PRD 锚点" />
          <Button size="small" icon={<FileSearchOutlined />} onClick={onOpenPrdAnchor}>
            建立 PRD 锚点
          </Button>
        </div>
      )}
      <Typography.Text className="mission-evidence-section__title">代码锚点</Typography.Text>
      {evidence.codeAnchors.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚无代码锚点" />
      ) : (
        <Space orientation="vertical" size={6} className="mission-code-anchor-list">
          {evidence.codeAnchors.map((anchor, index) => (
            <Button
              key={`${anchor.raw}-${index}`}
              size="small"
              icon={<FileSearchOutlined />}
              onClick={() => openCodeAnchor(anchor)}
            >
              {anchor.filePath}
              {anchor.line ? `:${anchor.line}` : ""}
            </Button>
          ))}
        </Space>
      )}
    </section>
  );
}

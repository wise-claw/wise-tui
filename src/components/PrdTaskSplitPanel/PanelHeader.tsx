import { CloseOutlined } from "@ant-design/icons";
import { Button, Space, Tag, Typography } from "antd";

interface HeaderRepositoryTagItem {
  key: string;
  label: string;
}

interface Props {
  projectName: string;
  repositoryTagItems: HeaderRepositoryTagItem[];
  closingActive: boolean;
  onClose: () => void;
}

export function PanelHeader({
  projectName,
  repositoryTagItems,
  closingActive,
  onClose,
}: Props) {
  return (
    <Space className="app-prd-task-panel__header" align="start">
      <div className="app-prd-task-panel__header-summary-wrap" style={{ minWidth: 0, flex: 1 }}>
        {projectName || repositoryTagItems.length > 0 ? (
          <Space wrap size={[6, 4]} align="center">
            {projectName ? (
              <Typography.Text type="secondary" className="app-prd-task-panel__header-project-line">
                项目：{projectName}
              </Typography.Text>
            ) : null}
            {repositoryTagItems.map((item) => (
              <Tag key={item.key} className="app-prd-task-panel__header-repo-tag" bordered={false}>
                {item.label}
              </Tag>
            ))}
            {projectName && repositoryTagItems.length === 0 ? (
              <Tag className="app-prd-task-panel__header-repo-tag" bordered={false}>
                暂无仓库
              </Tag>
            ) : null}
          </Space>
        ) : null}
      </div>
      <Space className="app-prd-task-panel__header-actions">
        <Button
          size="small"
          icon={<CloseOutlined />}
          onClick={onClose}
          aria-label="关闭需求面板"
          disabled={closingActive}
        />
      </Space>
    </Space>
  );
}

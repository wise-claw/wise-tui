import { MenuFoldOutlined, MenuUnfoldOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Card, Empty, Input, Popconfirm, Select, Space, Tag, Tooltip, Typography } from "antd";
import type { WorkflowTemplateItem } from "../../types";
import type { WorkflowConfigModalController } from "./useWorkflowConfigModal";

type Props = Pick<
  WorkflowConfigModalController,
  | "teamListCollapsed"
  | "setTeamListCollapsed"
  | "editingTemplateId"
  | "editingTemplate"
  | "resetEditor"
  | "teamKeyword"
  | "setTeamKeyword"
  | "statusFilter"
  | "setStatusFilter"
  | "statusFilterOptions"
  | "filteredTemplates"
  | "graphStatusByWorkflowId"
  | "startEditingTemplate"
  | "handleDeleteTemplate"
> & {
  templates: WorkflowTemplateItem[];
};

export function WorkflowConfigTeamSidebar({
  templates,
  teamListCollapsed,
  setTeamListCollapsed,
  editingTemplateId,
  editingTemplate,
  resetEditor,
  teamKeyword,
  setTeamKeyword,
  statusFilter,
  setStatusFilter,
  statusFilterOptions,
  filteredTemplates,
  graphStatusByWorkflowId,
  startEditingTemplate,
  handleDeleteTemplate,
}: Props) {
  return (
    <aside
      className={`app-workflow-config-sidebar${teamListCollapsed ? " app-workflow-config-sidebar--collapsed" : ""}`}
      aria-label="团队列表"
    >
      {teamListCollapsed ? (
        <div className="app-workflow-config-sidebar-collapsed">
          <Tooltip title="展开团队列表" placement="right">
            <Button
              type="text"
              size="small"
              icon={<MenuUnfoldOutlined />}
              aria-label="展开团队列表"
              onClick={() => setTeamListCollapsed(false)}
            />
          </Tooltip>
          <Tooltip title="新建团队" placement="right">
            <Button
              size="small"
              type={!editingTemplateId ? "primary" : "default"}
              icon={<PlusOutlined />}
              aria-label="新建团队"
              onClick={resetEditor}
            />
          </Tooltip>
          {editingTemplate ? (
            <Tooltip title={editingTemplate.name} placement="right">
              <span className="app-workflow-config-sidebar-collapsed-active" aria-hidden>
                {editingTemplate.name.slice(0, 1)}
              </span>
            </Tooltip>
          ) : null}
        </div>
      ) : (
        <Space orientation="vertical" size={10} className="app-workflow-config-sidebar-space">
          <div className="app-workflow-config-sidebar-header">
            <Typography.Text strong>团队列表</Typography.Text>
            <Space size={4} className="app-workflow-config-sidebar-header-actions">
              <Button
                size="small"
                type={!editingTemplateId ? "primary" : "default"}
                onClick={resetEditor}
                className="app-workflow-config-create-btn"
              >
                新建团队
              </Button>
              <Tooltip title="收起团队列表">
                <Button
                  type="text"
                  size="small"
                  icon={<MenuFoldOutlined />}
                  aria-label="收起团队列表"
                  onClick={() => setTeamListCollapsed(true)}
                />
              </Tooltip>
            </Space>
          </div>
          <div className="app-workflow-config-filter-row">
            <Input.Search
              size="small"
              allowClear
              placeholder="搜索团队名"
              value={teamKeyword}
              onChange={(event) => setTeamKeyword(event.target.value)}
            />
            <Select
              size="small"
              value={statusFilter}
              options={statusFilterOptions}
              onChange={(value) => setStatusFilter(value)}
              className="app-workflow-config-filter-status"
            />
          </div>
          {templates.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无团队模板" />
          ) : filteredTemplates.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无匹配结果" />
          ) : (
            filteredTemplates.map((row) => {
              const status = graphStatusByWorkflowId[row.id] ?? "none";
              const active = editingTemplateId === row.id;
              return (
                <Card
                  key={row.id}
                  size="small"
                  hoverable
                  onClick={() => void startEditingTemplate(row)}
                  className={`app-workflow-config-team-card${active ? " app-workflow-config-team-card--active" : ""}`}
                >
                  <Space orientation="vertical" size={6} className="app-workflow-config-team-card-inner">
                    <div className="app-workflow-config-team-card-title-row">
                      <Typography.Text strong ellipsis className="app-workflow-config-team-card-title">
                        {row.name}
                      </Typography.Text>
                    </div>
                    <Typography.Text type="secondary" className="app-workflow-config-team-card-meta">
                      阶段数：{row.stages.length}
                    </Typography.Text>
                    <div className="app-workflow-config-team-card-actions">
                      <Space size={4} className="app-workflow-config-team-card-tags">
                        {row.isDefault ? <Tag color="gold">默认</Tag> : null}
                        {status === "published" ? <Tag color="success">已发布</Tag> : null}
                        {status === "draft" ? <Tag color="processing">草稿</Tag> : null}
                        {status === "unknown" ? <Tag color="warning">未知</Tag> : null}
                        {status === "none" ? <Tag>未生成</Tag> : null}
                      </Space>
                      <Popconfirm
                        title="确认删除该团队？"
                        onConfirm={() => void handleDeleteTemplate(row.id)}
                        okText="删除"
                        cancelText="取消"
                      >
                        <Button
                          size="small"
                          danger
                          type="link"
                          className="app-workflow-config-team-card-delete"
                          onClick={(event) => {
                            event.stopPropagation();
                          }}
                        >
                          删除
                        </Button>
                      </Popconfirm>
                    </div>
                  </Space>
                </Card>
              );
            })
          )}
        </Space>
      )}
    </aside>
  );
}

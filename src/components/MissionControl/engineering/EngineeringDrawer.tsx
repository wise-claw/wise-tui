import { Button, Drawer, Empty, Space, Switch, Tabs, Typography } from "antd";
import {
  WORKFLOW_UI_EVENT_OPEN_WORKFLOW_CONFIG,
} from "../../../constants/workflowUiEvents";
import { COPY } from "../copy";
import type { EngineeringDetailsVM } from "../presenter/types";
import { ClusterDetailsCard } from "./ClusterDetailsCard";
import { WorkflowGraphPanel } from "./WorkflowGraphPanel";

interface EngineeringDrawerProps {
  open: boolean;
  details: EngineeringDetailsVM;
  projectId: string | null;
  rootPath?: string | null;
  reuseExistingParents: boolean;
  dispatchOnlyDirty: boolean;
  onReuseExistingParentsChange: (value: boolean) => void;
  onDispatchOnlyDirtyChange: (value: boolean) => void;
  onRenameTaskGroup: (clusterId: string, title: string) => void;
  onClose: () => void;
}

export function EngineeringDrawer({
  open,
  details,
  projectId,
  rootPath,
  reuseExistingParents,
  dispatchOnlyDirty,
  onReuseExistingParentsChange,
  onDispatchOnlyDirtyChange,
  onRenameTaskGroup,
  onClose,
}: EngineeringDrawerProps) {
  return (
    <Drawer open={open} onClose={onClose} size={760} title={COPY.engineeringDrawer.title}>
      <Tabs
        items={[
          {
            key: "diagnostics",
            label: COPY.engineeringDrawer.diagnosticsHeading,
            children: (
              <Space direction="vertical" size={14} className="mission-engineering-list">
                <div className="mission-engineering-diagnostics__controls">
                  <Space wrap size={16}>
                    <Switch checked={reuseExistingParents} onChange={onReuseExistingParentsChange} />
                    <Typography.Text>复用历史父任务</Typography.Text>
                    <Switch checked={dispatchOnlyDirty} onChange={onDispatchOnlyDirtyChange} />
                    <Typography.Text>只处理有变化的任务分组</Typography.Text>
                  </Space>
                </div>
                <section className="mission-engineering-diagnostics__block">
                  <Typography.Text strong>{COPY.engineeringDrawer.clustersHeading}</Typography.Text>
                  <div className="mission-engineering-diagnostics__block-body">
                    {details.clusters.length === 0 ? (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无任务分组" />
                    ) : (
                      details.clusters.map((cluster) => (
                        <ClusterDetailsCard key={cluster.id} cluster={cluster} onRename={onRenameTaskGroup} />
                      ))
                    )}
                  </div>
                </section>
                <section className="mission-engineering-diagnostics__block">
                  <Typography.Text strong>Workflow phases</Typography.Text>
                  <div className="mission-engineering-diagnostics__block-body">
                    <WorkflowGraphPanel
                      projectId={projectId}
                      rootPath={rootPath}
                      enabled={open}
                    />
                  </div>
                </section>
                <section className="mission-engineering-diagnostics__block">
                  <Typography.Text strong>{COPY.engineeringDrawer.graphHeading}</Typography.Text>
                  <div className="mission-engineering-diagnostics__block-body">
                    {details.workflowGraph ? (
                      <Space direction="vertical" size={12}>
                        <Typography.Text code>{details.workflowGraph.workflowId}</Typography.Text>
                        <Typography.Text>
                          {details.workflowGraph.nodeCount} nodes / {details.workflowGraph.edgeCount} edges / {details.workflowGraph.status}
                        </Typography.Text>
                        <Button
                          onClick={() => {
                            window.dispatchEvent(new CustomEvent(WORKFLOW_UI_EVENT_OPEN_WORKFLOW_CONFIG, {
                              detail: {
                                workflowId: details.workflowGraph?.workflowId,
                                projectId: projectId ?? undefined,
                              },
                            }));
                          }}
                        >
                          打开执行编排
                        </Button>
                      </Space>
                    ) : (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未生成 workflow graph" />
                    )}
                  </div>
                </section>
              </Space>
            ),
          },
        ]}
      />
    </Drawer>
  );
}

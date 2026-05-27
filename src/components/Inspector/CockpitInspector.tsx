import { Layout, Typography } from "antd";
import { useMemo } from "react";
import { MAIN_LAYOUT_RIGHT_SIDER_WIDTH_PX } from "../../constants/mainLayoutWidths";
import type {
  EmployeeMonitorItem,
  ProjectItem,
} from "../../types";
import "./Inspector.css";

const { Sider } = Layout;
const { Text } = Typography;

export interface CockpitInspectorProps {
  dark: boolean;
  collapsed: boolean;
  /** Sider 宽度（px）；默认与 RightPanel 一致。 */
  siderWidth?: number;
  /** 当前选中项目（用于显示 mission 概览）。 */
  activeProject: ProjectItem | null;
  /** 子代理活动列表（来自 monitor overview）。 */
  employeeMonitorItems: EmployeeMonitorItem[];
}

/**
 * Cockpit 模式 Inspector：在 cockpit 主屏旁展示 Mission 上下文。
 *
 * 当前阶段（P1）显示：
 *  - Project / Mission 概览（项目名 / 关联仓库数）
 *  - 子代理活动摘要（来自 useMonitorOverview 的 employeeMonitorItems）
 *  - 当存在活动仓库时，在底部继续渲染 GitPanel
 *
 * 任务详情 / PRD 锚点 / 实时 stdout 等更深的视角由需求助手工作台或
 * Trellis 运行透镜承担；本 Inspector 只是 Cockpit 主屏的补充上下文。
 */
export function CockpitInspector({
  dark,
  collapsed,
  siderWidth = MAIN_LAYOUT_RIGHT_SIDER_WIDTH_PX,
  activeProject,
  employeeMonitorItems,
}: CockpitInspectorProps) {
  const activeAgents = useMemo(
    () => employeeMonitorItems.filter((item) => item.status === "in_progress"),
    [employeeMonitorItems],
  );
  const idleAgents = useMemo(
    () => employeeMonitorItems.filter((item) => item.status !== "in_progress"),
    [employeeMonitorItems],
  );

  return (
    <Sider
      width={siderWidth}
      collapsedWidth={0}
      collapsed={collapsed}
      className="app-right-panel app-cockpit-inspector"
      theme={dark ? "dark" : "light"}
    >
      <div className="app-right-panel-inner">
        <section className="app-cockpit-inspector-section" aria-label="Mission 概览">
          <header className="app-cockpit-inspector-section-header">
            <Text strong>Mission 概览</Text>
          </header>
          <div className="app-cockpit-inspector-section-body">
            {activeProject ? (
              <>
                <div className="app-cockpit-inspector-row">
                  <Text type="secondary">工作区</Text>
                  <Text>{activeProject.name}</Text>
                </div>
                <div className="app-cockpit-inspector-row">
                  <Text type="secondary">关联仓库</Text>
                  <Text>{activeProject.repositoryIds.length} 个</Text>
                </div>
              </>
            ) : (
              <Text type="secondary">未选中工作区</Text>
            )}
          </div>
        </section>

        <section className="app-cockpit-inspector-section" aria-label="子代理活动">
          <header className="app-cockpit-inspector-section-header">
            <Text strong>子代理活动</Text>
            <Text type="secondary">
              {activeAgents.length} 运行 / {employeeMonitorItems.length} 总计
            </Text>
          </header>
          <div className="app-cockpit-inspector-section-body app-cockpit-inspector-agents">
            {employeeMonitorItems.length === 0 ? (
              <Text type="secondary">暂无子代理活动</Text>
            ) : (
              <>
                {activeAgents.map((item) => (
                  <div key={item.employeeId} className="app-cockpit-inspector-agent-item">
                    <span className="app-cockpit-inspector-agent-status app-cockpit-inspector-agent-status--running" />
                    <div className="app-cockpit-inspector-agent-meta">
                      <Text strong>{item.name}</Text>
                      <Text type="secondary" ellipsis>
                        {item.previewText || "运行中"}
                      </Text>
                    </div>
                  </div>
                ))}
                {idleAgents.length > 0 ? (
                  <details className="app-cockpit-inspector-agent-idle-group">
                    <summary>{idleAgents.length} 个空闲子代理</summary>
                    {idleAgents.map((item) => (
                      <div key={item.employeeId} className="app-cockpit-inspector-agent-item">
                        <span className="app-cockpit-inspector-agent-status" />
                        <div className="app-cockpit-inspector-agent-meta">
                          <Text>{item.name}</Text>
                        </div>
                      </div>
                    ))}
                  </details>
                ) : null}
              </>
            )}
          </div>
        </section>

      </div>
    </Sider>
  );
}

import {
  ApartmentOutlined,
  AppstoreAddOutlined,
  AuditOutlined,
  DesktopOutlined,
  FolderAddOutlined,
  PartitionOutlined,
  RightOutlined,
  RocketOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";
import wiseLogoUrl from "../../../app-icon.png";
import "./index.css";

const WELCOME_HIGHLIGHTS: ReadonlyArray<{
  label: string;
  icon: ReactNode;
}> = [
  { label: "AI 可视化窗口", icon: <DesktopOutlined /> },
  { label: "Wise Workflow 研发流", icon: <PartitionOutlined /> },
  { label: "多 Agent 并发", icon: <TeamOutlined /> },
  { label: "工作流编排", icon: <ApartmentOutlined /> },
  { label: "全流程溯源", icon: <AuditOutlined /> },
  { label: "自动驾驶", icon: <RocketOutlined /> },
];

export interface WorkspaceWelcomeLandingProps {
  onAddWorkspace: () => void;
  onAddStandaloneRepo: () => void;
}

export function WorkspaceWelcomeLanding({
  onAddWorkspace,
  onAddStandaloneRepo,
}: WorkspaceWelcomeLandingProps) {
  return (
    <div className="app-workspace-welcome-landing" role="region" aria-label="欢迎使用 Wise">
      <div className="app-workspace-welcome-landing__backdrop" aria-hidden>
        <span className="app-workspace-welcome-landing__glow app-workspace-welcome-landing__glow--a" />
        <span className="app-workspace-welcome-landing__glow app-workspace-welcome-landing__glow--b" />
        <span className="app-workspace-welcome-landing__grid" />
      </div>
      <div className="app-workspace-welcome-landing__drag" data-tauri-drag-region aria-hidden />

      <div className="app-workspace-welcome-landing__shell">
        <header className="app-workspace-welcome-landing__intro">
          <div className="app-workspace-welcome-landing__logo-wrap">
            <img
              className="app-workspace-welcome-landing__logo"
              src={wiseLogoUrl}
              alt=""
              width={88}
              height={88}
              draggable={false}
            />
          </div>
          <h1 className="app-workspace-welcome-landing__title">Wise</h1>
          <p className="app-workspace-welcome-landing__tagline">
            <span className="app-workspace-welcome-landing__tagline-dot" />
            以 Claude Code 为底座的 AI 研发新范式
          </p>
          <p className="app-workspace-welcome-landing__mission">
            结合 AI 可视化窗口与深度定制的 Wise Workflow 研发工作流，引入多 Agent 并发、工作流编排，汇聚桌面端全部能力，打造接近全自动开发的研发工具——对需求、任务与开发全程溯源、自动驾驶。
          </p>
          <ul className="app-workspace-welcome-landing__highlights" aria-label="核心能力">
            {WELCOME_HIGHLIGHTS.map((item) => (
              <li key={item.label} className="app-workspace-welcome-landing__highlight">
                <span className="app-workspace-welcome-landing__highlight-icon" aria-hidden>
                  {item.icon}
                </span>
                <span className="app-workspace-welcome-landing__highlight-label">{item.label}</span>
              </li>
            ))}
          </ul>
        </header>

        <p className="app-workspace-welcome-landing__cta-label">选择一种方式开始</p>

        <div className="app-workspace-welcome-landing__cards">
          <button
            type="button"
            className="app-workspace-welcome-landing__card app-workspace-welcome-landing__card--primary"
            onClick={onAddWorkspace}
          >
            <span className="app-workspace-welcome-landing__card-icon" aria-hidden>
              <AppstoreAddOutlined />
            </span>
            <span className="app-workspace-welcome-landing__card-body">
              <span className="app-workspace-welcome-landing__card-title">添加工作区</span>
              <span className="app-workspace-welcome-landing__card-desc">
                多仓工作区 + Wise 规范，统筹需求拆分、任务编排与团队 Agent 并发。
              </span>
              <div className="app-workspace-welcome-landing__card-tags">
                <span className="app-workspace-welcome-landing__card-tag">多仓 Hub</span>
                <span className="app-workspace-welcome-landing__card-tag">团队 Agent</span>
                <span className="app-workspace-welcome-landing__card-tag">Wise 规范</span>
              </div>
            </span>
            <RightOutlined className="app-workspace-welcome-landing__card-arrow" aria-hidden />
          </button>

          <button
            type="button"
            className="app-workspace-welcome-landing__card"
            onClick={onAddStandaloneRepo}
          >
            <span className="app-workspace-welcome-landing__card-icon app-workspace-welcome-landing__card-icon--muted" aria-hidden>
              <FolderAddOutlined />
            </span>
            <span className="app-workspace-welcome-landing__card-body">
              <span className="app-workspace-welcome-landing__card-title">单仓</span>
              <span className="app-workspace-welcome-landing__card-desc">
                登记本地仓库，直达 Claude Code 执行会话，适合单点试验与快速开工。
              </span>
              <div className="app-workspace-welcome-landing__card-tags">
                <span className="app-workspace-welcome-landing__card-tag">Git 仓库</span>
                <span className="app-workspace-welcome-landing__card-tag">直达 Claude</span>
                <span className="app-workspace-welcome-landing__card-tag">极速开工</span>
              </div>
            </span>
            <RightOutlined className="app-workspace-welcome-landing__card-arrow" aria-hidden />
          </button>
        </div>

        <p className="app-workspace-welcome-landing__footnote">
          已有目录？选上面任一入口即可；之后也可在侧栏随时新建或关联。
        </p>
      </div>
    </div>
  );
}

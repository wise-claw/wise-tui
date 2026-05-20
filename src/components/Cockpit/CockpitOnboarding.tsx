import { Button, Card, Space, Typography } from "antd";
import {
  AppstoreAddOutlined,
  FolderAddOutlined,
  RocketOutlined,
} from "@ant-design/icons";
import "./CockpitOnboarding.css";

const { Title, Paragraph, Text } = Typography;

export interface CockpitOnboardingProps {
  /** 触发"创建 Workspace"流程（侧栏对应弹窗）。 */
  onCreateWorkspace: () => void;
  /** 触发"导入 Standalone Repo"流程（侧栏对应弹窗）。 */
  onImportStandaloneRepo: () => void;
}

/**
 * Cockpit 主屏空态：当用户没有任何 Workspace 或 Standalone Repo 时显示。
 *
 * 来自 P1 PRD §4.5：
 *   "用户没有任何项目时（projects.length === 0 && floatingRepositories.length === 0），
 *   cockpit 主区显示空态：引导创建 Workspace 或导入 Standalone Repo"
 *
 * 不引入 driver.js / 教程动画（PRD §4.不做）。仅静态卡片 + 入口按钮。
 */
export function CockpitOnboarding({
  onCreateWorkspace,
  onImportStandaloneRepo,
}: CockpitOnboardingProps) {
  return (
    <div className="cockpit-onboarding">
      <div className="cockpit-onboarding-hero">
        <RocketOutlined className="cockpit-onboarding-hero-icon" aria-hidden />
        <Title level={2} className="cockpit-onboarding-hero-title">
          欢迎使用 Wise 驾驶舱
        </Title>
        <Paragraph type="secondary" className="cockpit-onboarding-hero-subtitle">
          先创建一个工作区来管理项目级 Mission，或导入一个单仓
          直接进入 Claude Code 对话。
        </Paragraph>
      </div>

      <Space size={16} className="cockpit-onboarding-cards">
        <Card
          className="cockpit-onboarding-card"
          hoverable
          onClick={onCreateWorkspace}
          aria-label="创建工作区"
        >
          <AppstoreAddOutlined className="cockpit-onboarding-card-icon" aria-hidden />
          <Title level={4}>创建工作区</Title>
          <Paragraph type="secondary">
            将多个仓库组成一个项目级工作区，支持 Mission 拆解 / Trellis 规范 / 多 Agent 协作。
          </Paragraph>
          <Button type="primary" icon={<AppstoreAddOutlined />}>
            新建工作区
          </Button>
        </Card>

        <Card
          className="cockpit-onboarding-card"
          hoverable
          onClick={onImportStandaloneRepo}
          aria-label="导入单仓"
        >
          <FolderAddOutlined className="cockpit-onboarding-card-icon" aria-hidden />
          <Title level={4}>导入单仓</Title>
          <Paragraph type="secondary">
            登记单个本地仓库，直接进入 Claude Code 对话；适合临时 / 试验性工作。
          </Paragraph>
          <Button icon={<FolderAddOutlined />}>导入仓库</Button>
        </Card>
      </Space>

      <Text type="secondary" className="cockpit-onboarding-tip">
        提示：你也可以从左侧侧栏的"+"按钮随时创建/导入。
      </Text>
    </div>
  );
}

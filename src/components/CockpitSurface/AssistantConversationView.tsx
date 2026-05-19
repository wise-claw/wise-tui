import { lazy, Suspense } from "react";
import { Button, Empty, Spin, Tag, Typography } from "antd";
import { SettingOutlined } from "@ant-design/icons";
import type { ComponentProps } from "react";
import { DEFAULT_PRD_SPLIT_ASSISTANT_ID } from "../../services/assistantPromptLayers";
import type { AssistantEntry } from "../../types/assistant";

const MissionControl = lazy(() =>
  import("../MissionControl").then((module) => ({ default: module.MissionControl })),
);
const PrdTaskSplitPanel = lazy(() =>
  import("../PrdTaskSplitPanel").then((module) => ({ default: module.PrdTaskSplitPanel })),
);

export type AssistantConversationMissionControlProps = ComponentProps<typeof MissionControl>;
export type AssistantConversationPrdTaskSplitPanelProps = ComponentProps<typeof PrdTaskSplitPanel>;

export interface AssistantConversationViewProps {
  assistantId: string;
  assistant: AssistantEntry | null;
  missionControlProps: AssistantConversationMissionControlProps;
  prdTaskSplitPanelProps: AssistantConversationPrdTaskSplitPanelProps;
  onOpenSettings: () => void;
}

/**
 * D13 修订:助手 conversation 视图 = 现 MissionControl(单栏)的薄封装。
 * 不再实现 ChatPane / ArtifactPane / 双栏 / Claude tool use。
 *
 * Stage 5 可能把内核换成 PrdTaskSplitPanel 直挂(单独立任务决定);本组件保持稳定。
 */
export function AssistantConversationView({
  assistantId,
  assistant,
  prdTaskSplitPanelProps,
  onOpenSettings,
}: AssistantConversationViewProps) {
  if (assistantId !== DEFAULT_PRD_SPLIT_ASSISTANT_ID) {
    if (!assistant) return <ConversationFallback />;
    return <ArtifactAssistantWorkspace assistant={assistant} onOpenSettings={onOpenSettings} />;
  }
  return (
    <Suspense fallback={<ConversationFallback />}>
      <PrdTaskSplitPanel {...prdTaskSplitPanelProps} />
    </Suspense>
  );
}

function ConversationFallback() {
  return (
    <div className="app-file-editor-loading">
      <Spin size="small" />
    </div>
  );
}

interface ArtifactAssistantWorkspaceProps {
  assistant: AssistantEntry;
  onOpenSettings: () => void;
}

function ArtifactAssistantWorkspace({ assistant, onOpenSettings }: ArtifactAssistantWorkspaceProps) {
  const skills = assistant.defaultSkills ?? [];
  return (
    <div className="assistant-artifact-workspace">
      <section className="assistant-artifact-workspace__panel">
        <div
          className="assistant-artifact-workspace__avatar"
          style={{ background: assistant.avatarColor ?? "#1677FF" }}
          aria-hidden
        >
          {assistant.name.slice(0, 1)}
        </div>
        <Typography.Title level={4} className="assistant-artifact-workspace__title">
          {assistant.name}
        </Typography.Title>
        <Typography.Paragraph type="secondary" className="assistant-artifact-workspace__description">
          {assistant.description}
        </Typography.Paragraph>
        <div className="assistant-artifact-workspace__skills">
          {skills.length > 0 ? (
            skills.map((skill) => (
              <Tag key={skill.id} color="purple">
                Skill · {skill.label}
              </Tag>
            ))
          ) : (
            <Tag>未挂载默认 Skill</Tag>
          )}
        </div>
        <Button type="primary" icon={<SettingOutlined />} onClick={onOpenSettings}>
          配置格式、Skills 和 MCP
        </Button>
      </section>
      <Empty
        className="assistant-artifact-workspace__empty"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="产物型助手的对话与文件预览工作台会接入统一 Artifact 面板；当前先通过设置抽屉管理默认技能和格式偏好。"
      />
    </div>
  );
}

import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { App as AntdApp, Button, Empty, Input, Spin, Tag, Typography } from "antd";
import { CopyOutlined, SettingOutlined } from "@ant-design/icons";
import type { ComponentProps } from "react";
import {
  WORKFLOW_UI_EVENT_RUN_ASSISTANT_BRIEF,
  type RunAssistantBriefDetail,
} from "../../constants/workflowUiEvents";
import {
  DEFAULT_PRD_SPLIT_ASSISTANT_ID,
  parseAssistantEngineeringPreferences,
  parseAssistantRuntimeBundle,
  resolveAssistantRuntime,
  type AssistantEngineeringPreferences,
  type AssistantRuntimeBundle,
} from "../../services/assistantPromptLayers";
import type { AssistantEntry } from "../../types/assistant";
import {
  assistantRefsToBundleItems,
  buildArtifactAssistantBrief,
  getEnabledBundleItems,
} from "./assistantArtifactBrief";

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
  activeProjectId: string | null;
  activeProjectName: string | null;
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
  activeProjectId,
  activeProjectName,
  prdTaskSplitPanelProps,
  onOpenSettings,
}: AssistantConversationViewProps) {
  if (assistantId !== DEFAULT_PRD_SPLIT_ASSISTANT_ID) {
    if (!assistant) return <ConversationFallback />;
    return (
      <ArtifactAssistantWorkspace
        assistant={assistant}
        activeProjectId={activeProjectId}
        activeProjectName={activeProjectName}
        onOpenSettings={onOpenSettings}
      />
    );
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
  activeProjectId: string | null;
  activeProjectName: string | null;
  onOpenSettings: () => void;
}

function ArtifactAssistantWorkspace({
  assistant,
  activeProjectId,
  activeProjectName,
  onOpenSettings,
}: ArtifactAssistantWorkspaceProps) {
  const { message } = AntdApp.useApp();
  const [loading, setLoading] = useState(false);
  const [runtimeSkills, setRuntimeSkills] = useState<AssistantRuntimeBundle | null>(null);
  const [runtimeMcps, setRuntimeMcps] = useState<AssistantRuntimeBundle | null>(null);
  const [engineering, setEngineering] = useState<AssistantEngineeringPreferences>({});
  const [request, setRequest] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    resolveAssistantRuntime({
      assistantId: assistant.id,
      projectId: activeProjectId,
    })
      .then((runtime) => {
        if (cancelled) return;
        setRuntimeSkills(parseAssistantRuntimeBundle(runtime.skillBundleJson));
        setRuntimeMcps(parseAssistantRuntimeBundle(runtime.mcpBundleJson));
        setEngineering(parseAssistantEngineeringPreferences(runtime.engineeringJson));
      })
      .catch((err) => {
        if (cancelled) return;
        message.error(`读取助手运行态失败：${err instanceof Error ? err.message : String(err)}`);
        setRuntimeSkills(null);
        setRuntimeMcps(null);
        setEngineering({});
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProjectId, assistant.id, message]);

  const skillBundle = runtimeSkills ?? {
    disabled: [],
    custom: assistantRefsToBundleItems(assistant.defaultSkills),
  };
  const mcpBundle = runtimeMcps ?? {
    disabled: [],
    custom: assistantRefsToBundleItems(assistant.defaultMcps),
  };
  const enabledSkills = useMemo(() => getEnabledBundleItems(skillBundle), [skillBundle]);
  const enabledMcps = useMemo(() => getEnabledBundleItems(mcpBundle), [mcpBundle]);
  const executionBrief = useMemo(
    () =>
      buildArtifactAssistantBrief({
        assistant,
        activeProjectName,
        userRequest: request,
        engineering,
        enabledSkills,
        enabledMcps,
      }),
    [activeProjectName, assistant, enabledMcps, enabledSkills, engineering, request],
  );

  const handleCopyBrief = async () => {
    try {
      await navigator.clipboard.writeText(executionBrief);
      message.success("执行 Brief 已复制，可粘贴到主会话或后续 Artifact 执行面板。");
    } catch (err) {
      message.error(`复制失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleRunBrief = () => {
    if (!request.trim()) {
      message.warning("请先填写要创建或编辑的产物需求。");
      return;
    }
    window.dispatchEvent(
      new CustomEvent<RunAssistantBriefDetail>(WORKFLOW_UI_EVENT_RUN_ASSISTANT_BRIEF, {
        detail: {
          assistantId: assistant.id,
          assistantName: assistant.name,
          prompt: executionBrief,
          projectId: activeProjectId,
        },
      }),
    );
  };

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
        <div className="assistant-artifact-workspace__scope">
          <Typography.Text type="secondary">作用域</Typography.Text>
          <Typography.Text>{activeProjectName ?? "助手默认"}</Typography.Text>
        </div>
        <div className="assistant-artifact-workspace__skills">
          {loading ? (
            <Spin size="small" />
          ) : enabledSkills.length > 0 ? (
            enabledSkills.map((skill) => (
              <Tag key={skill.id} color="purple">
                Skill · {skill.label}
              </Tag>
            ))
          ) : (
            <Tag>未挂载默认 Skill</Tag>
          )}
        </div>
        {engineering.formatProfile?.trim() ? (
          <Typography.Paragraph className="assistant-artifact-workspace__format">
            {engineering.formatProfile.trim()}
          </Typography.Paragraph>
        ) : (
          <Typography.Text type="secondary">未设置格式偏好。</Typography.Text>
        )}
        <Button icon={<SettingOutlined />} onClick={onOpenSettings}>
          配置格式、Skills 和 MCP
        </Button>
      </section>
      <section className="assistant-artifact-workspace__brief">
        <div className="assistant-artifact-workspace__brief-head">
          <div>
            <Typography.Title level={5} className="assistant-artifact-workspace__brief-title">
              执行 Brief
            </Typography.Title>
            <Typography.Text type="secondary">
              基于当前助手运行态生成,包含启用 Skill、MCP 和格式偏好。
            </Typography.Text>
          </div>
          <div className="assistant-artifact-workspace__brief-actions">
            <Button icon={<CopyOutlined />} onClick={() => void handleCopyBrief()}>
              复制 Brief
            </Button>
            <Button type="primary" onClick={handleRunBrief}>
              派发到 Claude
            </Button>
          </div>
        </div>
        <Input.TextArea
          value={request}
          onChange={(event) => setRequest(event.target.value)}
          rows={5}
          placeholder={assistant.id === "builtin:ppt-deck"
            ? "例如：根据这份商业计划书做 12 页融资路演 PPT，风格深色高对比，保留数据图表。"
            : "例如：根据会议纪要生成一份正式项目复盘 Word 报告，包含摘要、问题、行动项和附件清单。"}
        />
        <pre className="assistant-artifact-workspace__brief-preview">{executionBrief}</pre>
        {enabledSkills.length === 0 ? (
          <Empty
            className="assistant-artifact-workspace__empty"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="当前没有启用 Skill。请先打开设置挂载或启用内置 Skill。"
          />
        ) : null}
      </section>
    </div>
  );
}

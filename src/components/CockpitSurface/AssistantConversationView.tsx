import { App as AntdApp, Button, Empty, Input, Spin, Tag, Typography } from "antd";
import { CopyFeedbackIcon } from "../shared/CopyFeedbackIcon";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { SettingOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";
import {
  WORKFLOW_UI_EVENT_RUN_ASSISTANT_BRIEF,
  type RunAssistantBriefDetail,
} from "../../constants/workflowUiEvents";
import {
  parseAssistantEngineeringPreferences,
  parseAssistantRuntimeBundle,
  resolveAssistantRuntime,
  type AssistantEngineeringPreferences,
  type AssistantRuntimeBundle,
} from "../../services/assistantPromptLayers";
import { readSkillInstruction, type SkillInstruction } from "../../services/skills";
import type { AssistantEntry } from "../../types/assistant";
import { builtinAssistantBriefPlaceholder } from "../../constants/builtinAssistantBriefPlaceholders";
import {
  assistantRefsToBundleItems,
  buildArtifactAssistantBrief,
  getEnabledBundleItems,
} from "./assistantArtifactBrief";

export interface AssistantConversationViewProps {
  assistantId: string;
  assistant: AssistantEntry | null;
  activeProjectId: string | null;
  activeProjectName: string | null;
  onClose: () => void;
  onOpenSettings: () => void;
}

export function AssistantConversationView({
  assistant,
  activeProjectId,
  activeProjectName,
  onOpenSettings,
}: AssistantConversationViewProps) {
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
  const [skillInstructions, setSkillInstructions] = useState<SkillInstruction[]>([]);
  const [skillInstructionError, setSkillInstructionError] = useState<string | null>(null);
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

  const fallbackSkillBundle = useMemo<AssistantRuntimeBundle>(() => ({
    disabled: [],
    custom: assistantRefsToBundleItems(assistant.defaultSkills),
  }), [assistant.defaultSkills]);
  const fallbackMcpBundle = useMemo<AssistantRuntimeBundle>(() => ({
    disabled: [],
    custom: assistantRefsToBundleItems(assistant.defaultMcps),
  }), [assistant.defaultMcps]);
  const skillBundle = runtimeSkills ?? fallbackSkillBundle;
  const mcpBundle = runtimeMcps ?? fallbackMcpBundle;
  const enabledSkills = useMemo(() => getEnabledBundleItems(skillBundle), [skillBundle]);
  const enabledMcps = useMemo(() => getEnabledBundleItems(mcpBundle), [mcpBundle]);
  const readableSkills = useMemo(
    () => enabledSkills.filter((skill) => skill.sourcePath?.trim()),
    [enabledSkills],
  );

  useEffect(() => {
    let cancelled = false;
    if (readableSkills.length === 0) {
      setSkillInstructions([]);
      setSkillInstructionError(null);
      return;
    }
    setSkillInstructions([]);
    setSkillInstructionError(null);
    Promise.all(readableSkills.map((skill) => readSkillInstruction(skill.id, skill.sourcePath ?? "")))
      .then((items) => {
        if (cancelled) return;
        setSkillInstructions(items);
        setSkillInstructionError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setSkillInstructions([]);
        setSkillInstructionError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [readableSkills]);

  const executionBrief = useMemo(
    () =>
      buildArtifactAssistantBrief({
        assistant,
        activeProjectName,
        userRequest: request,
        engineering,
        enabledSkills,
        skillInstructions,
        enabledMcps,
      }),
    [activeProjectName, assistant, enabledMcps, enabledSkills, engineering, request, skillInstructions],
  );

  const { copied, copy } = useCopyToClipboard();

  const handleRunBrief = () => {
    if (!request.trim()) {
      message.warning("请先填写要创建或编辑的产物需求。");
      return;
    }
    if (readableSkills.length > 0 && skillInstructions.length === 0) {
      message.warning(
        skillInstructionError
          ? `Skill 指令未就绪：${skillInstructionError}`
          : "Skill 指令仍在读取中，请稍后再派发。",
      );
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
                内置 Skill · {skill.label}
              </Tag>
            ))
          ) : (
            <Tag>未挂载默认 Skill</Tag>
          )}
        </div>
        {skillInstructionError ? (
          <Typography.Text type="danger">Skill 指令读取失败：{skillInstructionError}</Typography.Text>
        ) : null}
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
              基于当前助手运行态生成,包含启用 Skill、MCP、格式偏好和产物格式要求。
            </Typography.Text>
          </div>
          <div className="assistant-artifact-workspace__brief-actions">
            <Button icon={<CopyFeedbackIcon copied={copied} />} onClick={() => void copy(executionBrief)}>
              {copied ? "已复制" : "复制 Brief"}
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
          placeholder={builtinAssistantBriefPlaceholder(assistant.id)}
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

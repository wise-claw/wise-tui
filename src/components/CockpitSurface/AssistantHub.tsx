import { useEffect, useState } from "react";
import { App as AntdApp, Spin } from "antd";
import { CloseOutlined } from "@ant-design/icons";
import { AssistantHubBody } from "../AssistantHubShared/AssistantHubBody";
import { resolveAssistantKind } from "./assistantKind";
import { listAssistants } from "../../services/assistants";
import type { AssistantEntry } from "../../types/assistant";
import "./index.css";

export interface AssistantHubProps {
  /** 关联工作区(可选);影响选中助手后能否直接进入对话。 */
  activeProjectId: string | null;
  activeProjectName: string | null;
  onSelectAssistant: (assistantId: string) => void;
  onOpenAssistantSettings: (assistantId: string) => void;
  onOpenChat: () => void;
}

/**
 * Cockpit 默认空态:AionUI 风格的助手卡片网格 + 内置 PRD 拆分助手作为头牌。
 * Wave A 仅展示卡片 + 一键进入对话;最近对话 / 输入条由 Wave B 接入。
 */
export function AssistantHub({
  activeProjectId,
  activeProjectName,
  onSelectAssistant,
  onOpenAssistantSettings,
  onOpenChat,
}: AssistantHubProps) {
  const { message } = AntdApp.useApp();
  const [assistants, setAssistants] = useState<AssistantEntry[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listAssistants()
      .then((rows) => {
        if (!cancelled) setAssistants(rows);
      })
      .catch((err) => {
        if (!cancelled) {
          message.error(err instanceof Error ? err.message : String(err));
          setAssistants([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [message]);

  if (loading && assistants === null) {
    return (
      <div className="cockpit-hub" aria-busy="true">
        <Spin size="small" />
      </div>
    );
  }

  const list = assistants ?? [];

  return (
    <div className="cockpit-hub">
      <header className="cockpit-hub__header">
        <div className="cockpit-hub__header-top">
          <h1 className="cockpit-hub__title">助手 Hub</h1>
          <button
            type="button"
            className="cockpit-hub__close-btn"
            aria-label="关闭"
            title="关闭"
            onClick={onOpenChat}
          >
            <CloseOutlined />
          </button>
        </div>
        <p className="cockpit-hub__subtitle">
          {activeProjectName
            ? `当前工作区：${activeProjectName}。选择一个助手，让 Wise 用 Claude Code 编排后续工作。`
            : "选择一个助手开始工作。需要拆分 PRD 时建议先在左栏选定一个工作区。"}
        </p>
      </header>

      <AssistantHubBody
        assistants={list}
        filter="all"
        loading={loading}
        mode="pick"
        emptyDescription="尚未注册任何助手"
        renderCardActions={(assistant) => {
          const needsProject =
            resolveAssistantKind(assistant) === "workflow-orchestration" && !activeProjectId;
          return {
            disabled: needsProject,
            disabledHint: needsProject ? "未选择工作区时会先进入助手空态" : undefined,
            onSelect: () => onSelectAssistant(assistant.id),
            onOpenSettings: () => onOpenAssistantSettings(assistant.id),
          };
        }}
      />
    </div>
  );
}

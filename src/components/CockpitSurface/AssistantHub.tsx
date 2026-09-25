import { useEffect, useMemo, useState } from "react";
import { App as AntdApp, Button, Input, Select } from "antd";
import { CloseOutlined, SendOutlined } from "@ant-design/icons";
import { AssistantHubBody } from "../AssistantHubShared/AssistantHubBody";
import { CollabAgentsHubSection } from "../Collaboration/agents/CollabAgentsHubSection";
import { CollabResourcesHubSection } from "../Collaboration/resources/CollabResourcesHubSection";
import { resolveAssistantKind } from "./assistantKind";
import { listAssistants } from "../../services/assistants";
import type { AssistantEntry } from "../../types/assistant";
import type { CockpitConversationRecord } from "../../utils/cockpitConversation";
import { formatCockpitRunStatusLabel, pickDefaultCockpitAssistant } from "../../utils/cockpitConversation";
import "./index.css";

export interface AssistantHubProps {
  /** 关联工作区(可选);影响选中助手后能否直接进入对话。 */
  activeProjectId: string | null;
  activeProjectName: string | null;
  activeRepositoryPath: string | null;
  activeRepositoryName: string | null;
  recentConversations: CockpitConversationRecord[];
  lastAssistantId: string | null;
  onSelectAssistant: (assistantId: string) => void;
  onOpenAssistantSettings: (assistantId: string) => void;
  onOpenChat: () => void;
  onSendBrief: (assistantId: string, request: string) => void;
  onOpenRecent: (record: CockpitConversationRecord) => void;
}

/**
 * Cockpit Hub：助手卡片 + 最近对话 + 输入条。选助手后可直接发 Brief。
 */
export function AssistantHub({
  activeProjectId,
  activeProjectName,
  activeRepositoryPath,
  activeRepositoryName,
  recentConversations,
  lastAssistantId,
  onSelectAssistant,
  onOpenAssistantSettings,
  onOpenChat,
  onSendBrief,
  onOpenRecent,
}: AssistantHubProps) {
  const { message } = AntdApp.useApp();
  const [assistants, setAssistants] = useState<AssistantEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [composerAssistantId, setComposerAssistantId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

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

  const list = assistants ?? [];
  const defaultAssistantId = useMemo(
    () => pickDefaultCockpitAssistant(list, composerAssistantId ?? lastAssistantId),
    [composerAssistantId, lastAssistantId, list],
  );
  const composerId = composerAssistantId ?? defaultAssistantId;
  const recents = recentConversations.slice(0, 6);

  const handleSend = () => {
    const request = draft.trim();
    if (!request) {
      message.warning("请先填写要交给助手的需求");
      return;
    }
    if (!composerId) {
      message.warning("请先选择助手");
      return;
    }
    if (!activeRepositoryPath?.trim()) {
      message.warning("请先在左栏选择仓库，输入条才会绑定当前工作区");
      return;
    }
    onSendBrief(composerId, request);
    setDraft("");
  };

  const workspaceHint = [
    activeProjectName ? `工作区 ${activeProjectName}` : "未选择工作区",
    activeRepositoryName || activeRepositoryPath || "未选择仓库",
  ].join(" · ");

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
            ? `当前工作区：${activeProjectName}。选择助手，或直接在下方输入条发任务。`
            : "选择一个助手开始工作。需要落盘产物时，先在左栏选定工作区和仓库。"}
        </p>
      </header>

      <div className="cockpit-hub__scroll">
        {recents.length > 0 ? (
          <section className="cockpit-hub__recents" aria-label="最近对话">
            <h2 className="cockpit-hub__section-title">最近对话</h2>
            <ul className="cockpit-hub__recent-list">
              {recents.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="cockpit-hub__recent-item"
                    onClick={() => onOpenRecent(item)}
                  >
                    <span className="cockpit-hub__recent-title">{item.title}</span>
                    <span className="cockpit-hub__recent-meta">
                      {item.assistantName}
                      {" · "}
                      {formatCockpitRunStatusLabel(item.status)}
                      {item.artifactPaths.length > 0 ? ` · ${item.artifactPaths.length} 个产物` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <CollabAgentsHubSection />
        <CollabResourcesHubSection />

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
              onSelect: () => {
                setComposerAssistantId(assistant.id);
                onSelectAssistant(assistant.id);
              },
              onOpenSettings: () => onOpenAssistantSettings(assistant.id),
            };
          }}
        />
      </div>

      <form
        className="cockpit-hub__composer"
        onSubmit={(event) => {
          event.preventDefault();
          handleSend();
        }}
      >
        <div className="cockpit-hub__composer-meta">{workspaceHint}</div>
        <div className="cockpit-hub__composer-row">
          <Select
            className="cockpit-hub__composer-assistant"
            size="small"
            placeholder="选择助手"
            value={composerId ?? undefined}
            options={list.map((assistant) => ({ value: assistant.id, label: assistant.name }))}
            onChange={(value) => setComposerAssistantId(value)}
            showSearch
            optionFilterProp="label"
          />
          <Input.TextArea
            className="cockpit-hub__composer-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            autoSize={{ minRows: 1, maxRows: 4 }}
            placeholder="直接输入需求，发送后进入该助手并派发到 Claude"
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                handleSend();
              }
            }}
          />
          <Button type="primary" size="small" htmlType="submit" icon={<SendOutlined />}>
            发送
          </Button>
        </div>
      </form>
    </div>
  );
}

import { CopyOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Space, Switch, Tag } from "antd";
import type { RefObject } from "react";
import type { ClaudeHookSourceScope, ClaudeHookScopeData } from "../../types";
import { EVENT_HELP_TEXT } from "./constants";
import { handlerSummary } from "./helpers";
import { HelpIcon } from "./HelpIcon";

export interface HookScopeSectionProps {
  scope: ClaudeHookSourceScope | "omc";
  title: string;
  data: ClaudeHookScopeData;
  onCreate: (scope: ClaudeHookSourceScope, eventName: string, groupId: string) => void;
  onEdit: (scope: ClaudeHookSourceScope, eventName: string, groupId: string, handlerId: string) => void;
  onDelete: (scope: ClaudeHookSourceScope, eventName: string, groupId: string, handlerId: string) => void;
  onToggleDisableAll: (scope: ClaudeHookSourceScope, next: boolean) => void;
  sectionRef?: RefObject<HTMLElement | null>;
  onClone: (scope: ClaudeHookSourceScope, eventName: string, groupId: string, handlerId: string) => void;
  keyword: string;
  readOnly?: boolean;
}

export function HookScopeSection({
  scope,
  title,
  data,
  onCreate,
  onEdit,
  onDelete,
  onToggleDisableAll,
  sectionRef,
  onClone,
  keyword,
  readOnly = false,
}: HookScopeSectionProps) {
  const kw = keyword.trim().toLowerCase();
  const matchText = (text: string) => !kw || text.toLowerCase().includes(kw);
  const eventNames = Object.keys(data.hooks)
    .filter((eventName) => {
      if (!kw) return true;
      const groups = data.hooks[eventName] ?? [];
      if (matchText(eventName)) return true;
      return groups.some((group) => {
        if (matchText(group.matcher?.trim() || "*")) return true;
        return group.hooks.some((h) => {
          return (
            matchText(handlerSummary(h)) ||
            matchText(h.type) ||
            matchText(h.command ?? "") ||
            matchText(h.url ?? "")
          );
        });
      });
    })
    .sort((a, b) => a.localeCompare(b));

  function groupsForEvent(eventName: string) {
    const groupsRaw = data.hooks[eventName] ?? [];
    if (!kw) return groupsRaw;
    const eventHit = matchText(eventName);
    return groupsRaw
      .map((group) => {
        const matcherHit = matchText(group.matcher?.trim() || "*");
        const hooksFiltered = eventHit
          ? group.hooks
          : group.hooks.filter(
              (h) =>
                matcherHit ||
                matchText(handlerSummary(h)) ||
                matchText(h.type) ||
                matchText(h.command ?? "") ||
                matchText(h.url ?? ""),
            );
        return { ...group, hooks: hooksFiltered };
      })
      .filter((g) => g.hooks.length > 0);
  }

  const hasData = eventNames.length > 0;
  return (
    <section className="app-hooks-section" ref={sectionRef}>
      <div className="app-hooks-section-head">
        <div className="app-hooks-section-title">{title}</div>
        <div className="app-hooks-section-switch">
          <span>禁用全部</span>
          <Switch
            size="small"
            checked={data.disableAllHooks}
            disabled={readOnly}
            onChange={(next) => {
              if (readOnly) return;
              onToggleDisableAll(scope as ClaudeHookSourceScope, next);
            }}
          />
        </div>
      </div>
      <div className="app-hooks-section-path">{data.sourcePath || "(未设置路径)"}</div>
      {!hasData ? (
        <div className="app-hooks-empty">暂无 hooks</div>
      ) : (
        <div className="app-hooks-event-list">
          {eventNames.map((eventName) => (
            <div key={eventName} className="app-hooks-event-block">
              <div className="app-hooks-event-head">
                <span className="app-hooks-event-btn" title={eventName}>
                  <span>{eventName}</span>
                  <HelpIcon
                    className="app-hooks-event-help-icon"
                    text={EVENT_HELP_TEXT[eventName] ?? "该事件说明暂未配置。"}
                  />
                  <Tag className="app-hooks-event-tag" bordered={false}>
                    {groupsForEvent(eventName).reduce((acc, g) => acc + g.hooks.length, 0)} 条
                  </Tag>
                </span>
              </div>
              <div className="app-hooks-group-list">
                {groupsForEvent(eventName).map((group) => (
                  <div key={group.id} className="app-hooks-group-item">
                    <div className="app-hooks-group-head">
                      <Tag bordered={false}>{group.matcher?.trim() || "*"}</Tag>
                      {!readOnly ? (
                        <Button
                          type="text"
                          size="small"
                          icon={<PlusOutlined />}
                          onClick={() => onCreate(scope as ClaudeHookSourceScope, eventName, group.id)}
                        >
                          添加 handler
                        </Button>
                      ) : null}
                    </div>
                    <div className="app-hooks-handler-list">
                      {group.hooks.map((h) => (
                        <div key={h.id} className="app-hooks-handler-item">
                          <div className="app-hooks-handler-main">
                            <span className="app-hooks-handler-summary">{handlerSummary(h)}</span>
                          </div>
                          <div className="app-hooks-handler-head">
                            <Tag color="blue" bordered={false}>
                              {h.type}
                            </Tag>
                            {!readOnly ? (
                              <Space size={2}>
                                <Button
                                  type="text"
                                  size="small"
                                  icon={<EditOutlined />}
                                  onClick={() => onEdit(scope as ClaudeHookSourceScope, eventName, group.id, h.id)}
                                />
                                <Button
                                  type="text"
                                  size="small"
                                  icon={<CopyOutlined />}
                                  onClick={() => onClone(scope as ClaudeHookSourceScope, eventName, group.id, h.id)}
                                />
                                <Button
                                  type="text"
                                  danger
                                  size="small"
                                  icon={<DeleteOutlined />}
                                  onClick={() => onDelete(scope as ClaudeHookSourceScope, eventName, group.id, h.id)}
                                />
                              </Space>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

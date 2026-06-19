import { DeleteOutlined, EditOutlined, FileOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Space, Switch, Tag } from "antd";
import type { RefObject } from "react";
import type { ClaudeHookHandler, ClaudeHookSourceScope, ClaudeHookScopeData } from "../../types";
import { EVENT_HELP_TEXT } from "./constants";
import { compactDisplayPath } from "../../utils/compactDisplayPath";
import {
  formatHookOpenTargetTooltip,
  handlerSummary,
  resolveHookHandlerOpenTarget,
  type HookPathResolutionContext,
} from "./helpers";
import { HelpIcon } from "./HelpIcon";

export interface HookScopeSectionProps {
  scope: ClaudeHookSourceScope;
  title: string;
  data: ClaudeHookScopeData;
  hookPathContext: HookPathResolutionContext;
  onCreate: (scope: ClaudeHookSourceScope, eventName: string, groupId: string) => void;
  onEdit: (scope: ClaudeHookSourceScope, eventName: string, groupId: string, handlerId: string) => void;
  onDelete: (scope: ClaudeHookSourceScope, eventName: string, groupId: string, handlerId: string) => void;
  onToggleDisableAll: (scope: ClaudeHookSourceScope, next: boolean) => void;
  sectionRef?: RefObject<HTMLElement | null>;
  onOpenTarget: (handler: ClaudeHookHandler, matcher?: string | null, scopeSourcePath?: string | null) => void;
  keyword: string;
  readOnly?: boolean;
}

export function HookScopeSection({
  scope,
  title,
  data,
  hookPathContext,
  onCreate,
  onEdit,
  onDelete,
  onToggleDisableAll,
  sectionRef,
  onOpenTarget,
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
      <div className="app-hooks-section-paths">
        {data.sourcePath.trim()
          ? data.sourcePath
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean)
              .map((line) => (
                <div key={line} className="app-hooks-section-path" title={line}>
                  {line}
                </div>
              ))
          : (
            <div className="app-hooks-section-path app-hooks-section-path--empty">(未设置路径)</div>
          )}
      </div>
      {!hasData ? (
        <div className="app-hooks-empty">暂无触发器规则</div>
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
                  <Tag className="app-hooks-event-tag" variant="filled">
                    {groupsForEvent(eventName).reduce((acc, g) => acc + g.hooks.length, 0)} 条
                  </Tag>
                </span>
              </div>
              <div className="app-hooks-group-list">
                {groupsForEvent(eventName).map((group) => (
                  <div key={group.id} className="app-hooks-group-item">
                    <div className="app-hooks-group-head">
                      <Tag variant="filled">{group.matcher?.trim() || "*"}</Tag>
                      {!readOnly ? (
                        <Button
                          type="text"
                          size="small"
                          icon={<PlusOutlined />}
                          onClick={() => onCreate(scope as ClaudeHookSourceScope, eventName, group.id)}
                        >
                          添加处理器
                        </Button>
                      ) : null}
                    </div>
                    <div className="app-hooks-handler-list">
                      {group.hooks.map((h) => {
                        const openTarget = resolveHookHandlerOpenTarget(h, group.matcher, {
                          ...hookPathContext,
                          scopeSourcePath: data.sourcePath,
                          handlerId: h.id,
                        });
                        const pathLabel = formatHookOpenTargetTooltip(openTarget);
                        return (
                        <div key={h.id} className="app-hooks-handler-item">
                          <div className="app-hooks-handler-main">
                            <span className="app-hooks-handler-summary" title={handlerSummary(h)}>
                              {handlerSummary(h)}
                            </span>
                          </div>
                          <div className="app-hooks-handler-foot">
                            <div className="app-hooks-handler-foot-main">
                              <Tag color="blue" variant="filled" className="app-hooks-handler-type-tag">
                                {h.type}
                              </Tag>
                              {pathLabel ? (
                                <span
                                  className="app-hooks-handler-path"
                                  title={pathLabel}
                                >
                                  {compactDisplayPath(pathLabel)}
                                </span>
                              ) : null}
                            </div>
                            {!readOnly ? (
                              <Space size={2} className="app-hooks-handler-actions">
                                <Button
                                  type="text"
                                  size="small"
                                  icon={<EditOutlined />}
                                  title="编辑"
                                  aria-label="编辑处理器"
                                  onClick={() => onEdit(scope as ClaudeHookSourceScope, eventName, group.id, h.id)}
                                />
                                {openTarget ? (
                                  <Button
                                    type="text"
                                    size="small"
                                    icon={<FileOutlined />}
                                    title="在外部 IDE 打开"
                                    aria-label="在外部 IDE 打开"
                                    onClick={() => onOpenTarget(h, group.matcher, data.sourcePath)}
                                  />
                                ) : null}
                                <Button
                                  type="text"
                                  danger
                                  size="small"
                                  icon={<DeleteOutlined />}
                                  title="删除"
                                  aria-label="删除处理器"
                                  onClick={() => onDelete(scope as ClaudeHookSourceScope, eventName, group.id, h.id)}
                                />
                              </Space>
                            ) : openTarget ? (
                              <Space size={2} className="app-hooks-handler-actions">
                                <Button
                                  type="text"
                                  size="small"
                                  icon={<FileOutlined />}
                                  title="在外部 IDE 打开"
                                  aria-label="在外部 IDE 打开"
                                  onClick={() => onOpenTarget(h, group.matcher, data.sourcePath)}
                                />
                              </Space>
                            ) : null}
                          </div>
                        </div>
                        );
                      })}
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

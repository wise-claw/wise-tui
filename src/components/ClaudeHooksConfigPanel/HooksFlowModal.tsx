import { Button, Modal } from "antd";
import type { ClaudeHookSourceScope } from "../../types";
import { MAIN_FLOW_STEPS, SIDE_EVENTS } from "./constants";
import { getHelpTextByTitle, getSupportedTypesText } from "./helpers";
import { HelpIcon } from "./HelpIcon";
import type { HookFlowEntry, HooksFlowTheme } from "./types";

interface HooksFlowModalProps {
  open: boolean;
  flowTheme: HooksFlowTheme;
  eventHookCountMap: Record<string, number>;
  flowEventEntriesMap: Record<string, HookFlowEntry[]>;
  defaultCreateScope: ClaudeHookSourceScope;
  onClose: () => void;
  onThemeChange: (theme: HooksFlowTheme) => void;
  onCreate: (scope: ClaudeHookSourceScope, eventName: string) => void;
  onCopyEventName: (eventName: string) => void;
  onEdit: (scope: ClaudeHookSourceScope, eventName: string, groupId: string, handlerId: string) => void;
}

export function HooksFlowModal({
  open,
  flowTheme,
  eventHookCountMap,
  flowEventEntriesMap,
  defaultCreateScope,
  onClose,
  onThemeChange,
  onCreate,
  onCopyEventName,
  onEdit,
}: HooksFlowModalProps) {
  return (
    <Modal
      title={(
        <div className="app-hooks-flow-modal-title">
          <span>仓库 Hooks 与 Claude Code 生命周期</span>
          <Button.Group size="small">
            <Button type={flowTheme === "light-tech" ? "primary" : "default"} onClick={() => onThemeChange("light-tech")}>
              亮色
            </Button>
            <Button type={flowTheme === "neon-blue" ? "primary" : "default"} onClick={() => onThemeChange("neon-blue")}>
              霓虹蓝
            </Button>
            <Button type={flowTheme === "cyber-purple" ? "primary" : "default"} onClick={() => onThemeChange("cyber-purple")}>
              赛博紫
            </Button>
          </Button.Group>
        </div>
      )}
      open={open}
      onCancel={onClose}
      footer={null}
      width="100vw"
      rootClassName="app-hooks-flow-modal"
      destroyOnHidden
    >
      <div className="app-hooks-flow-body">
        <div className={`app-hooks-flow-visual app-hooks-flow-visual--horizontal app-hooks-flow-theme-${flowTheme}`}>
          <div className="app-hooks-flow-horizontal-main">
            <div className="app-hooks-flow-lifecycle-tag app-hooks-flow-lifecycle-tag--turn">EACH TURN</div>
            <div className="app-hooks-flow-lifecycle-tag app-hooks-flow-lifecycle-tag--agentic">AGENTIC LOOP</div>
            <div className="app-hooks-flow-horizontal-track">
              {MAIN_FLOW_STEPS.map((step, idx) => {
                const eventName = step.eventName;
                const count = eventName ? (eventHookCountMap[eventName] ?? 0) : 0;
                const entries = eventName ? (flowEventEntriesMap[eventName] ?? []) : [];
                const isClickable = Boolean(eventName);
                return (
                  <div key={`${step.title}-${idx}`} className="app-hooks-flow-h-step-wrap">
                    <div className={`app-hooks-flow-life-step ${isClickable ? "is-clickable" : ""} ${count > 0 ? "is-configured" : ""}`}>
                      {eventName ? (
                        <button type="button" className="app-hooks-flow-life-step-btn" title={`按 ${eventName} 过滤`}>
                          {step.title}
                        </button>
                      ) : (
                        <div className="app-hooks-flow-life-step-label">{step.title}</div>
                      )}
                      <HelpIcon text={getHelpTextByTitle(step.title, eventName)} />
                      {step.desc ? <div className="app-hooks-flow-life-step-chip">{step.desc}</div> : null}
                      {eventName ? (
                        <div className="app-hooks-flow-life-step-meta">
                          <span>配置: {count}</span>
                          <div className="app-hooks-flow-card-actions">
                            <Button size="small" type="default" className="app-hooks-flow-action-btn" onClick={() => onCreate(defaultCreateScope, eventName)}>
                              + Hook
                            </Button>
                            <Button size="small" type="default" className="app-hooks-flow-action-btn" onClick={() => onCopyEventName(eventName)}>
                              复制名
                            </Button>
                          </div>
                          <span>类型: {getSupportedTypesText(eventName)}</span>
                          {entries.length > 0 ? (
                            <div className="app-hooks-flow-config-list">
                              {entries.map((entry) => (
                                <button
                                  key={entry.handlerId}
                                  type="button"
                                  className="app-hooks-flow-config-item"
                                  onClick={() => onEdit(entry.scope, entry.eventName, entry.groupId, entry.handlerId)}
                                  title={`${entry.scope} · ${entry.matcher} · ${entry.summary}`}
                                >
                                  [{entry.scope}] {entry.matcher} · {entry.type} · {entry.summary}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    {idx < MAIN_FLOW_STEPS.length - 1 ? <div className="app-hooks-flow-life-arrow">→</div> : null}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="app-hooks-flow-horizontal-side">
            <div className="app-hooks-flow-side-title">侧挂 / 异步事件</div>
            <div className="app-hooks-flow-horizontal-side-track">
              {SIDE_EVENTS.map((item) => {
                const count = eventHookCountMap[item.eventName] ?? 0;
                const entries = flowEventEntriesMap[item.eventName] ?? [];
                return (
                  <div key={item.eventName} className={`app-hooks-flow-side-item ${count > 0 ? "is-configured" : ""}`}>
                    <button type="button" className="app-hooks-flow-side-btn">
                      {item.title}
                    </button>
                    <HelpIcon text={getHelpTextByTitle(item.title, item.eventName)} />
                    <div className="app-hooks-flow-side-meta">配置: {count}</div>
                    <div className="app-hooks-flow-card-actions app-hooks-flow-card-actions--side">
                      <Button size="small" type="default" className="app-hooks-flow-action-btn" onClick={() => onCreate(defaultCreateScope, item.eventName)}>
                        + Hook
                      </Button>
                      <Button size="small" type="default" className="app-hooks-flow-action-btn" onClick={() => onCopyEventName(item.eventName)}>
                        复制名
                      </Button>
                    </div>
                    {entries.length > 0 ? (
                      <div className="app-hooks-flow-config-list app-hooks-flow-config-list--side">
                        {entries.map((entry) => (
                          <button
                            key={entry.handlerId}
                            type="button"
                            className="app-hooks-flow-config-item"
                            onClick={() => onEdit(entry.scope, entry.eventName, entry.groupId, entry.handlerId)}
                            title={`${entry.scope} · ${entry.matcher} · ${entry.summary}`}
                          >
                            [{entry.scope}] {entry.matcher} · {entry.type} · {entry.summary}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

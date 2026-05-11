import { useEffect, useState, type ReactNode } from "react";
import { Button, Input, Popover, Tag } from "antd";
import type { QuestionRequest } from "../../../types";
import type { ControlRequestStatus } from "../../../notifications";
import { ControlRequestStatusHint } from "./control-request-status";

interface QuestionDockProps {
  request: QuestionRequest;
  /** 当前题之后、同一标签内排队的 AskUserQuestion 数量 */
  questionQueueLength?: number;
  requestStatus?: ControlRequestStatus | null;
  requestError?: string | null;
  /** 若传入，则替换「待你确认」+ 排队 Tag 所在行（用于同仓库多会话 Tabs） */
  headerTopSlot?: ReactNode;
  onSubmit: (answers: string[], customAnswer?: string) => void;
  /** 收起 Dock：已过期/失败时不写 stdin；仍可操作时等同于「跳过」 */
  onDismiss: () => void;
}

function resolveSubmitButtonLabel(status?: ControlRequestStatus | null): string {
  if (status === "failed") return "重试提交";
  if (status === "expired") return "重新提交";
  return "提交";
}

const QUESTION_EXPIRED_HELP =
  "该请求已超时。点「重新提交」将把当前选择与补充说明作为一条用户消息发出，并以 resume 重启该会话子进程。";

function QuestionExpiredHelpIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M9.75 9.25c0-1.25 1-2.25 2.25-2.25s2.25 1 2.25 2.25c0 1.1-.65 1.65-1.2 2.1-.42.35-.8.65-.8 1.15V14"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="17.25" r="0.9" fill="currentColor" />
    </svg>
  );
}

export function QuestionDock({
  request,
  questionQueueLength = 0,
  requestStatus,
  requestError,
  headerTopSlot,
  onSubmit,
  onDismiss,
}: QuestionDockProps) {
  const [selectedValues, setSelectedValues] = useState<string[]>([]);
  const [customAnswer, setCustomAnswer] = useState("");

  const dockResetKey = [
    request.id,
    request.question,
    request.multiSelect ? "1" : "0",
    request.options.map((o) => `${o.value}\t${o.label}`).join("\n"),
  ].join("\0");

  useEffect(() => {
    setSelectedValues([]);
    setCustomAnswer("");
  }, [dockResetKey]);

  const toggleOption = (value: string) => {
    if (request.multiSelect) {
      setSelectedValues((prev) =>
        prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
      );
    } else {
      setSelectedValues([value]);
    }
  };

  return (
    <div className="app-claude-dock app-claude-dock--question">
      <div className="app-claude-dock--question__header">
        <div
          className={`app-claude-dock--question__header-top${headerTopSlot ? " app-claude-dock--question__header-top--has-tabs" : ""}`}
        >
          {headerTopSlot ?? (
            <>
              <span className="app-claude-dock--question__kicker">待你确认</span>
              {questionQueueLength > 0 ? (
                <Tag color="processing" className="app-claude-dock--question__queue-tag">
                  排队 {questionQueueLength}
                </Tag>
              ) : null}
            </>
          )}
        </div>
        <div className="app-claude-dock--question__title-row">
          <span className="app-claude-dock--question__title-text">{request.question}</span>
          {requestStatus === "expired" ? (
            <>
              <Tag color="default" className="app-claude-dock--question__expired-tag">
                已过期
              </Tag>
              <Popover
                title={null}
                content={
                  <div style={{ maxWidth: 280, margin: 0, fontSize: 12, lineHeight: 1.55 }}>{QUESTION_EXPIRED_HELP}</div>
                }
                placement="topLeft"
                trigger={["hover", "click"]}
              >
                <button
                  type="button"
                  className="app-claude-dock--question__expired-help"
                  aria-label="已过期说明"
                >
                  <QuestionExpiredHelpIcon />
                </button>
              </Popover>
            </>
          ) : null}
        </div>
      </div>
      <div className="app-claude-dock--question__main">
        <ControlRequestStatusHint
          status={requestStatus}
          errorText={requestError}
          failedFallbackText="上次回复未送达，请重试提交。"
          expiredText={QUESTION_EXPIRED_HELP}
          density="compact"
          expiredPresentation="none"
        />
        <div className="app-claude-dock--question__options">
          {request.options.map((opt) => (
            <label key={opt.value} className="app-claude-dock--question__option">
              <input
                type={request.multiSelect ? "checkbox" : "radio"}
                name={`question-${request.id}`}
                checked={selectedValues.includes(opt.value)}
                onChange={() => toggleOption(opt.value)}
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
        <div className="app-claude-dock--question__note-wrap">
          <Input.TextArea
            value={customAnswer}
            onChange={(e) => setCustomAnswer(e.target.value)}
            placeholder="可选：补充说明"
            autoSize={{ minRows: 1, maxRows: 4 }}
            style={{ fontSize: "12px" }}
          />
        </div>
      </div>
      <div className="app-claude-dock--question__actions">
        <Button type="text" size="small" onClick={onDismiss} title="已过期或失败时直接收起；仍可提交时与「跳过」相同">
          关闭
        </Button>
        <div className="app-claude-dock--question__actions-tail">
          <Button size="small" onClick={() => onSubmit([])}>
            跳过
          </Button>
          <Button
            size="small"
            type="primary"
            onClick={() => onSubmit(selectedValues, customAnswer.trim() || undefined)}
          >
            {resolveSubmitButtonLabel(requestStatus)}
          </Button>
        </div>
      </div>
    </div>
  );
}

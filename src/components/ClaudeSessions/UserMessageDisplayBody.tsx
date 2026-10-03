import { memo, useMemo, useState } from "react";
import type { ClaudeMessage } from "../../types";
import { userMessagePlainTextForDisplay } from "../../utils/claudeChatMessageDisplay";
import { stripAppliedDefaultInstructionFromDisplayText } from "../../utils/composerDefaultInstruction";
import { extractImportantUserInputForDisplay } from "../../utils/userMessageImportantInput";
import { splitUserMessageAtRefs } from "../../utils/userMessageAtRefs";
import { UserMessageCollapsibleBody } from "./UserMessageCollapsibleBody";

interface Props {
  msg: ClaudeMessage;
  /** 保留与调用方签名一致；用户消息按纯文本展示，不走 Markdown / 流式渲染管线。 */
  streaming?: boolean;
}

function userMessageDisplayKey(msg: ClaudeMessage): string {
  const parts = msg.parts;
  if (parts?.length) {
    return parts
      .filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\u0000");
  }
  return msg.content ?? "";
}

/**
 * 用户消息正文：按原文纯文本展示，避免 lint 日志等被 Markdown 误解析。
 * `@文件/目录` 引用按 Composer 语义加高亮，对照 Codex 桌面端把引用从正文里凸显出来。
 */
function UserMessagePlainText({ text }: { text: string }) {
  const tokens = useMemo(() => splitUserMessageAtRefs(text), [text]);
  if (!text) return null;
  if (tokens.length === 1 && tokens[0]!.type === "text") {
    return <div className="app-claude-user-message-plain">{text}</div>;
  }
  return (
    <div className="app-claude-user-message-plain">
      {tokens.map((token, index) =>
        token.type === "at" ? (
          <span
            key={index}
            className="app-claude-user-message-at-ref"
            title={token.value}
          >
            {token.value}
          </span>
        ) : (
          <span key={index}>{token.value}</span>
        ),
      )}
    </div>
  );
}

/** 用户消息列表展示：默认仅重要输入（Cursor 风格），可展开完整原文。 */
export const UserMessageDisplayBody = memo(function UserMessageDisplayBody({ msg }: Props) {
  const sourceKey = useMemo(() => userMessageDisplayKey(msg), [msg]);
  const fullText = useMemo(() => userMessagePlainTextForDisplay(msg), [sourceKey]);
  const display = useMemo(() => extractImportantUserInputForDisplay(fullText), [fullText]);
  const [showFullInput, setShowFullInput] = useState(false);
  const visibleText = showFullInput ? fullText : display.compactText;
  const defaultInstructionApplied = msg.defaultInstructionApplied?.trim() || "";
  const bodyText =
    defaultInstructionApplied && !showFullInput
      ? stripAppliedDefaultInstructionFromDisplayText(visibleText, defaultInstructionApplied)
      : visibleText;

  return (
    <div className="app-claude-user-message-display">
      <UserMessageCollapsibleBody collapsible={!showFullInput}>
        <div className="app-message-part app-message-part--text">
          {defaultInstructionApplied && !showFullInput ? (
            <div className="app-claude-user-message-inline-row">
              <span
                className="app-claude-user-message-default-instruction"
                title={`已自动前缀：${defaultInstructionApplied}`}
              >
                {defaultInstructionApplied}
              </span>
              <UserMessagePlainText text={bodyText} />
            </div>
          ) : (
            <UserMessagePlainText text={visibleText} />
          )}
        </div>
      </UserMessageCollapsibleBody>
      {display.attachmentPaths.length > 0 || display.hasStrippedContext ? (
        <div className="app-claude-user-message-meta-row">
          {display.attachmentPaths.length > 0 ? (
            <div
              className="app-claude-user-message-attachments"
              title={display.attachmentPaths.join("\n")}
            >
              {display.attachmentPaths.length} 个附件
            </div>
          ) : null}
          {display.hasStrippedContext ? (
            <button
              type="button"
              className="app-claude-user-message-collapsible__toggle"
              onClick={() => setShowFullInput((prev) => !prev)}
              title="包含被精简的规则 / 上下文等原始输入"
            >
              {showFullInput ? "收起原始输入" : "显示原始输入"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

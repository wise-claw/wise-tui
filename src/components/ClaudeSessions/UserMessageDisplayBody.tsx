import { memo, useMemo, useState } from "react";
import type { ClaudeMessage } from "../../types";
import { userMessagePlainTextForDisplay } from "../../utils/claudeChatMessageDisplay";
import { stripAppliedDefaultInstructionFromDisplayText } from "../../utils/composerDefaultInstruction";
import { extractImportantUserInputForDisplay } from "../../utils/userMessageImportantInput";
import { Markdown } from "./Markdown";
import { UserMessageCollapsibleBody } from "./UserMessageCollapsibleBody";

interface Props {
  msg: ClaudeMessage;
  streaming: boolean;
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

/** 用户消息列表展示：默认仅重要输入（Cursor 风格），可展开完整原文。 */
export const UserMessageDisplayBody = memo(function UserMessageDisplayBody({ msg, streaming }: Props) {
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
      <UserMessageCollapsibleBody>
        <div className="app-message-part app-message-part--text">
          {defaultInstructionApplied && !showFullInput ? (
            <div className="app-claude-user-message-inline-row">
              <span
                className="app-claude-user-message-default-instruction"
                title={`已自动前缀：${defaultInstructionApplied}`}
              >
                {defaultInstructionApplied}
              </span>
              {bodyText ? (
                <Markdown text={bodyText} streaming={streaming} showPendingHint={false} />
              ) : null}
            </div>
          ) : (
            <Markdown text={visibleText} streaming={streaming} showPendingHint={false} />
          )}
          {!showFullInput && display.attachmentPaths.length > 0 ? (
            <div
              className="app-claude-user-message-attachments"
              title={display.attachmentPaths.join("\n")}
            >
              {display.attachmentPaths.length} 张附图
            </div>
          ) : null}
        </div>
      </UserMessageCollapsibleBody>
      {display.hasStrippedContext ? (
        <button
          type="button"
          className="app-claude-user-message-collapsible__toggle"
          onClick={() => setShowFullInput((prev) => !prev)}
        >
          {showFullInput ? "收起完整输入" : "查看完整输入"}
        </button>
      ) : null}
    </div>
  );
});

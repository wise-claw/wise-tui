import { Button, message } from "antd";
import { useMemo, useState } from "react";
import { Markdown } from "./Markdown";
import { useChatRepositoryPath } from "./chatRepositoryContext";
import { isMacPlatform } from "../../services/macosTerminal";
import { tryOpenWorkspaceInDefaultTerminalWithCommand } from "../../services/openWorkspaceWithTerminalPreference";

function isCodexAuth401(text: string): boolean {
  const lower = text.toLowerCase();
  const hasCodexSignal =
    lower.includes("codex") ||
    lower.includes("openai default") ||
    lower.includes("api.openai.com/v1/responses");
  return /\b401\b/.test(lower) && hasCodexSignal;
}

function isErrorNotice(text: string): boolean {
  const head = text.trimStart().slice(0, 32);
  return /^错误[:：]|^发送失败[:：]|^启动失败[:：]/.test(head) || isCodexAuth401(text);
}

/** 去掉 BOM、统一换行，减少解析与展示异常 */
function normalizeSystemText(raw: string): string {
  return raw.replace(/^﻿/, "").replace(/\r\n/g, "\n");
}

/**
 * 在 ``` 围栏外把易被 marked 当成 HTML 的 `<` 写成 `\\<`，避免 DOMPurify 后乱码或吞字。
 * 不影响围栏内内容（多为 JSON/代码）。
 */
function hardenMarkdownOutsideCodeFences(md: string): string {
  const chunks = md.split(/(```[\s\S]*?```)/g);
  return chunks
    .map((chunk, idx) => {
      if (idx % 2 === 1) return chunk;
      return chunk.replace(/<(?!(?:https?:\/\/|mailto:))(?=[a-zA-Z/!?])/gi, "\\<");
    })
    .join("");
}

/** 系统级错误图标：与工具失败的红描边/chip 风格对齐，让失败在对话流中显眼可识别。 */
function SystemErrorIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M10 3.5 18 16.5 2 16.5 Z" />
      <path d="M10 8.5 V12" />
      <path d="M10 14.6h.01" />
    </svg>
  );
}

function CodexLoginAction() {
  const repositoryPath = useChatRepositoryPath();
  const [opening, setOpening] = useState(false);

  async function openTerminalAndLogin() {
    if (!repositoryPath) {
      message.error("当前会话没有可用的工作区路径");
      return;
    }
    setOpening(true);
    try {
      const result = await tryOpenWorkspaceInDefaultTerminalWithCommand(
        repositoryPath,
        "codex",
      );
      if (result.ok) {
        if (isMacPlatform()) {
          message.success("已在终端启动 Codex，请按提示完成登录");
        } else {
          message.info("终端已打开，请运行 codex 完成登录");
        }
      } else {
        message.error(`打开终端失败：${result.message}`);
      }
    } catch (error) {
      message.error(`打开终端失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="app-system-message__actions">
      <Button
        type="primary"
        size="small"
        loading={opening}
        disabled={!repositoryPath}
        onClick={() => void openTerminalAndLogin()}
      >
        打开终端运行 Codex
      </Button>
      {!repositoryPath ? <span>当前会话没有工作区路径</span> : null}
    </div>
  );
}

/**
 * 系统消息裸展示：不再套用外层卡片 / 工具栏，仅保留一个轻量状态 className，
 * 用于在消息气泡上做错误着色。复制 / 展开 / 格式徽标等装饰交给消息行操作菜单。
 */
export function SystemMessageContent({ text }: { text: string }) {
  const normalizedText = useMemo(() => normalizeSystemText(text), [text]);
  const error = isErrorNotice(normalizedText);
  const codexAuth401 = isCodexAuth401(normalizedText);
  const trimmed = normalizedText.trim();
  if (!trimmed) return null;

  return (
    <div className={`app-system-message${error ? " app-system-message--error" : ""}`}>
      {error ? (
        <span className="app-system-message__icon">
          <SystemErrorIcon />
        </span>
      ) : null}
      <div className="app-system-message__body">
        <Markdown
          text={hardenMarkdownOutsideCodeFences(normalizedText)}
          streaming={false}
          showPendingHint={false}
          className="app-system-message-md"
        />
        {codexAuth401 ? <CodexLoginAction /> : null}
      </div>
    </div>
  );
}

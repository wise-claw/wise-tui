import { useCallback, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { safeUnlisten } from "../utils/safeTauriUnlisten";
import { message } from "antd";
import type { ClaudeSession, ProjectItem, Repository } from "../types";
import { WISE_DINGTALK_AUTOMATION_V1_EVENT } from "../constants/dingtalkWiseAutomation";
import { isWiseDingTalkAutomationV1Payload, sendDingTalkWiseAutomationReplyMarkdown } from "../services/dingtalkWiseAutomation";
import { resolveDingTalkAutomationAssistantBody } from "../services/dingTalkAutomationReplyBody";
import { buildDingTalkAutomationExecutePrompt } from "../utils/dingTalkAutomationInboundPrompt";
import {
  detectDingTalkAutomationQuickCommand,
  formatRepositoriesMarkdownForDingTalk,
} from "../utils/dingTalkAutomationQuickCommands";
import { stripAssistantStreamNoiseForDingTalkExport } from "../utils/dingTalkOutboundAssistantText";
import { resolveRepositoryForDingTalkAutomation } from "../utils/resolveRepositoryForDingTalkAutomation";
import { pickSessionForRepositorySidebarSelect } from "../utils/claudeSessionSelection";
import { repositorySessionTabDisplayName } from "../utils/repositoryType";
import { loadSessionOwnerHints } from "../utils/sessionOwnerHints";
import { resolveBoundMainSessionId, resolveMainOwnerAgentNameForRepositoryPath } from "../utils/repositoryMainSessionBinding";
import { readVisiblePollIntervalMs } from "../utils/adaptivePoll";

type CreateSession = (
  repositoryPath: string,
  repositoryName: string,
  opts?: { skipActivate?: boolean },
) => Promise<string>;

interface UseDingTalkAutomationInboundOptions {
  activeProjectId: string | null;
  activeRepositoryId: number | null;
  bindRepositoryMainSession: (repositoryPath: string, sessionId: string) => void | Promise<void>;
  createSession: CreateSession;
  executeSession: (sessionId: string, prompt: string) => boolean;
  jumpToSessionWithRepository: (sessionId: string) => void;
  projects: ProjectItem[];
  repositories: Repository[];
  repositoryMainSessionBindings: Record<string, string>;
  sessions: ClaudeSession[];
}

interface FlushDingTalkAutomationReplyInput {
  assistantPreviewRaw: string;
  payloadSessionId: string;
  session: ClaudeSession | undefined;
  success: boolean;
}

function makeRuntimeId(prefix: string): string {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? `${prefix}-${globalThis.crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

const DINGTALK_INBOUND_JOB_TIMEOUT_MS = 20 * 60 * 1000;
const DINGTALK_PENDING_STALE_MS = 25 * 60 * 1000;
const DINGTALK_PENDING_SWEEP_MS = 60_000;

export function useDingTalkAutomationInbound({
  activeProjectId,
  activeRepositoryId,
  bindRepositoryMainSession,
  createSession,
  executeSession,
  jumpToSessionWithRepository,
  projects,
  repositories,
  repositoryMainSessionBindings,
  sessions,
}: UseDingTalkAutomationInboundOptions) {
  const activeProjectIdRef = useRef(activeProjectId);
  const activeRepositoryIdRef = useRef(activeRepositoryId);
  const bindRepositoryMainSessionRef = useRef(bindRepositoryMainSession);
  const createSessionRef = useRef(createSession);
  const executeSessionRef = useRef(executeSession);
  const jumpToSessionWithRepositoryRef = useRef(jumpToSessionWithRepository);
  const projectsRef = useRef(projects);
  const repositoriesRef = useRef(repositories);
  const repositoryMainSessionBindingsRef = useRef(repositoryMainSessionBindings);
  const sessionsRef = useRef(sessions);

  activeProjectIdRef.current = activeProjectId;
  activeRepositoryIdRef.current = activeRepositoryId;
  bindRepositoryMainSessionRef.current = bindRepositoryMainSession;
  createSessionRef.current = createSession;
  executeSessionRef.current = executeSession;
  jumpToSessionWithRepositoryRef.current = jumpToSessionWithRepository;
  projectsRef.current = projects;
  repositoriesRef.current = repositories;
  repositoryMainSessionBindingsRef.current = repositoryMainSessionBindings;
  sessionsRef.current = sessions;

  const pendingRef = useRef(
    new Map<
      string,
      {
        dingTalkUserId: string;
        uxMessageKey: string;
        dingTalkInboundJobId?: string;
        createdAt: number;
      }
    >(),
  );
  const inboundJobResolversRef = useRef(new Map<string, () => void>());

  const clearPendingAndResolveInboundJob = useCallback((tabKey: string) => {
    const pending = pendingRef.current.get(tabKey);
    if (!pending) {
      return;
    }
    const jobId = pending.dingTalkInboundJobId;
    pendingRef.current.delete(tabKey);
    if (jobId) {
      const resolve = inboundJobResolversRef.current.get(jobId);
      if (resolve) {
        inboundJobResolversRef.current.delete(jobId);
        resolve();
      }
    }
  }, []);

  useEffect(() => {
    const sweep = () => {
      const now = Date.now();
      for (const [tabKey, pending] of [...pendingRef.current.entries()]) {
        if (now - pending.createdAt < DINGTALK_PENDING_STALE_MS) continue;
        message.destroy(pending.uxMessageKey);
        clearPendingAndResolveInboundJob(tabKey);
      }
      for (const jobId of [...inboundJobResolversRef.current.keys()]) {
        if (!jobId.includes("dingtalk-inbound")) continue;
        const stillPending = [...pendingRef.current.values()].some((entry) => entry.dingTalkInboundJobId === jobId);
        if (!stillPending) {
          inboundJobResolversRef.current.delete(jobId);
        }
      }
    };
    const timer = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      sweep();
    }, readVisiblePollIntervalMs(DINGTALK_PENDING_SWEEP_MS, DINGTALK_PENDING_SWEEP_MS * 3));
    return () => window.clearInterval(timer);
  }, [clearPendingAndResolveInboundJob]);

  const moveDingTalkAutomationPendingSessionId = useCallback((fromTabId: string, toClaudeSessionId: string) => {
    const pending = pendingRef.current.get(fromTabId);
    if (!pending) {
      return;
    }
    pendingRef.current.delete(fromTabId);
    pendingRef.current.set(toClaudeSessionId, pending);
  }, []);

  const flushDingTalkAutomationReplyForTurn = useCallback(
    ({ assistantPreviewRaw, payloadSessionId, session, success }: FlushDingTalkAutomationReplyInput) => {
      const tabKey = session?.id ?? payloadSessionId;
      const pending = pendingRef.current.get(tabKey);
      if (!pending) return false;

      const previewStripped = stripAssistantStreamNoiseForDingTalkExport(assistantPreviewRaw).trim();
      const resolvedAssistant = resolveDingTalkAutomationAssistantBody(session, assistantPreviewRaw).trim();
      const markdown = resolvedAssistant || previewStripped || (success ? "（本轮无可见文本输出）" : "处理未成功");
      const uid = pending.dingTalkUserId;
      const uxKey = pending.uxMessageKey;
      clearPendingAndResolveInboundJob(tabKey);
      message.destroy(uxKey);
      void sendDingTalkWiseAutomationReplyMarkdown(uid, markdown)
        .then(() => {
          void message.success({ content: "钉钉：处理结果已发回单聊", duration: 2.5 });
        })
        .catch((err) => {
          console.error("DingTalk automation reply failed:", err);
          void message.error(err instanceof Error ? err.message : "回发钉钉失败");
        });
      return true;
    },
    [clearPendingAndResolveInboundJob],
  );

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    const inboundQueue: unknown[] = [];
    let inboundTail: Promise<void> = Promise.resolve();

    function enqueueInbound(raw: unknown) {
      inboundQueue.push(raw);
      inboundTail = inboundTail.then(async () => {
        if (cancelled) {
          return;
        }
        while (inboundQueue.length > 0) {
          const item = inboundQueue.shift();
          if (item === undefined) {
            break;
          }
          try {
            await handleInbound(item);
          } catch (err) {
            console.error("DingTalk automation inbound queue handler failed:", err);
          }
          if (cancelled) {
            return;
          }
        }
      });
    }

    async function handleInbound(raw: unknown) {
      if (!isWiseDingTalkAutomationV1Payload(raw)) return;
      const { dingTalkUserId, repositoryName, prompt, imageDataUrls } = raw;
      const promptText = (prompt ?? "").trim();
      const hasImages = (imageDataUrls?.length ?? 0) > 0;
      if (!dingTalkUserId.trim() || (!promptText && !hasImages)) return;

      const uxMessageKey = makeRuntimeId("wise-dingtalk-ux");
      void message.open({
        key: uxMessageKey,
        type: "loading",
        content: "正在接收钉钉消息…",
        duration: 0,
      });

      const quick = detectDingTalkAutomationQuickCommand(promptText, repositoryName ?? null);
      if (quick.kind === "list_repositories") {
        message.destroy(uxMessageKey);
        const md = formatRepositoriesMarkdownForDingTalk(repositoriesRef.current, projectsRef.current);
        try {
          await sendDingTalkWiseAutomationReplyMarkdown(dingTalkUserId.trim(), md, "仓库列表");
          void message.success({ content: "钉钉：已返回仓库列表", duration: 2.5 });
        } catch (err) {
          console.error("DingTalk automation list repos reply failed:", err);
          void message.error(err instanceof Error ? err.message : "回发钉钉失败");
        }
        return;
      }

      if (quick.kind === "switch_repository" || quick.kind === "new_session") {
        const isSwitch = quick.kind === "switch_repository";
        const hasRepoHint = quick.repoFilter.trim().length > 0;
        if (isSwitch && !hasRepoHint) {
          message.destroy(uxMessageKey);
          try {
            await sendDingTalkWiseAutomationReplyMarkdown(
              dingTalkUserId.trim(),
              "切换仓库失败：请写出仓库名，例如：`切换仓库 my-repo`，或在首行写「切换仓库」、次行写仓库名，或在入站 JSON 中填写 `repositoryName`。",
              "Wise",
            );
          } catch (err) {
            console.error("DingTalk automation switch repo hint reply failed:", err);
            void message.error(err instanceof Error ? err.message : "回发钉钉失败");
          }
          void message.warning("切换仓库：未指定目标仓库");
          return;
        }
        const resolved = resolveRepositoryForDingTalkAutomation({
          repositories: repositoriesRef.current,
          projects: projectsRef.current,
          activeProjectId: activeProjectIdRef.current,
          activeRepositoryId: activeRepositoryIdRef.current,
          repositoryNameFilter: hasRepoHint ? quick.repoFilter.trim() : (repositoryName ?? null),
          resolveScope: hasRepoHint || isSwitch ? "all_projects" : "active_project",
        });
        if (!resolved.repository) {
          message.destroy(uxMessageKey);
          try {
            await sendDingTalkWiseAutomationReplyMarkdown(
              dingTalkUserId.trim(),
              resolved.reason ??
                (isSwitch
                  ? `未找到匹配仓库：${quick.repoFilter}`
                  : "新建会话失败：请指定仓库（如 `新建会话 my-repo`）、首行写命令次行写仓库名，或在 JSON 中填写 `repositoryName`；无仓库名时需侧栏能默认到当前仓库。"),
              "Wise",
            );
          } catch (err) {
            console.error("DingTalk automation repository command reply failed:", err);
            void message.error(err instanceof Error ? err.message : "回发钉钉失败");
          }
          void message.error(resolved.reason ?? "钉钉自动化：无法解析目标仓库");
          return;
        }

        const repo = resolved.repository;
        const repositoryPath = repo.path.trim();
        try {
          void message.open({
            key: uxMessageKey,
            type: "loading",
            content: isSwitch
              ? `正在打开「${repo.name}」Repo 执行会话…`
              : `正在为「${repo.name}」新建 Repo 执行会话…`,
            duration: 0,
          });
          let targetId: string | null = null;
          const mainOwnerPick = resolveMainOwnerAgentNameForRepositoryPath(repositoriesRef.current, repositoryPath);
          if (isSwitch) {
            targetId = resolveBoundMainSessionId(
              repositoryPath,
              repositoryMainSessionBindingsRef.current,
              sessionsRef.current,
              mainOwnerPick,
            );
            if (!targetId) {
              const picked = pickSessionForRepositorySidebarSelect(
                sessionsRef.current,
                repositoryPath,
                loadSessionOwnerHints(),
                { mainOwnerAgentName: mainOwnerPick },
              );
              targetId = picked?.id ?? null;
            }
          }
          if (!targetId) {
            targetId = await createSessionRef.current(repositoryPath, repositorySessionTabDisplayName(repo));
          }
          await bindRepositoryMainSessionRef.current(repositoryPath, targetId);
          jumpToSessionWithRepositoryRef.current(targetId);
          message.destroy(uxMessageKey);
          await sendDingTalkWiseAutomationReplyMarkdown(
            dingTalkUserId.trim(),
            isSwitch
              ? `消息已处理完成。\n\n已切换至仓库 **${repo.name}** 并打开 Repo 执行会话。`
              : `消息已处理完成。\n\n已在仓库 **${repo.name}** 新建 Repo 执行会话并打开。`,
            "Wise",
          );
          void message.success({ content: isSwitch ? "钉钉：已切换仓库并打开 Repo 执行会话" : "钉钉：已新建 Repo 执行会话", duration: 2.5 });
        } catch (err) {
          message.destroy(uxMessageKey);
          console.error("DingTalk automation repository command failed:", err);
          try {
            await sendDingTalkWiseAutomationReplyMarkdown(
              dingTalkUserId.trim(),
              `${isSwitch ? "打开 Repo 执行会话" : "新建 Repo 执行会话"}失败：${err instanceof Error ? err.message : String(err)}`,
              "Wise",
            );
          } catch (e) {
            console.error(e);
          }
          if (!isSwitch) {
            void message.error(err instanceof Error ? err.message : "新建会话失败");
          }
        }
        return;
      }

      const { repository, reason } = resolveRepositoryForDingTalkAutomation({
        repositories: repositoriesRef.current,
        projects: projectsRef.current,
        activeProjectId: activeProjectIdRef.current,
        activeRepositoryId: activeRepositoryIdRef.current,
        repositoryNameFilter: repositoryName ?? null,
      });
      if (!repository) {
        message.destroy(uxMessageKey);
        void message.error(reason ?? "钉钉自动化：无法解析目标仓库");
        void sendDingTalkWiseAutomationReplyMarkdown(
          dingTalkUserId,
          reason ?? "无法解析目标仓库：请在侧栏选中仓库或在入站 JSON 中填写 repositoryName。",
        ).catch((err) => {
          console.error("DingTalk automation error reply failed:", err);
        });
        return;
      }

      const repositoryPath = repository.path.trim();
      const mainOwnerPick = resolveMainOwnerAgentNameForRepositoryPath(repositoriesRef.current, repositoryPath);
      let targetId = resolveBoundMainSessionId(
        repositoryPath,
        repositoryMainSessionBindingsRef.current,
        sessionsRef.current,
        mainOwnerPick,
      );
      if (!targetId) {
        const picked = pickSessionForRepositorySidebarSelect(
          sessionsRef.current,
          repositoryPath,
          loadSessionOwnerHints(),
          { mainOwnerAgentName: mainOwnerPick },
        );
        targetId = picked?.id ?? null;
      }
      if (!targetId) {
        try {
          void message.open({
            key: uxMessageKey,
            type: "loading",
            content: `正在打开「${repository.name}」Repo 执行会话…`,
            duration: 0,
          });
          targetId = await createSessionRef.current(repositoryPath, repositorySessionTabDisplayName(repository));
          await bindRepositoryMainSessionRef.current(repositoryPath, targetId);
        } catch (err) {
          message.destroy(uxMessageKey);
          console.error("DingTalk automation createSession failed:", err);
          void sendDingTalkWiseAutomationReplyMarkdown(
            dingTalkUserId,
            `创建 Claude 会话失败：${err instanceof Error ? err.message : String(err)}`,
          ).catch((e) => console.error(e));
          return;
        }
      } else {
        await bindRepositoryMainSessionRef.current(repositoryPath, targetId);
      }

      void message.open({
        key: uxMessageKey,
        type: "loading",
        content: `正在切换到「${repository.name}」Repo 执行会话…`,
        duration: 0,
      });

      jumpToSessionWithRepositoryRef.current(targetId);
      const inboundJobId = makeRuntimeId("dingtalk-inbound");
      pendingRef.current.set(targetId, {
        dingTalkUserId: dingTalkUserId.trim(),
        uxMessageKey,
        dingTalkInboundJobId: inboundJobId,
        createdAt: Date.now(),
      });

      void message.open({
        key: uxMessageKey,
        type: "loading",
        content: `已在「${repository.name}」Repo 执行会话处理钉钉指令，完成后将回发钉钉…`,
        duration: 0,
      });

      let outgoingPrompt = promptText;
      if (hasImages) {
        try {
          outgoingPrompt = await buildDingTalkAutomationExecutePrompt({
            repositoryPath,
            promptText,
            imageDataUrls,
          });
        } catch (err) {
          clearPendingAndResolveInboundJob(targetId);
          message.destroy(uxMessageKey);
          console.error("DingTalk automation image prompt build failed:", err);
          void sendDingTalkWiseAutomationReplyMarkdown(
            dingTalkUserId,
            `处理钉钉图片失败：${err instanceof Error ? err.message : String(err)}`,
          ).catch((e) => console.error(e));
          return;
        }
      }

      const ok = executeSessionRef.current(targetId, outgoingPrompt);
      if (!ok) {
        clearPendingAndResolveInboundJob(targetId);
        message.destroy(uxMessageKey);
        void message.warning("未能启动 Claude Code（可能被并发策略或本地门闸拦截）");
        void sendDingTalkWiseAutomationReplyMarkdown(
          dingTalkUserId,
          "未能启动 Claude Code（可能被并发策略或本地门闸拦截），请稍后重试。",
        ).catch((err) => {
          console.error("DingTalk automation blocked reply failed:", err);
        });
        return;
      }

      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeoutId);
          inboundJobResolversRef.current.delete(inboundJobId);
          resolve();
        };
        const timeoutId = window.setTimeout(() => {
          clearPendingAndResolveInboundJob(targetId);
          message.destroy(uxMessageKey);
          finish();
        }, DINGTALK_INBOUND_JOB_TIMEOUT_MS);
        inboundJobResolversRef.current.set(inboundJobId, finish);
      });
    }

    void listen(WISE_DINGTALK_AUTOMATION_V1_EVENT, (ev) => {
      enqueueInbound(ev.payload);
    }).then((u) => {
      if (cancelled) {
        safeUnlisten(u);
        return;
      }
      unlisten = u;
    });

    return () => {
      cancelled = true;
      safeUnlisten(unlisten);
      for (const finish of [...inboundJobResolversRef.current.values()]) {
        finish();
      }
      inboundJobResolversRef.current.clear();
      for (const pending of pendingRef.current.values()) {
        message.destroy(pending.uxMessageKey);
      }
      pendingRef.current.clear();
    };
  }, [clearPendingAndResolveInboundJob]);

  return {
    flushDingTalkAutomationReplyForTurn,
    moveDingTalkAutomationPendingSessionId,
  };
}

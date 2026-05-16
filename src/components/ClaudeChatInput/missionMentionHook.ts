import {
  appendMissionEvent,
  recordMissionAgentCommand,
  type MissionEventRecord,
  type MissionAgentCommand,
} from "../../services/missionControlBackend";
import {
  ensureSessionBoundToActiveMission,
  type EnsureSessionMissionBindingResult,
} from "../../services/mission/sessionBinding";

export interface RecordMissionComposerMessageInput {
  sessionId: string | null | undefined;
  projectId?: string | null;
  rootPath?: string | null;
  text: string | null | undefined;
}

export interface MissionMentionHookDeps {
  ensureSessionBoundToActiveMission: typeof ensureSessionBoundToActiveMission;
  recordMissionAgentCommand: typeof recordMissionAgentCommand;
  appendMissionEvent: typeof appendMissionEvent;
}

export interface RecordMissionComposerMessageResult {
  missionId: string | null;
  mentions: string[];
  commands: MissionAgentCommand[];
  event: MissionEventRecord | null;
}

const realDeps: MissionMentionHookDeps = {
  ensureSessionBoundToActiveMission,
  recordMissionAgentCommand,
  appendMissionEvent,
};

const MENTION_PATTERN = /(^|[\s([{，。！？；：、])@([^\s@#()[\]{}<>,"'`，。！？；：、]+)/gu;
const SNIPPET_MAX_LENGTH = 180;

function normalizeOptionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

export function extractMissionMentions(text: string | null | undefined): string[] {
  const source = text ?? "";
  const mentions: string[] = [];
  const seen = new Set<string>();
  for (const match of source.matchAll(MENTION_PATTERN)) {
    const mention = match[2]?.trim();
    if (!mention || seen.has(mention)) continue;
    seen.add(mention);
    mentions.push(mention);
  }
  return mentions;
}

export function missionMessageSnippet(text: string | null | undefined): string {
  const normalized = (text ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= SNIPPET_MAX_LENGTH) return normalized;
  return `${normalized.slice(0, SNIPPET_MAX_LENGTH - 3)}...`;
}

export async function recordMissionComposerMessage(
  input: RecordMissionComposerMessageInput,
  deps: MissionMentionHookDeps = realDeps,
): Promise<RecordMissionComposerMessageResult> {
  const sessionId = normalizeOptionalText(input.sessionId);
  const text = input.text ?? "";
  if (!sessionId || !text.trim()) {
    return { missionId: null, mentions: [], commands: [], event: null };
  }

  const binding: EnsureSessionMissionBindingResult = await deps.ensureSessionBoundToActiveMission({
    sessionId,
    projectId: input.projectId,
    rootPath: input.rootPath,
  });
  const missionId = binding.mission?.missionId ?? null;
  if (!missionId) {
    return { missionId: null, mentions: [], commands: [], event: null };
  }

  const mentions = extractMissionMentions(text);
  const commands = await Promise.all(
    mentions.map((mention) =>
      deps.recordMissionAgentCommand({
        missionId,
        commandType: "mention",
        targetKind: "text",
        targetId: mention,
        result: {
          sessionId,
          source: "main_chat",
        },
      }),
    ),
  );
  const event = await deps.appendMissionEvent({
    missionId,
    eventType: "mission.session.message",
    payload: {
      sessionId,
      snippet: missionMessageSnippet(text),
      mentions,
    },
  });

  return { missionId, mentions, commands, event };
}

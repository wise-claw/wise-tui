import {
  attachMissionToSession,
  getSessionMission,
  listRecentMissions,
  type MissionSessionBinding,
  type MissionSnapshotRecord,
} from "../missionControlBackend";

export interface EnsureSessionMissionBindingInput {
  sessionId: string | null | undefined;
  projectId?: string | null;
  rootPath?: string | null;
}

export interface EnsureSessionMissionBindingResult {
  mission: MissionSnapshotRecord | null;
  binding: MissionSessionBinding | null;
  didAttach: boolean;
}

export interface SessionMissionBindingDeps {
  listRecentMissions: typeof listRecentMissions;
  getSessionMission: typeof getSessionMission;
  attachMissionToSession: typeof attachMissionToSession;
}

const TERMINAL_MISSION_STAGES = new Set(["done", "archived"]);

const realDeps: SessionMissionBindingDeps = {
  listRecentMissions,
  getSessionMission,
  attachMissionToSession,
};

function normalizeOptionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

function isActiveMission(mission: MissionSnapshotRecord): boolean {
  return !TERMINAL_MISSION_STAGES.has(mission.stage.trim().toLowerCase());
}

export async function findLatestActiveMission(
  input: Pick<EnsureSessionMissionBindingInput, "projectId" | "rootPath">,
  deps: Pick<SessionMissionBindingDeps, "listRecentMissions"> = realDeps,
): Promise<MissionSnapshotRecord | null> {
  const projectId = normalizeOptionalText(input.projectId);
  const rootPath = normalizeOptionalText(input.rootPath);
  if (!projectId && !rootPath) return null;

  const recent = await deps.listRecentMissions({ projectId, rootPath, limit: 5 });
  return recent.find(isActiveMission) ?? null;
}

export async function ensureSessionBoundToActiveMission(
  input: EnsureSessionMissionBindingInput,
  deps: SessionMissionBindingDeps = realDeps,
): Promise<EnsureSessionMissionBindingResult> {
  const sessionId = normalizeOptionalText(input.sessionId);
  if (!sessionId) {
    return { mission: null, binding: null, didAttach: false };
  }

  const mission = await findLatestActiveMission(input, deps);
  if (!mission) {
    return { mission: null, binding: null, didAttach: false };
  }

  const existing = await deps.getSessionMission(sessionId);
  if (existing?.missionId === mission.missionId) {
    return { mission, binding: null, didAttach: false };
  }

  const binding = await deps.attachMissionToSession({
    sessionId,
    missionId: mission.missionId,
    projectId: normalizeOptionalText(mission.projectId) ?? normalizeOptionalText(input.projectId),
    metadata: {
      source: "main_chat",
      rootPath: normalizeOptionalText(mission.rootPath) ?? normalizeOptionalText(input.rootPath),
    },
  });
  return { mission, binding, didAttach: true };
}

import type { AssistantBundleItem, AssistantRuntimeBundle } from "../../services/assistantPromptLayers";
import type { ScannedSkill } from "../../services/skills";

export interface SkillMountCandidate {
  id: string;
  label: string;
  sourcePath: string;
  origin: string;
  hasSkillMd: boolean;
}

export function scannedSkillToMountCandidate(skill: ScannedSkill): SkillMountCandidate {
  return {
    id: skill.name,
    label: skill.name,
    sourcePath: skill.location,
    origin: skill.source,
    hasSkillMd: skill.hasSkillMd,
  };
}

export function addSkillMount(
  bundle: AssistantRuntimeBundle,
  candidate: SkillMountCandidate,
): AssistantRuntimeBundle {
  const nextItem: AssistantBundleItem = {
    id: candidate.id,
    label: candidate.label,
    origin: candidate.origin,
    sourcePath: candidate.sourcePath,
  };
  const custom = new Map(bundle.custom.map((item) => [item.id, item]));
  custom.set(nextItem.id, nextItem);
  return {
    disabled: bundle.disabled.filter((id) => id !== nextItem.id),
    custom: [...custom.values()],
  };
}

export function removeSkillMount(
  bundle: AssistantRuntimeBundle,
  skillId: string,
): AssistantRuntimeBundle {
  return {
    disabled: bundle.disabled.filter((id) => id !== skillId),
    custom: bundle.custom.filter((item) => item.id !== skillId),
  };
}

export function filterSkillMountCandidates(
  candidates: SkillMountCandidate[],
  query: string,
): SkillMountCandidate[] {
  const q = query.trim().toLowerCase();
  if (!q) return candidates;
  return candidates.filter((candidate) => {
    return (
      candidate.label.toLowerCase().includes(q) ||
      candidate.id.toLowerCase().includes(q) ||
      candidate.sourcePath.toLowerCase().includes(q)
    );
  });
}

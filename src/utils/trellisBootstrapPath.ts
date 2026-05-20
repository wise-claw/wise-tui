import type { ProjectItem, Repository } from "../types";
import { resolveProjectMainSessionAnchor } from "./projectSessionAnchor";
import { resolveWorkspaceMode } from "./workspaceMode";

export type TrellisBootstrapScope = "project" | "repository";

/**
 * Resolve the directory where `trellis init` should run.
 *
 * - `repository`: always the repo root (single-repo / standalone Trellis).
 * - `project`: multi-repo workspace → `project.rootPath` (or derived project anchor);
 *   single-repo workspace → member repo path (same as main session anchor).
 */
export function resolveTrellisBootstrapPath(input: {
  scope: TrellisBootstrapScope;
  project?: ProjectItem | null;
  repository?: Repository | null;
  repositories: ReadonlyArray<Repository>;
  projects?: ReadonlyArray<ProjectItem>;
}): string | null {
  const { scope, project, repository, repositories, projects = [] } = input;

  if (scope === "repository") {
    return repository?.path?.trim() || null;
  }

  if (!project) return null;

  const mode = resolveWorkspaceMode({
    activeProjectId: project.id,
    projects: projects.length > 0 ? projects : [project],
  });

  if (mode === "single_repo") {
    if (repository?.path?.trim() && project.repositoryIds.includes(repository.id)) {
      return repository.path.trim();
    }
    const anchor = resolveProjectMainSessionAnchor(project, repositories);
    return anchor.path.trim() || null;
  }

  const configuredRoot = project.rootPath?.trim();
  if (configuredRoot) return configuredRoot;

  const anchor = resolveProjectMainSessionAnchor(project, repositories);
  return anchor.isProjectRooted ? anchor.path.trim() || null : null;
}

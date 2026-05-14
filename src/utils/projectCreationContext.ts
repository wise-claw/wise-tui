import type { ProjectItem, Repository } from "../types";

export interface ProjectCreationSeedInput {
  activeRepositoryId: number | null;
  projects: ReadonlyArray<ProjectItem>;
  repositories: ReadonlyArray<Repository>;
}

/**
 * Resolve the optional repository that should seed a newly-created project.
 *
 * A selected floating repository is strong path context: creating a project from
 * that state should promote the repo, attach it, and derive `rootPath` from its
 * Trellis root when available. Repositories already owned by a project are not
 * reused because that would silently create cross-project membership.
 */
export function resolveProjectCreationSeedRepository(
  input: ProjectCreationSeedInput,
): Repository | null {
  const { activeRepositoryId, projects, repositories } = input;
  if (activeRepositoryId == null) return null;
  const repository = repositories.find((repo) => repo.id === activeRepositoryId) ?? null;
  if (!repository) return null;
  const owner = projects.find((project) => project.repositoryIds.includes(repository.id));
  return owner ? null : repository;
}

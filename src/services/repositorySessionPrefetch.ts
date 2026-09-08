/** 仅预读仓库会话，不切换焦点、不创建会话。 */
const listeners = new Set<(repositoryPath: string) => void>();

export function prefetchRepositorySession(repositoryPath: string): void {
  const path = repositoryPath.trim();
  if (!path) return;
  for (const listener of listeners) listener(path);
}

export function subscribeRepositorySessionPrefetch(listener: (repositoryPath: string) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

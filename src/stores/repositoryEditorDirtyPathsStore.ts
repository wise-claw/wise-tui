type Listener = () => void;

const dirtyPathsByRepository = new Map<string, ReadonlySet<string>>();
const dirtyDirsByRepository = new Map<string, ReadonlySet<string>>();
const generationByRepository = new Map<string, number>();
const listenersByRepository = new Map<string, Set<Listener>>();

function normalizeRepositoryPath(path: string): string {
  return path.trim();
}

function setsEqual(left: ReadonlySet<string> | undefined, right: ReadonlySet<string>): boolean {
  if (!left) return right.size === 0;
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function addAncestorDirs(set: Set<string>, filePath: string): void {
  let slash = filePath.lastIndexOf("/");
  while (slash > 0) {
    set.add(filePath.slice(0, slash));
    slash = filePath.lastIndexOf("/", slash - 1);
  }
}

function publish(repositoryPath: string): void {
  const listeners = listenersByRepository.get(repositoryPath);
  if (!listeners) return;
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* ignore subscriber errors */
    }
  }
}

export function setRepositoryEditorDirtyPaths(
  repositoryPath: string,
  paths: ReadonlySet<string>,
): void {
  const key = normalizeRepositoryPath(repositoryPath);
  if (!key) return;
  const prev = dirtyPathsByRepository.get(key);
  if (setsEqual(prev, paths)) return;
  dirtyPathsByRepository.set(key, new Set(paths));
  const dirtyDirs = new Set<string>();
  for (const filePath of paths) {
    addAncestorDirs(dirtyDirs, filePath);
  }
  dirtyDirsByRepository.set(key, dirtyDirs);
  generationByRepository.set(key, (generationByRepository.get(key) ?? 0) + 1);
  publish(key);
}

export function subscribeRepositoryEditorDirtyPaths(
  repositoryPath: string,
  listener: Listener,
): () => void {
  const key = normalizeRepositoryPath(repositoryPath);
  if (!key) return () => {};
  let set = listenersByRepository.get(key);
  if (!set) {
    set = new Set();
    listenersByRepository.set(key, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
    if (set && set.size === 0) {
      listenersByRepository.delete(key);
    }
  };
}

export function getRepositoryEditorDirtyPathsSnapshot(repositoryPath: string): ReadonlySet<string> {
  const key = normalizeRepositoryPath(repositoryPath);
  if (!key) return new Set();
  return dirtyPathsByRepository.get(key) ?? new Set();
}

export function getRepositoryEditorDirtyPathsGeneration(repositoryPath: string): number {
  const key = normalizeRepositoryPath(repositoryPath);
  if (!key) return 0;
  return generationByRepository.get(key) ?? 0;
}

export function getRepositoryEditorDirtyDirsSnapshot(repositoryPath: string): ReadonlySet<string> {
  const key = normalizeRepositoryPath(repositoryPath);
  if (!key) return new Set();
  return dirtyDirsByRepository.get(key) ?? new Set();
}

/** @internal test helper */
export function resetRepositoryEditorDirtyPathsStoreForTests(): void {
  dirtyPathsByRepository.clear();
  dirtyDirsByRepository.clear();
  generationByRepository.clear();
  listenersByRepository.clear();
}

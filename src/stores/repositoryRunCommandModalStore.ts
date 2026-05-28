export type RepositoryRunCommandModalTarget = {
  repositoryId: number;
  repositoryPath: string;
};

type Snapshot = {
  open: boolean;
  target: RepositoryRunCommandModalTarget | null;
};

type Listener = () => void;

let open = false;
let target: RepositoryRunCommandModalTarget | null = null;
let snapshot: Snapshot = { open, target };
const listeners = new Set<Listener>();

function publish(): void {
  snapshot = { open, target };
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* ignore subscriber errors */
    }
  }
}

export function subscribeRepositoryRunCommandModal(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getRepositoryRunCommandModalSnapshot(): Snapshot {
  return snapshot;
}

export function openRepositoryRunCommandModal(next: RepositoryRunCommandModalTarget): void {
  open = true;
  target = next;
  publish();
}

export function closeRepositoryRunCommandModal(): void {
  open = false;
  publish();
}

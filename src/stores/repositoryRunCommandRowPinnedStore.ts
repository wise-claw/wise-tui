import {
  loadRepositoryRunCommandRowPinnedMap,
  type RepositoryRunCommandRowPinnedMap,
  WISE_REPOSITORY_RUN_COMMAND_ROW_PINNED_CHANGED,
} from "../services/repositoryRunCommandRowActionPreference";

type Listener = () => void;

let snapshot: RepositoryRunCommandRowPinnedMap = {};
let loadStarted = false;
let eventHookAttached = false;
const listeners = new Set<Listener>();

function publish(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* ignore subscriber errors */
    }
  }
}

function onPinnedMapChanged(event: Event): void {
  const next = (event as CustomEvent<{ map?: RepositoryRunCommandRowPinnedMap }>).detail?.map;
  if (!next || typeof next !== "object") return;
  snapshot = next;
  publish();
}

function ensureLoaded(): void {
  if (!loadStarted) {
    loadStarted = true;
    void loadRepositoryRunCommandRowPinnedMap().then((map) => {
      snapshot = map;
      publish();
    });
  }
  if (!eventHookAttached && typeof window !== "undefined") {
    eventHookAttached = true;
    window.addEventListener(WISE_REPOSITORY_RUN_COMMAND_ROW_PINNED_CHANGED, onPinnedMapChanged);
  }
}

export function subscribeRepositoryRunCommandRowPinnedMap(listener: Listener): () => void {
  ensureLoaded();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getRepositoryRunCommandRowPinnedMapSnapshot(): RepositoryRunCommandRowPinnedMap {
  ensureLoaded();
  return snapshot;
}

/** @internal test helper */
export function resetRepositoryRunCommandRowPinnedStoreForTests(): void {
  snapshot = {};
  loadStarted = false;
  listeners.clear();
  if (eventHookAttached && typeof window !== "undefined") {
    window.removeEventListener(WISE_REPOSITORY_RUN_COMMAND_ROW_PINNED_CHANGED, onPinnedMapChanged);
    eventHookAttached = false;
  }
}

/** @internal test helper */
export function setRepositoryRunCommandRowPinnedMapSnapshotForTests(
  map: RepositoryRunCommandRowPinnedMap,
): void {
  snapshot = map;
  loadStarted = true;
  publish();
}

import { setAppSetting } from "./appSettingsStore";

type MultiPanePersistGate = {
  chain: Promise<void> | null;
  pending: string | null;
  generation: number;
  writeCount: number;
};

const gates = new Map<string, MultiPanePersistGate>();

function getGate(storageKey: string): MultiPanePersistGate {
  let gate = gates.get(storageKey);
  if (!gate) {
    gate = { chain: null, pending: null, generation: 0, writeCount: 0 };
    gates.set(storageKey, gate);
  }
  return gate;
}

async function writeMultiPaneLayout(storageKey: string, json: string): Promise<void> {
  try {
    await setAppSetting(storageKey, json);
  } catch {
    /* ignore */
  }
}

async function drainMultiPanePersist(storageKey: string, gate: MultiPanePersistGate): Promise<void> {
  while (gate.pending) {
    const toWrite = gate.pending;
    gate.pending = null;
    await writeMultiPaneLayout(storageKey, toWrite);
    gate.writeCount += 1;
  }
}

/**
 * 串行合并写入多屏布局：paneCount / extraPanes 高频变化时只落最新快照。
 */
export function persistMultiPaneLayoutState(storageKey: string, payloadJson: string): Promise<void> {
  const key = storageKey.trim();
  if (!key) return Promise.resolve();
  const gate = getGate(key);
  gate.pending = payloadJson;
  gate.generation += 1;
  if (!gate.chain) {
    gate.chain = drainMultiPanePersist(key, gate).finally(() => {
      gate.chain = null;
      if (gate.pending != null) {
        void persistMultiPaneLayoutState(key, gate.pending);
      }
    });
  }
  return gate.chain;
}

/** @internal test helper */
export function resetMultiPaneLayoutPersistForTests(): void {
  gates.clear();
}

/** @internal test helper */
export function getMultiPaneLayoutPersistStatsForTests(storageKey: string): {
  generation: number;
  writeCount: number;
  hasPending: boolean;
  inFlight: boolean;
} {
  const gate = getGate(storageKey);
  return {
    generation: gate.generation,
    writeCount: gate.writeCount,
    hasPending: gate.pending != null,
    inFlight: gate.chain != null,
  };
}

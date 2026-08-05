import { setAppSetting } from "./appSettingsStore";
import { REPOSITORY_MAIN_SESSION_BINDING_STORAGE_KEY } from "../utils/repositoryMainSessionBinding";

type BindingsPersistGate = {
  chain: Promise<void> | null;
  pending: Record<string, string> | null;
  generation: number;
  writeCount: number;
};

const gate: BindingsPersistGate = {
  chain: null,
  pending: null,
  generation: 0,
  writeCount: 0,
};

async function writeBindings(bindings: Record<string, string>): Promise<void> {
  try {
    await setAppSetting(REPOSITORY_MAIN_SESSION_BINDING_STORAGE_KEY, JSON.stringify(bindings));
  } catch {
    /* ignore */
  }
}

async function drainBindingsPersist(): Promise<void> {
  while (gate.pending) {
    const toWrite = gate.pending;
    gate.pending = null;
    await writeBindings(toWrite);
    gate.writeCount += 1;
  }
}

/**
 * 串行合并写入仓库主会话绑定：并发 bind/close/migrate 时只落最新快照，避免旧写盖新写。
 */
export function persistRepositoryMainSessionBindings(
  bindings: Record<string, string>,
): Promise<void> {
  gate.pending = bindings;
  gate.generation += 1;
  if (!gate.chain) {
    gate.chain = drainBindingsPersist().finally(() => {
      gate.chain = null;
      if (gate.pending != null) {
        void persistRepositoryMainSessionBindings(gate.pending);
      }
    });
  }
  return gate.chain;
}

/** @internal test helper */
export function resetRepositoryMainSessionBindingsPersistForTests(): void {
  gate.chain = null;
  gate.pending = null;
  gate.generation = 0;
  gate.writeCount = 0;
}

/** @internal test helper */
export function getRepositoryMainSessionBindingsPersistStatsForTests(): {
  generation: number;
  writeCount: number;
  hasPending: boolean;
  inFlight: boolean;
} {
  return {
    generation: gate.generation,
    writeCount: gate.writeCount,
    hasPending: gate.pending != null,
    inFlight: gate.chain != null,
  };
}

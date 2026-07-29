/**
 * 会话「当前轮次」的权威状态。
 *
 * 为什么不直接读 `session.status`
 * --------------------------------
 * `executeSession` 派发时同步把状态提交成 running，但 React 重渲染是异步的：
 * 待执行队列在 `onExecute` resolve 后的微任务里读到的 `session.status` 仍是 idle，
 * 于是把整条 main 车道一次性派完。历史上这靠 `mainLaneDispatchGate` + 5s TTL +
 * 每秒轮询兜底来遮盖，本质是「用渲染态推断执行态」。
 *
 * 本 store 把轮次生命周期变成显式事实：派发方在真正提交前同步 `beginSessionTurn`，
 * 未派发 / 失败 / 取消时同步 `endSessionTurn`，正常结束由状态观察推进。
 * 读取走 ref 语义（模块级变量），不受重渲染时序影响，因此不需要任何定时器兜底。
 */

type Listener = () => void;

export interface ActiveSessionTurn {
  tabSessionId: string;
  turnId: number;
  startedAt: number;
  /**
   * 是否已观察到会话进入 running/connecting。
   *
   * 区分两种「当前状态不是 active」：派发后状态尚未渲染（不能结束轮次），
   * 与本轮确已跑完（应结束轮次）。
   */
  observedActive: boolean;
}

const turnsByTabSessionId = new Map<string, ActiveSessionTurn>();
const listeners = new Set<Listener>();
let turnSerial = 0;
let snapshot: ReadonlySet<string> = new Set();

function publish(): void {
  snapshot = new Set(turnsByTabSessionId.keys());
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* ignore subscriber errors */
    }
  }
}

/** 登记一轮派发；必须在派发方提交 running 之前同步调用。返回轮次令牌。 */
export function beginSessionTurn(tabSessionId: string, now: number = Date.now()): number {
  const id = tabSessionId.trim();
  if (!id) return 0;
  turnSerial += 1;
  // latest-wins：上一轮若因异常未注销，新派发不应被它永久阻塞。
  turnsByTabSessionId.set(id, {
    tabSessionId: id,
    turnId: turnSerial,
    startedAt: now,
    observedActive: false,
  });
  publish();
  return turnSerial;
}

/**
 * 注销轮次。传 `turnId` 时仅注销匹配的那一轮，避免迟到的旧轮回调误杀新轮次。
 *
 * @returns 是否确实注销了一条记录。
 */
export function endSessionTurn(tabSessionId: string, turnId?: number): boolean {
  const id = tabSessionId.trim();
  if (!id) return false;
  const current = turnsByTabSessionId.get(id);
  if (!current) return false;
  if (turnId !== undefined && current.turnId !== turnId) return false;
  turnsByTabSessionId.delete(id);
  publish();
  return true;
}

/**
 * 用会话状态推进轮次：首次观察到 active 记录下来，之后再观察到非 active 即判定本轮结束。
 *
 * 只有「观察到过 active」的轮次才会被非 active 结束，这样派发后状态尚未渲染的窗口
 * 不会被误判成已结束。
 */
export function observeSessionTurnStatus(tabSessionId: string, active: boolean): void {
  const id = tabSessionId.trim();
  if (!id) return;
  const current = turnsByTabSessionId.get(id);
  if (!current) return;
  if (active) {
    if (current.observedActive) return;
    turnsByTabSessionId.set(id, { ...current, observedActive: true });
    return;
  }
  if (!current.observedActive) return;
  turnsByTabSessionId.delete(id);
  publish();
}

export function hasActiveSessionTurn(tabSessionId: string): boolean {
  const id = tabSessionId.trim();
  return id ? turnsByTabSessionId.has(id) : false;
}

export function peekSessionTurn(tabSessionId: string): ActiveSessionTurn | null {
  return turnsByTabSessionId.get(tabSessionId.trim()) ?? null;
}

/** 关闭标签 / 磁盘裁剪后清理孤儿轮次，避免 Map 只增不减。 */
export function pruneSessionTurns(liveTabSessionIds: ReadonlySet<string>): boolean {
  let changed = false;
  for (const id of [...turnsByTabSessionId.keys()]) {
    if (liveTabSessionIds.has(id)) continue;
    turnsByTabSessionId.delete(id);
    changed = true;
  }
  if (changed) publish();
  return changed;
}

export function getActiveSessionTurnIdsSnapshot(): ReadonlySet<string> {
  return snapshot;
}

export function subscribeSessionTurns(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** @internal test helper */
export function resetSessionTurnStoreForTests(): void {
  turnsByTabSessionId.clear();
  listeners.clear();
  turnSerial = 0;
  snapshot = new Set();
}

import { describe, expect, test } from "bun:test";
import { clearCompletedSessionRecords, getExecutedSessionIds, publishClaudeSessions } from "../../stores/claudeSessionsLiveStore";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClaudeSession } from "../../types";
import { groupOpenedSessions, nextRunningSession, sessionSwitchShortcut, WorkspaceSessionSwitcher } from "./WorkspaceSessionSwitcher";

const session = (id: string, status: ClaudeSession['status'], extra: Partial<ClaudeSession> = {}): ClaudeSession => ({
  id, status, claudeSessionId: `claude-${id}`, repositoryName: 'wise', repositoryPath: '/wise', model: '', messages: [], createdAt: 0, pendingPrompt: '', ...extra,
});

describe('opened session switcher', () => {
  test('counts only completions executed since app opened, excluding restored history', () => {
    const items = [session('run', 'running'), session('connect', 'connecting'), session('done', 'completed'), session('resident', 'idle', { messages: [{ id: 1, role: 'assistant', content: 'done', parts: [], timestamp: 1 }] }), session('history', 'completed'), session('historical-idle', 'idle', { messages: [{ id: 2, role: 'assistant', content: 'old', parts: [], timestamp: 0 }] }), session('empty', 'idle'), session('error', 'error'), session('cancelled', 'cancelled'), session('side', 'running', { isSide: true })];
    const grouped = groupOpenedSessions(items, new Set(['done', 'resident', 'error', 'cancelled']));
    expect(grouped.running.map(s => s.id)).toEqual(['run', 'connect']);
    expect(grouped.completed.map(s => s.id)).toEqual(['done', 'resident']);
  });
  test('cycles both ways, resolves engine IDs and starts from another workspace', () => {
    const items = [session('a', 'running'), session('b', 'running'), session('c', 'running')];
    expect(nextRunningSession(items, 'c', 1)?.id).toBe('a');
    expect(nextRunningSession(items, 'a', -1)?.id).toBe('c');
    expect(nextRunningSession(items, 'claude-b', 1)?.id).toBe('c');
    expect(nextRunningSession(items, 'other', 1)?.id).toBe('a');
    expect(nextRunningSession(items, 'other', -1)?.id).toBe('c');
    expect(nextRunningSession([], null, 1)).toBeUndefined();
  });
  test('clears individual and all completed records, protects running sessions and preserves transcripts', () => {
    const a = session('clear-a', 'running');
    const b = session('clear-b', 'running');
    const c = session('clear-c', 'running');
    publishClaudeSessions([a, b, c]);
    const doneA = { ...a, status: 'completed' as const };
    const doneB = { ...b, status: 'idle' as const };
    publishClaudeSessions([doneA, doneB, c]);
    clearCompletedSessionRecords([a.id, c.id]);
    expect(groupOpenedSessions([doneA, doneB, c], getExecutedSessionIds()).completed.map(s => s.id)).toEqual([b.id]);
    expect(getExecutedSessionIds().has(c.id)).toBe(true);
    publishClaudeSessions([doneA, doneB, c]);
    expect(getExecutedSessionIds().has(a.id)).toBe(false);
    clearCompletedSessionRecords([a.id, b.id]);
    expect(groupOpenedSessions([doneA, doneB, c], getExecutedSessionIds()).completed).toEqual([]);
    expect(doneA.claudeSessionId).toBe(a.claudeSessionId);
    publishClaudeSessions([a, doneB, c]);
    publishClaudeSessions([doneA, doneB, c]);
    expect(groupOpenedSessions([doneA, doneB, c], getExecutedSessionIds()).completed.map(s => s.id)).toEqual([a.id]);
  });
  test('uses separate shortcuts for running and completed sessions and skips unrelated keys', () => {
    const key = { key: 'ArrowDown', altKey: true, shiftKey: false, ctrlKey: false, metaKey: false, defaultPrevented: false, isComposing: false };
    expect(sessionSwitchShortcut(key)).toEqual({ group: 'running', direction: 1 });
    expect(sessionSwitchShortcut({ ...key, shiftKey: true, key: 'ArrowUp' })).toEqual({ group: 'completed', direction: -1 });
    const items = [session('done-a', 'completed'), session('done-b', 'idle')];
    expect(nextRunningSession(items, 'claude-done-a', 1)?.id).toBe('done-b');
    expect(nextRunningSession(items, 'done-b', 1)?.id).toBe('done-a');
    for (const override of [{ altKey: false }, { ctrlKey: true }, { metaKey: true }, { defaultPrevented: true }, { isComposing: true }, { key: 'ArrowLeft' }]) {
      expect(sessionSwitchShortcut({ ...key, ...override })).toBeNull();
    }
  });
  test('shows accessible counts including zero', () => {
    const html = renderToStaticMarkup(<WorkspaceSessionSwitcher sessions={[session('run', 'running')]} activeSessionId={null} />);
    expect(html).toContain('运行中 1，打开运行中会话列表');
    expect(html).toContain('已完成 0，打开已完成会话列表');
    expect(html).toContain('aria-expanded="false"');
  });
});

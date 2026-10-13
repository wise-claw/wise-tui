import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClaudeSession } from "../../types";
import { groupOpenedSessions, nextRunningSession, WorkspaceSessionSwitcher } from "./WorkspaceSessionSwitcher";

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
  test('shows accessible counts including zero', () => {
    const html = renderToStaticMarkup(<WorkspaceSessionSwitcher sessions={[session('run', 'running')]} activeSessionId={null} />);
    expect(html).toContain('运行中 1，已完成 0，打开会话列表');
    expect(html).toContain('aria-expanded="false"');
  });
});

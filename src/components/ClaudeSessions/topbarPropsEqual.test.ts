import { expect, test } from "bun:test";
import type { ClaudeSession } from "../../types";
import type { TopbarProps } from "./Topbar";
import { topbarPropsEqual } from "./topbarPropsEqual";

const session = (id: string): ClaudeSession => ({
  id, claudeSessionId: null, repositoryPath: '/wise', repositoryName: 'wise', model: '', status: 'idle', messages: [], createdAt: 0, pendingPrompt: '',
});
const props = (target: ClaudeSession | null): TopbarProps => ({ mainSessionForDataLink: target } as TopbarProps);

test('global topbar updates analysis when a selected session becomes available', () => {
  expect(topbarPropsEqual(props(null), props(session('selected')))).toBe(false);
});
test('switching sessions in the same repository updates analysis target', () => {
  expect(topbarPropsEqual(props(session('first')), props(session('second')))).toBe(false);
});

test('session title changes refresh the primary topbar', () => {
  const before = session('selected');
  expect(topbarPropsEqual(props(before), props({ ...before, threadName: '新标题' }))).toBe(false);
  expect(topbarPropsEqual(props(before), props({ ...before, diskPreview: '首条消息' }))).toBe(false);
});

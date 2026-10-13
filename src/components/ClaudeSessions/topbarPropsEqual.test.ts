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

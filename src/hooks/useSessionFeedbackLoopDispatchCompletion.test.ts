import { expect, test } from 'bun:test';
import type { ClaudeSession } from '../types';
import { resolveFeedbackWorkerCompletion } from './useSessionFeedbackLoopDispatchCompletion';
const worker = (status: ClaudeSession['status'], responseAt?: number): ClaudeSession => ({ id: 'worker', claudeSessionId: null, status, repositoryPath: '/repo', repositoryName: 'repo', model: '', createdAt: 0, pendingPrompt: '', messages: responseAt == null ? [] : [{ id: 1, role: 'assistant', content: 'result', parts: [{ type: 'text', text: 'result' }], timestamp: responseAt }] });
test('registration of an idle worker is not mistaken for completion', () => {
  expect(resolveFeedbackWorkerCompletion(worker('idle'), 100)).toBeNull();
  expect(resolveFeedbackWorkerCompletion(worker('idle', 99), 100)).toBeNull();
  expect(resolveFeedbackWorkerCompletion(worker('idle', 101), 100)).toBe('completed');
});
test('handles oneshot completion, cancellation, error and empty results', () => {
  expect(resolveFeedbackWorkerCompletion(worker('completed', 101), 100)).toBe('completed');
  expect(resolveFeedbackWorkerCompletion(worker('completed'), 100)).toBe('failed');
  expect(resolveFeedbackWorkerCompletion(worker('cancelled'), 100)).toBe('failed');
  expect(resolveFeedbackWorkerCompletion(worker('error'), 100)).toBe('failed');
  expect(resolveFeedbackWorkerCompletion(worker('running', 101), 100)).toBeNull();
});

test('completion emits once and terminal failures update dispatch history', async () => {
  const { registerSessionFeedbackLoopDispatch, getSessionFeedbackLoopDispatchesSnapshotForAnchor } = await import('../stores/sessionFeedbackLoopDispatchStore');
  const { syncFeedbackLoopDispatchFromSessions } = await import('./useSessionFeedbackLoopDispatchCompletion');
  const anchor = 'completion-regression';
  const register = (dispatchId: string, workerSessionId: string) => registerSessionFeedbackLoopDispatch({ dispatchId, workerSessionId, anchorSessionId: anchor, repositoryPath: '/repo', kind: 'optimization', previewText: '', createdAt: 100 });
  register('completion-one', 'worker');
  let completions = 0;
  syncFeedbackLoopDispatchFromSessions([worker('idle')], () => completions++);
  expect(getSessionFeedbackLoopDispatchesSnapshotForAnchor(anchor)[0]?.status).toBe('running');
  syncFeedbackLoopDispatchFromSessions([worker('completed', 101)], () => completions++);
  syncFeedbackLoopDispatchFromSessions([worker('completed', 101)], () => completions++);
  expect(completions).toBe(1);
  register('completion-cancel', 'cancel-worker');
  syncFeedbackLoopDispatchFromSessions([{ ...worker('cancelled'), id: 'cancel-worker' }]);
  expect(getSessionFeedbackLoopDispatchesSnapshotForAnchor(anchor)[0]?.status).toBe('failed');
});

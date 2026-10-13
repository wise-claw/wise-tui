import { expect, test } from 'bun:test';
import { act, create } from 'react-test-renderer';
import type { ClaudeSession } from '../types';
import { useSessionAnalysisTranscript } from './useSessionAnalysisTranscript';

const session = (id: string): ClaudeSession => ({ id, claudeSessionId: null, executionEngine: 'codex-rpc', repositoryPath: '/repo', repositoryName: 'repo', status: 'idle', model: '', messages: [], createdAt: 0, pendingPrompt: '' });

test('switching sessions discards a late transcript and retry recovers a failed load', async () => {
  const pending: Array<{ resolve: (lines: string[]) => void; reject: (error: Error) => void }> = [];
  const load = () => new Promise<string[]>((resolve, reject) => pending.push({ resolve, reject }));
  let api!: ReturnType<typeof useSessionAnalysisTranscript>;
  function Probe({ target }: { target: ClaudeSession | null }) {
    api = useSessionAnalysisTranscript(target, true, load);
    return null;
  }
  let renderer!: ReturnType<typeof create>;
  await act(async () => { renderer = create(<Probe target={session('a')} />); });
  expect(api.loading).toBe(true);
  await act(async () => { renderer.update(<Probe target={session('b')} />); });
  await act(async () => { pending[0]!.resolve(['stale a']); });
  expect(api.lines).toBeNull();
  await act(async () => { pending[1]!.reject(new Error('disk unavailable')); });
  expect(api.loading).toBe(false);
  expect(api.error).toBe('disk unavailable');
  await act(async () => { api.refresh(); });
  await act(async () => { pending[2]!.resolve(['current b']); });
  expect(api.lines).toEqual(['current b']);
  expect(api.error).toBeNull();
  await act(async () => { renderer.update(<Probe target={null} />); });
  expect(api.lines).toBeNull();
  expect(api.loading).toBe(false);
  await act(async () => { renderer.unmount(); });
});

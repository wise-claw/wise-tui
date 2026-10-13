import { expect, test } from "bun:test";
import type { ClaudeSession } from "../types";
import { sessionAnalysisTranscriptTarget } from "./sessionAnalysisTranscript";
const session = (executionEngine: ClaudeSession['executionEngine'], claudeSessionId: string | null = 'engine-id'): ClaudeSession => ({ id: 'wise-tab', claudeSessionId, executionEngine, repositoryPath: '/repo', repositoryName: 'repo', status: 'idle', model: '', createdAt: 0, pendingPrompt: '', messages: [] });
test('Claude analysis uses protocol session ID', () => {
  expect(sessionAnalysisTranscriptTarget(session('claude-code'))).toEqual({ source: 'claude', key: 'engine-id', repositoryPath: '/repo' });
});
test('Codex RPC and Cursor analysis use Wise tab ID even before protocol ID exists', () => {
  expect(sessionAnalysisTranscriptTarget(session('codex-rpc', null))?.key).toBe('wise-tab');
  expect(sessionAnalysisTranscriptTarget(session('codex-rpc', null))?.source).toBe('codex_rpc');
  expect(sessionAnalysisTranscriptTarget(session('cursor', null))?.source).toBe('cursor');
});
test('unbound Claude sessions use memory without attempting a disk load', () => {
  expect(sessionAnalysisTranscriptTarget(session('claude-code', null))).toBeNull();
  expect(sessionAnalysisTranscriptTarget(null)).toBeNull();
});

test('trace window includes early messages after sidebar activity bumps createdAt', async () => {
  const { sessionAnalysisTraceSinceMs } = await import('./sessionAnalysisTranscript');
  expect(sessionAnalysisTraceSinceMs({ ...session('codex-rpc'), createdAt: 900000, messages: [{ id: 1, role: 'user', content: 'first', parts: [], timestamp: 100000 }] })).toBe(40000);
  expect(sessionAnalysisTraceSinceMs(null)).toBeUndefined();
});

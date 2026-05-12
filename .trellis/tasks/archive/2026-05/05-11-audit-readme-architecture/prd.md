# PRD: Rewrite README to Match Actual Wise Architecture

## Problem

`README.md` and parts of `CLAUDE.md` still describe Wise as a basic Tauri desktop shell. The actual project is a Claude Code orchestration desktop client with repository/project management, sessions, workflow graphs, PRD splitting, terminal support, notifications, SQLite persistence, and multi-window Tauri behavior.

Documentation drift makes onboarding and future agent work less reliable.

## Scope

Rewrite `README.md` so it includes:

- What Wise actually does.
- Current feature matrix.
- Architecture overview for React, services, Tauri commands, SQLite, and windows.
- Data storage locations such as `~/.wise/wise.db`.
- Verification commands that match `package.json`.
- A concise architecture diagram in Mermaid or text.
- Notes about Tauri dev/build commands without contradicting project agent rules.

Optionally update the stale parts of `CLAUDE.md` only if the README would otherwise contradict project-local agent guidance.

## Acceptance Criteria

- README no longer says Wise is only a desktop shell.
- Commands match actual `package.json` scripts.
- The document mentions Bun as the package manager and `bun test` as the test runner.
- The architecture section matches existing code paths.
- No false `src/pages/` routing convention is introduced.
- Documentation remains concise enough to be useful as a project entry point.

## Non-Goals

- Do not write marketing copy.
- Do not document future features as current features.
- Do not change application code in this task.

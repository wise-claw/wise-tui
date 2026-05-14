# Commit Hygiene

> How to keep Wise changes reviewable across Trellis, docs, frontend, and Tauri work.

---

## Principles

- Keep one commit focused on one task, layer, or behavior boundary.
- Use English Conventional Commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, or `chore:`.
- Do not include unrelated dirty worktree changes.
- Do not rewrite existing history unless the user explicitly asks for it.
- Commit messages should describe the change, not the implementation attempt.

---

## Boundaries

Use separate commits when changes are independently reviewable:

- Trellis task/spec updates.
- Documentation-only changes.
- Frontend logic or tests.
- Tauri/Rust logic or tests.
- Package manager or lockfile policy changes.

Small cross-layer changes may share a commit only when the frontend and backend parts are one contract change and cannot be reviewed separately.

---

## Trellis Handoff

- Trellis-only planning changes can be committed as `chore: plan ...` or `docs: update ...`.
- App-code changes should be committed by behavior, with related tests in the same commit.
- Keep task status and validation artifacts aligned with actual verification.
- Do not mark a task complete until its acceptance criteria have evidence.

---

## Review Checklist

Before committing:

- `git status --short` contains only files that belong to the commit.
- In a parallel dirty worktree, use pathspec-limited `git diff`, `git add`, and verification notes. If a global check fails only in unrelated paths, record the blocking paths and keep the commit scoped to the touched files.
- Generated files are expected and reproducible.
- Required tests/checks for the touched layer passed or are documented as blocked.
- Documentation and specs match the behavior implemented.

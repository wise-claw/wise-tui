# PRD: Define Commit Hygiene and Trellis Handoff Workflow

## Problem

The audit table noted that recent work has very few commits relative to the amount of change. Large mixed commits make review, rollback, and Trellis handoff harder, especially when platform scaffolding, specs, documentation, and app code move together.

## Scope

- Define a local commit hygiene policy for this repository.
- Capture when to split commits by task, layer, or behavioral boundary.
- Document how Trellis tasks should be committed and handed off.
- Decide whether the policy belongs in `AGENTS.md`, `.trellis/spec/guides/`, or a small project doc.
- Keep commit messages in English, matching project instruction.

## Acceptance Criteria

- The repository contains a clear policy for reviewable commits.
- The policy states that unrelated dirty worktree changes must not be included.
- The policy explains how to commit Trellis-only changes versus app-code changes.
- The policy avoids time estimates and permission-asking language.
- No app behavior changes are made in this task.

## Non-Goals

- Do not rewrite git history.
- Do not squash or split existing commits unless explicitly requested.
- Do not add external tooling unless a simple documented workflow is insufficient.

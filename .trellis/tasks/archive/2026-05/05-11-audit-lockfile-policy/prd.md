# PRD: Fix Package Lockfile Tracking Policy

## Problem

The audit finding said `package-lock.json` appeared in the workspace while the project uses Bun. Current inspection shows `bun.lock` is present and no tracked `package-lock.json` is visible, but the repository should still encode the policy so npm lockfiles do not reappear.

## Scope

- Confirm actual lockfiles in the repository and git index.
- Ensure `bun.lock` is tracked and remains the source of truth.
- Add ignore rules for stale npm/yarn/pnpm lockfiles only if they are not intentionally supported.
- Remove any accidental `package-lock.json` from the working tree or index if present.
- Update docs/spec if package-manager policy is unclear.

## Acceptance Criteria

- `git ls-files` shows `bun.lock` tracked.
- No `package-lock.json` is tracked.
- `.gitignore` prevents accidental npm lockfile churn if that is the chosen policy.
- `package.json` `packageManager` remains Bun.
- `bun test` passes if code or lockfile changes occur.

## Non-Goals

- Do not migrate away from Bun.
- Do not update dependencies unless required to repair lockfile consistency.

# PRD: Deduplicate SQLite Migration Registration

## Problem

`src-tauri/src/wise_db.rs` repeats migration constants and application blocks for each migration. The audit finding counted 13 repeated registration blocks. This increases the chance of adding a migration to one place but forgetting another.

## Scope

- Replace the repeated migration application code with an ordered migration registry.
- Preserve the existing migration order and schema behavior.
- Keep the JSON seed migration behavior for `005_platform_split_prompt_seed.json`.
- Add or update tests where practical so migration ordering and registration cannot silently regress.

## Acceptance Criteria

- Adding a new SQL migration requires one obvious registry entry, not a copied block.
- Existing migrations still apply in the same order.
- Existing database version/state behavior is preserved.
- `wise_db.rs` remains readable and does not hide errors.
- Relevant tests pass.

## Non-Goals

- Do not rewrite the whole persistence layer.
- Do not modify already-applied migration files.
- Do not change schema semantics except through a new migration if required.

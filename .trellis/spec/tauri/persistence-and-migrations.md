# Persistence and Migrations

> SQLite, JSON settings, schema migrations, and durable writes.

---

## Persistence Ownership

Durable application state belongs in Rust-managed persistence, not scattered
frontend storage.

Use:

- SQLite in `~/.wise/wise.db` for structured durable state.
- `app_settings` for generic key/value settings.
- Domain tables for projects, workflows, task snapshots, graph data, messages, and mappings.
- Existing JSON files only for legacy or intentionally file-backed state.

Frontend services should expose typed operations over this persistence layer.

---

## SQLite Access

`src-tauri/src/wise_db.rs` owns database opening and migrations. It enables
foreign keys and wraps the connection in managed state.

Rules:

- Use parameterized SQL with `params!`.
- Keep DB errors converted into `Result<T, String>`.
- Keep row DTOs serializable with `#[serde(rename_all = "camelCase")]`.
- Keep transactions explicit when a command updates multiple related tables.
- Preserve foreign key behavior.
- Avoid holding the DB lock while doing unrelated filesystem or process work.

---

## Migrations

Migrations live in `src-tauri/migrations/` and are included from Rust.

Rules:

- Add new migrations with the next numeric prefix.
- Never edit an already-applied migration to change production behavior.
- Keep migrations idempotent where practical.
- Backfill data explicitly when adding non-null or derived columns.
- Update the migration include list and runner in `wise_db.rs`.
- Keep seed data versioned; JSON seed files must have a stable schema.

---

## JSON Settings

JSON stored in `app_settings`, files, or graph/task blobs must be treated as
versioned external data.

- Include a `schemaVersion` when the shape may evolve.
- Validate shape before using it as a typed object.
- Tolerate missing optional fields from older versions.
- Migrate legacy keys after successful import, as `useRepositoryList.ts` does
  for legacy project state.
- Do not persist raw UI drafts unless the product expects recovery.

---

## Atomic Writes

For durable file writes:

- Write to a temporary file in the same directory.
- Flush/write fully before replacing the target.
- Rename into place atomically when possible.
- Create parent directories intentionally.
- Avoid partial writes for files read on startup.

Use existing helpers such as `write_file_atomic` before adding another write path.

---

## Frontend Cache and Local Storage

Do not use `localStorage` for durable application records. It is acceptable only
for UI-only preferences or compatibility with an existing pattern.

If a setting affects repositories, tasks, workflows, Claude sessions, plugins,
or app startup behavior, persist it through a service backed by Rust/SQLite.

---

## Common Mistakes

- Editing old migrations instead of adding a new one.
- Saving stringified JSON without a validation path.
- Reading JSON with a direct type cast and no fallback.
- Updating several related tables without a transaction.
- Holding the SQLite mutex across slow filesystem or process operations.
- Creating a second persistence path for data already represented in `wise.db`.

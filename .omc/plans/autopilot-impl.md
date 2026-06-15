# Plan — Add Qoder and Trae IDE support

See `.omc/autopilot/spec.md` for the full spec.

## Tasks (in order)

### T1 — Frontend constants
**File**: `src/components/OpenAppMenu/constants.ts`

Add two entries to both lists (macOS `MAC_BASE_OPEN_APP_TARGETS` and the
non-mac fallback), placed after IntelliJ:

| id | label | macOS | non-mac |
|----|-------|-------|---------|
| `qoder` | `Qoder` | `kind: "app"`, `appName: "Qoder"` | `kind: "command"`, `command: "qoder"` |
| `trae`  | `Trae`  | `kind: "app"`, `appName: "Trae"`  | `kind: "command"`, `command: "trae"`  |

Final order: `vscode, cursor, codefuse, finder, intellij, qoder, trae, ...terminals`.

### T2 — Icons
**File**: `src/components/OpenAppMenu/openAppIcons.ts`

Add two inline-SVG data URLs (Qoder purple, Trae cyan) and register both
in `ICON_MAP` keyed by `qoder` and `trae`.

### T3 — Rust CLI family detection
**File**: `src-tauri/src/workspace_commands.rs`

Extend:

- `is_vscode_family_cli(cmd)` — add `"qoder"` and `"trae"` to the `matches!` list.
- `app_name_to_vscode_cli(app_name)` — add two `if` branches so the
  friendly name "Qoder" / "Trae" (case-insensitive) maps to `"qoder"` / `"trae"`.

This enables the `-g file:line:col` goto protocol for both IDEs.

### T4 — Tests
**File**: `src/utils/macosOpenAppTargets.test.ts`

- Update the hard-coded id list in the first test to include `qoder` and
  `trae` in the right positions.
- Add a new test asserting that Qoder and Trae are present in
  `mergeMacOpenAppTargets` static fallback.

### T5 — QA
- `bun test` must pass.
- `bunx tsc --noEmit` must pass.
- Do NOT start dev/build/serve (project rule).

### T6 — Commit
`feat: add Qoder and Trae to OpenAppMenu`

## Dependency graph

```
T1 ──┐
T2 ──┼─ T4 ── T5 ── T6
T3 ──┘
```

## Risks & rollback

- **Brand color drift**: SVGs are approximations, matching the
  precedent set by CodeFuse / IntelliJ icons. Acceptable.
- **macOS app name mismatch**: `macos_open_with_named_app` will surface a
  clear error if the user's installed app name differs. Non-mac CLI
  fallback avoids the problem entirely.
- **Reordering surprises**: test pins the exact order so future IDE
  additions are explicit and reviewable.
- **Rollback**: revert the commit; nothing in this plan touches
  cross-cutting abstractions.

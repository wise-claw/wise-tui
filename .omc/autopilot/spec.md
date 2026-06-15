# Spec — Add Qoder and Trae IDE support to the "Open in…" menu

## User intent
The "Open in…" dropdown (toolbar / workspace header) currently lists:
VS Code, Cursor, CodeFuse, Finder, IntelliJ IDEA, 终端, Ghostty, Warp.

The user wants **Qoder** and **Trae** added to that list, with the same
"open the repository folder in the IDE" behavior the existing entries have.

## Context (current architecture)

### Frontend (TypeScript / React)
- `src/types.ts:433` defines `OpenAppTarget`:
  `id, label, kind: "app" | "command" | "finder", appName?, command?, args: string[]`.
- `src/components/OpenAppMenu/constants.ts` defines two static lists:
  - `MAC_BASE_OPEN_APP_TARGETS` — non-terminal IDEs / Finder, used on macOS.
  - `DEFAULT_OPEN_APP_TARGETS` — Windows / Linux fallback (uses `kind: "command"`).
  Terminals are injected dynamically on macOS via `macosOpenAppTargets.ts`.
- `src/components/OpenAppMenu/openAppIcons.ts` exports a `ICON_MAP` keyed by
  OpenAppTarget id, returning an inline-SVG data URL.
- `src/services/openWorkspaceWithPreference.ts` dispatches `kind: "app"` to
  `openWorkspaceIn(... { appName })` and `kind: "command"` to
  `openWorkspaceIn(... { command })`. Both reach the same Tauri command
  `open_workspace_in`.

### Backend (Rust / Tauri)
- `src-tauri/src/workspace_commands.rs:421` — `open_workspace_in` Tauri command.
- `is_vscode_family_cli(cmd)` at line 216 — recognizes `code | cursor | codium`
  (used to enable `仓库根 -g file:line:col` goto).
- `app_name_to_vscode_cli(app_name)` at line 228 — maps friendly names
  (Visual Studio Code, Cursor, VSCodium) to the matching CLI. When the IDE is
  a VS Code family product, the Rust side re-uses the CLI goto protocol
  instead of `open -a`, so file/line/column handoff works.

### Tests
- `src/utils/macosOpenAppTargets.test.ts` — asserts ordering of
  `buildMacOpenAppTargets`. The expected id list is hard-coded and will
  need updating.
- `src/services/macosTerminal.test.ts` — covers `isTerminalOpenAppId` /
  `detectedMacTerminalToOpenTarget` (terminals only).

## Design

Qoder and Trae are both VS Code–family AI IDEs (Electron / VS Code fork),
so they ship a CLI on each platform and accept the same `cli 仓库 -g file:line:col`
protocol. The minimum-friction integration is:

1. **Static OpenAppTarget entries** in `constants.ts`, matching the existing
   pattern (macOS `app` kind, non-mac `command` kind).
2. **Icons** in `openAppIcons.ts` (inline SVG, brand colors).
3. **Rust CLI detection** in `is_vscode_family_cli` and
   `app_name_to_vscode_cli` so file/line/column handoff from
   `openRepositoryFileWithStoredPreference` and
   `openRepositoryEntryInPreferredEditor` works (Qoder/Trae already
   speak the same `-g` syntax).
4. **Tests** to lock ordering and CLI recognition.

### Why not "detect installed like terminals"?
The terminal list is dynamic because users may have many installed and
removing broken ones is easy. IDEs are picked less often and the user's
preference is sticky; the existing list is static. Following precedent
keeps the diff small and avoids adding a Rust detection surface.

## Acceptance criteria

- [ ] Qoder and Trae appear in the "Open in…" dropdown on macOS, Windows,
      and Linux, ordered after the existing IDEs and before the dynamic
      terminal entries (macOS only).
- [ ] Clicking Qoder / Trae opens the repository in that IDE.
- [ ] Opening a file via the composer/Code Graph "open in IDE" with
      Qoder / Trae selected lands on the correct `file:line:col` (the
      VS Code-family CLI goto protocol).
- [ ] `bun test` passes; the `macosOpenAppTargets.test.ts` ordering test
      is updated to include `qoder` and `trae`; a new test covers the
      Rust CLI family mapping (or we extend the FE test to cover it).
- [ ] No existing IDE entry's behavior changes.

## Files to touch

| Path | Change |
|------|--------|
| `src/components/OpenAppMenu/constants.ts` | Add `qoder` and `trae` to `MAC_BASE_OPEN_APP_TARGETS` and the non-mac `DEFAULT_OPEN_APP_TARGETS` list. |
| `src/components/OpenAppMenu/openAppIcons.ts` | Add `QODER_ICON`, `TRAE_ICON`, register in `ICON_MAP`. |
| `src-tauri/src/workspace_commands.rs` | Extend `is_vscode_family_cli` and `app_name_to_vscode_cli` to recognize `qoder` / `trae`. |
| `src/utils/macosOpenAppTargets.test.ts` | Update expected id list to include `qoder` and `trae`. |

## Non-goals (out of scope)

- macOS auto-detection of installed Qoder / Trae apps (not needed; static
  list precedent is the same as Cursor/CodeFuse today).
- New icons that exactly mirror vendor brand guides (we ship a close
  approximation in line with the existing icons).
- Tauri capabilities / asset protocol changes (none required; opening
  external apps is already permitted).
- Code Graph / composer-specific changes (the existing IDE dispatch
  transparently picks up the new entries).

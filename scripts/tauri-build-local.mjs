import { spawnSync } from "node:child_process";

// Local packages keep release optimization and panic unwinding, while allowing
// parallel code generation and reuse after edits. CI uses the release profile.
const result = spawnSync("bun", ["tauri", "build", ...process.argv.slice(2)], {
  env: {
    ...process.env,
    WISE_LOCAL_BUILD: "1",
    CARGO_PROFILE_RELEASE_CODEGEN_UNITS: process.env.CARGO_PROFILE_RELEASE_CODEGEN_UNITS ?? "16",
    CARGO_PROFILE_RELEASE_LTO: process.env.CARGO_PROFILE_RELEASE_LTO ?? "false",
    CARGO_PROFILE_RELEASE_INCREMENTAL: process.env.CARGO_PROFILE_RELEASE_INCREMENTAL ?? "true",
  },
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);

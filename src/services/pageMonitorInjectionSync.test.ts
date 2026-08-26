import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { PAGE_INJECTION_SOURCE } from "../../browser-extensions/wise-page-monitor/inject-vitals.js";

const REPO_ROOT = join(import.meta.dir, "../..");

function extractRustInjectionScript(source: string): string {
  const marker = 'const PAGE_INJECTION_SCRIPT: &str = r###"';
  const start = source.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const from = start + marker.length;
  const end = source.indexOf('"###;', from);
  expect(end).toBeGreaterThan(from);
  return source.slice(from, end);
}

describe("page monitor injection script sync", () => {
  test("Rust PAGE_INJECTION_SCRIPT matches extension inject-vitals.js", () => {
    const rust = readFileSync(
      join(REPO_ROOT, "src-tauri/src/chrome_devtools_monitor.rs"),
      "utf8",
    );
    expect(extractRustInjectionScript(rust)).toBe(PAGE_INJECTION_SOURCE);
  });

  test("injection script is valid JavaScript", () => {
    expect(() => new Function(PAGE_INJECTION_SOURCE)).not.toThrow();
  });
});

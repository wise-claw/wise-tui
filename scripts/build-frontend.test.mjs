import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashPaths, canReuseBuild, dependencyStamp } from "./build-frontend.mjs";

test("cache rejects changed source, deleted output, and patched dependencies", () => {
  const root = mkdtempSync(join(tmpdir(), "wise-build-cache-"));
  try {
    mkdirSync(join(root, "node_modules/vendor"), { recursive: true });
    writeFileSync(join(root, "node_modules/vendor/index.js"), "original");
    writeFileSync(join(root, "source.ts"), "first");
    writeFileSync(join(root, "output.js"), "built");
    const input = hashPaths(root, ["source.ts"]);
    const output = hashPaths(root, ["output.js"]);
    const cache = { inputHash: input, outputHash: output };
    expect(canReuseBuild(cache, input, output)).toBe(true);
    writeFileSync(join(root, "source.ts"), "changed");
    expect(canReuseBuild(cache, hashPaths(root, ["source.ts"]), output)).toBe(false);
    rmSync(join(root, "output.js"));
    expect(canReuseBuild(cache, input, hashPaths(root, ["output.js"]))).toBe(false);
    const deps = dependencyStamp(root);
    mkdirSync(join(root, "node_modules/.vite-temp"));
    writeFileSync(join(root, "node_modules/.vite-temp/config.js"), "temporary");
    expect(dependencyStamp(root)).toBe(deps);
    writeFileSync(join(root, "node_modules/vendor/index.js"), "patched dependency");
    expect(dependencyStamp(root)).not.toBe(deps);
    expect(canReuseBuild(null, input, output)).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

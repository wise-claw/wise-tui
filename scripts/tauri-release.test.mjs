import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

const source = readFileSync(new URL("./tauri-release.mjs", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "");

function runRelease(libraries, otoolStatus = 0, signatureStatus = 0) {
  const calls = [];
  let exitCode;
  const stop = new Error("exit");
  try {
    runInNewContext(source, {
      join,
      existsSync: () => true,
      readdirSync: () => [],
      console: { error() {} },
      process: {
        env: {}, platform: "darwin", argv: ["node", "tauri-release.mjs", "build"],
        exit(code) { exitCode = code; throw stop; },
      },
      spawnSync(command) {
        calls.push(command);
        if (command === "otool") return {
          status: otoolStatus, stderr: "inspection failed",
          stdout: `Wise.app/Contents/MacOS/wise:\n${libraries.map((path) => `\t${path} (compatibility version 1.0.0, current version 1.0.0)`).join("\n")}\n`,
        };
        return { status: command === "codesign" ? signatureStatus : 0 };
      },
    });
  } catch (error) {
    if (error !== stop) throw error;
  }
  return { exitCode, calls };
}

test("rejects Homebrew and other external dependencies even with a valid signature", () => {
  for (const path of ["/opt/homebrew/opt/openssl@3/lib/libssl.3.dylib", "/usr/local/lib/libcrypto.3.dylib", "/Users/builder/lib/libgit2.dylib"]) {
    assert.deepEqual(runRelease([path]), { exitCode: 1, calls: ["bun", "otool"] });
  }
});

test("allows system and bundle-relative dependencies and verifies the signature", () => {
  assert.deepEqual(runRelease(["/usr/lib/libSystem.B.dylib", "/System/Library/Frameworks/Security.framework/Security", "@rpath/libexample.dylib"]),
    { exitCode: 0, calls: ["bun", "otool", "codesign"] });
});

test("fails closed when dependency inspection fails", () => {
  assert.deepEqual(runRelease([], 1), { exitCode: 1, calls: ["bun", "otool"] });
});

test("still rejects invalid app signatures", () => {
  assert.equal(runRelease([], 0, 1).exitCode, 1);
});

import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

const openPath = mock(async () => {});

mock.module("@tauri-apps/plugin-opener", () => ({ openPath }));

describe("FailureEvidenceBlock", () => {
  test("renders exit code, stdout, stderr, runDir, and retry action", async () => {
    const { FailureEvidenceBlock } = await import("./FailureEvidenceBlock");
    const html = renderToStaticMarkup(
      <FailureEvidenceBlock
        clusterId="cluster-fe"
        raw={{
          runId: "run-1",
          runDir: "/tmp/run-1",
          exitCode: 42,
          durationMs: 10,
          stdoutPath: "/tmp/run-1/claude.stdout.log",
          stderrPath: "/tmp/run-1/claude.stderr.log",
          rawResultPath: "/tmp/run-1/split-result.raw.json",
          rawOutput: null,
          stdoutTruncatedPreview: "",
          claudeSessionId: null,
        }}
        error={{
          summary: "Claude failed",
          exitCode: 42,
          stdoutPath: "/tmp/run-1/claude.stdout.log",
          stderrPath: "/tmp/run-1/claude.stderr.log",
        }}
        onRetryFromRunDir={mock(() => {})}
      />,
    );

    expect(html).toContain("Failure evidence");
    expect(html).toContain("42");
    expect(html).toContain("/tmp/run-1/claude.stdout.log");
    expect(html).toContain("/tmp/run-1/claude.stderr.log");
    expect(html).toContain("/tmp/run-1");
    expect(html).toContain("Retry from runDir");
  });

  test("renders progress error artifact paths without raw output", async () => {
    const { FailureEvidenceBlock } = await import("./FailureEvidenceBlock");
    const html = renderToStaticMarkup(
      <FailureEvidenceBlock
        clusterId="cluster-fe"
        raw={null}
        error={{
          summary: "Claude output did not contain JSON",
          exitCode: 1,
          stdoutPath: "/tmp/run-1/claude.stdout.log",
          stderrPath: "/tmp/run-1/claude.stderr.log",
        }}
      />,
    );

    expect(html).toContain("Claude output did not contain JSON");
    expect(html).toContain("1");
    expect(html).toContain("/tmp/run-1/claude.stdout.log");
    expect(html).toContain("/tmp/run-1/claude.stderr.log");
    expect(html).not.toContain("Retry from runDir");
  });
});

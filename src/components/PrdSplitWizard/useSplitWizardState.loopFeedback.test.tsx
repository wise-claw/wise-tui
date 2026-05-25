import { mock, describe, expect, test } from "bun:test";
import { useLayoutEffect } from "react";
import { act, create } from "react-test-renderer";
import type { UseSplitWizardStateApi } from "./useSplitWizardState";
import { computeBodyHash } from "../../services/prdSplit/requirementsIndexVersion";

const invoke = mock(async (command: string) => {
  if (command === "trellis_read_spec_file") {
    const bodyHash = computeBodyHash(MARKDOWN);
    return {
      relativePath: "guides/prd-assistant-loop-feedback.md",
      content: [
        "# PRD Assistant Loop Feedback",
        "",
        "## 2026-05-25T08:00:00.000Z - PRD Split Loop Feedback",
        "",
        "### Requirement To Task Anchors",
        "",
        "| Cluster | Task | Trellis task | Requirements | Anchor |",
        "| --- | --- | --- | --- | --- |",
        `| cluster-backend-2 | API | .trellis/tasks/p/api | req-functional-1 | ${bodyHash} [0, 12] |`,
      ].join("\n"),
      sizeBytes: 256,
    };
  }
  if (command === "run_claude_quick") {
    return "{}";
  }
  throw new Error(`unexpected command: ${command}`);
});

mock.module("@tauri-apps/api/core", () => ({ invoke }));

const { useSplitWizardState } = await import("./useSplitWizardState");

const MARKDOWN = "# Login\n\n新增登录 API";

function Probe({ onValue }: { onValue: (api: UseSplitWizardStateApi) => void }) {
  const api = useSplitWizardState();
  useLayoutEffect(() => {
    onValue(api);
  });
  return null;
}

function renderProbe() {
  let latest: UseSplitWizardStateApi | null = null;
  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(<Probe onValue={(api) => { latest = api; }} />);
  });
  if (!latest) throw new Error("Probe never received useSplitWizardState");
  return {
    get api() {
      if (!latest) throw new Error("api not ready");
      return latest;
    },
    unmount: () => renderer.unmount(),
  };
}

describe("useSplitWizardState loop feedback", () => {
  test("parseAndPlanMarkdown reads durable Spec feedback and applies matching anchor hints", async () => {
    invoke.mockClear();
    const probe = renderProbe();
    try {
      act(() => {
        probe.api.reset(
          { id: "p1", name: "Wise", rootPath: "/work/wise" },
          [
            { id: 1, name: "web", type: "frontend", path: "/work/wise/web" },
            { id: 2, name: "api", type: "backend", path: "/work/wise/api" },
          ],
          null,
        );
      });

      let result: Awaited<ReturnType<UseSplitWizardStateApi["parseAndPlanMarkdown"]>>;
      await act(async () => {
        result = await probe.api.parseAndPlanMarkdown(MARKDOWN);
      });

      expect(result!.ok).toBe(true);
      expect(invoke).toHaveBeenCalledWith("trellis_read_spec_file", {
        repoPath: "/work/wise",
        relativePath: "guides/prd-assistant-loop-feedback.md",
      });
      expect(probe.api.state.plan?.clusters.find((cluster) =>
        cluster.primaryRepositoryId === 2
      )?.requirementIds).toEqual(["req-functional-1"]);
    } finally {
      probe.unmount();
    }
  });
});

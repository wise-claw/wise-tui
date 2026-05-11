import { describe, expect, test } from "bun:test";
import type { OmcWorkflowAdapter } from "../../types/workflow";
import { DefaultAdapterRegistry } from "./adapterRegistry";

function stubAdapter(label: string): OmcWorkflowAdapter {
  return {
    async execute() {
      return { status: "succeeded", artifactRefs: [`stub://${label}`], summary: label };
    },
  };
}

describe("DefaultAdapterRegistry", () => {
  test("resolve returns the mapped adapter for a known templateId", () => {
    const fallback = stubAdapter("omc");
    const trellis = stubAdapter("trellis");
    const registry = DefaultAdapterRegistry.of(fallback, [["trellis", trellis]]);
    expect(registry.resolve("trellis")).toBe(trellis);
  });

  test("resolve returns the fallback for an unknown templateId", () => {
    const fallback = stubAdapter("omc");
    const trellis = stubAdapter("trellis");
    const registry = DefaultAdapterRegistry.of(fallback, [["trellis", trellis]]);
    expect(registry.resolve("autopilot")).toBe(fallback);
    expect(registry.resolve("unknown-template")).toBe(fallback);
  });

  test("register adds a mapping after construction", () => {
    const fallback = stubAdapter("omc");
    const verify = stubAdapter("verify");
    const registry = DefaultAdapterRegistry.of(fallback);
    expect(registry.resolve("verify")).toBe(fallback);
    registry.register("verify", verify);
    expect(registry.resolve("verify")).toBe(verify);
  });
});

import { describe, expect, test } from "bun:test";
import {
  DIRECT_OMC_BATCH_TEMPLATE_IDS,
  isDirectOmcBatchTemplateId,
  OMC_BATCH_TEMPLATE_IDS,
  TRELLIS_BATCH_TEMPLATE_ID,
} from "./omcBatchTemplates";

describe("omc batch template constants", () => {
  test("keeps trellis outside the direct OMC template set", () => {
    expect(DIRECT_OMC_BATCH_TEMPLATE_IDS).toEqual(["autopilot", "ultraqa", "verify", "team"]);
    expect(OMC_BATCH_TEMPLATE_IDS).toEqual(["autopilot", "ultraqa", "verify", "team", "trellis"]);
    expect(TRELLIS_BATCH_TEMPLATE_ID).toBe("trellis");
  });

  test("narrows direct templates", () => {
    expect(isDirectOmcBatchTemplateId("autopilot")).toBe(true);
    expect(isDirectOmcBatchTemplateId("ultraqa")).toBe(true);
    expect(isDirectOmcBatchTemplateId("verify")).toBe(true);
    expect(isDirectOmcBatchTemplateId("team")).toBe(true);
    expect(isDirectOmcBatchTemplateId("trellis")).toBe(false);
  });
});

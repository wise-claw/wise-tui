import { describe, expect, test } from "bun:test";
import {
  DEFAULT_COMPOSER_IMAGE_GC_GRACE_HOURS,
  DEFAULT_COMPOSER_IMAGE_GC_MAX_MB,
  DEFAULT_COMPOSER_IMAGE_GC_TTL_DAYS,
  defaultComposerImageGcConfig,
} from "./composerImageGc";

describe("composerImageGc config", () => {
  test("defaultComposerImageGcConfig matches product defaults", () => {
    expect(defaultComposerImageGcConfig()).toEqual({
      ttlDays: DEFAULT_COMPOSER_IMAGE_GC_TTL_DAYS,
      graceHours: DEFAULT_COMPOSER_IMAGE_GC_GRACE_HOURS,
      maxMb: DEFAULT_COMPOSER_IMAGE_GC_MAX_MB,
    });
  });
});

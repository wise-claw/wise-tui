import { describe, expect, it } from "bun:test";
import {
  PRD_IMAGE_MAX_BYTES,
  gatePrdImage,
  isAcceptedImageMime,
  sanitizeImageFileName,
} from "./prdImageGate";

describe("isAcceptedImageMime", () => {
  it("accepts image/*", () => {
    expect(isAcceptedImageMime("image/png")).toBe(true);
    expect(isAcceptedImageMime("image/jpeg")).toBe(true);
    expect(isAcceptedImageMime("image/webp")).toBe(true);
  });
  it("rejects everything else", () => {
    expect(isAcceptedImageMime("")).toBe(false);
    expect(isAcceptedImageMime(null)).toBe(false);
    expect(isAcceptedImageMime(undefined)).toBe(false);
    expect(isAcceptedImageMime("application/pdf")).toBe(false);
    expect(isAcceptedImageMime("text/plain")).toBe(false);
  });
});

describe("sanitizeImageFileName", () => {
  it("keeps ascii alnum dot dash underscore", () => {
    expect(sanitizeImageFileName("photo-01.png")).toBe("photo-01.png");
    expect(sanitizeImageFileName("a_b.c.PNG")).toBe("a_b.c.PNG");
  });
  it("replaces unicode/space with underscore", () => {
    expect(sanitizeImageFileName("截图 2025-05-14.png")).toBe("___2025-05-14.png");
    expect(sanitizeImageFileName("hello world.jpg")).toBe("hello_world.jpg");
  });
  it("falls back when empty after trimming", () => {
    expect(sanitizeImageFileName("")).toBe("image.png");
    expect(sanitizeImageFileName("   ")).toBe("image.png");
  });
});

describe("gatePrdImage", () => {
  it("accepts small image", () => {
    expect(gatePrdImage({ size: 1024, type: "image/png" })).toBe("ok");
  });
  it("rejects non-image", () => {
    expect(gatePrdImage({ size: 1024, type: "application/pdf" })).toBe("wrong-mime");
    expect(gatePrdImage({ size: 1024, type: "" })).toBe("wrong-mime");
  });
  it("rejects oversize", () => {
    expect(gatePrdImage({ size: PRD_IMAGE_MAX_BYTES + 1, type: "image/png" })).toBe("too-large");
  });
  it("accepts boundary size", () => {
    expect(gatePrdImage({ size: PRD_IMAGE_MAX_BYTES, type: "image/jpeg" })).toBe("ok");
  });
});

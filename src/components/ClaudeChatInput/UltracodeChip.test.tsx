import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UltracodeChip } from "./UltracodeChip";

describe("UltracodeChip", () => {
  test("active=false 时返回 null（不渲染任何 DOM）", () => {
    const html = renderToStaticMarkup(
      React.createElement(UltracodeChip, { active: false, hasTabOverride: false }),
    );
    expect(html).toBe("");
  });

  test("active=true 时渲染 ultracode chip（含 className 与 label 文本）", () => {
    const html = renderToStaticMarkup(
      React.createElement(UltracodeChip, { active: true, hasTabOverride: true }),
    );
    expect(html).toContain("app-ultracode-chip");
    expect(html).toContain("ultracode");
    // 不可交互时 chip 不带 --interactive
    expect(html).not.toContain("app-ultracode-chip-btn");
  });

  test("active=true + onToggle 时渲染可交互 button", () => {
    const html = renderToStaticMarkup(
      React.createElement(UltracodeChip, {
        active: true,
        hasTabOverride: false,
        onToggle: () => {},
      }),
    );
    expect(html).toContain("app-ultracode-chip-btn");
    expect(html).toContain("app-ultracode-chip--interactive");
  });

  test("disabled=true 时即使有 onToggle 也不渲染 button", () => {
    const html = renderToStaticMarkup(
      React.createElement(UltracodeChip, {
        active: true,
        hasTabOverride: false,
        onToggle: () => {},
        disabled: true,
      }),
    );
    expect(html).not.toContain("app-ultracode-chip-btn");
  });
});
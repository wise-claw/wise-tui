import { describe, expect, test } from "bun:test";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HoverHint } from "./HoverHint";

describe("HoverHint", () => {
  test("injects native title onto a single child button", () => {
    const html = renderToStaticMarkup(
      <HoverHint title="启动">
        <button type="button" className="app-btn">
          Go
        </button>
      </HoverHint>,
    );
    expect(html).toContain('title="启动"');
    expect(html).toContain('class="app-btn"');
  });

  test("forwards overlay ref and merges className for dropdown triggers", () => {
    const ref = createRef<HTMLButtonElement>();
    const html = renderToStaticMarkup(
      <HoverHint
        ref={ref}
        title="更多"
        className="ant-dropdown-trigger ant-dropdown-open"
      >
        <button type="button" className="app-topbar-btn">
          More
        </button>
      </HoverHint>,
    );
    expect(html).toContain('title="更多"');
    expect(html).toContain("app-topbar-btn");
    expect(html).toContain("ant-dropdown-trigger");
    expect(html).toContain("ant-dropdown-open");
  });

  test("keeps native title on span wrapper instead of drilling into svg child", () => {
    const html = renderToStaticMarkup(
      <HoverHint title="帮助说明">
        <span className="help-wrap">
          <svg viewBox="0 0 16 16" aria-hidden="true" />
        </span>
      </HoverHint>,
    );
    expect(html).toContain('class="help-wrap"');
    expect(html).toContain('title="帮助说明"');
    expect(html).not.toMatch(/<svg[^>]*title=/);
  });

  test("keeps native title on span wrapper for opaque icon components", () => {
    function IconStub() {
      return <svg viewBox="0 0 16 16" aria-hidden="true" />;
    }
    const html = renderToStaticMarkup(
      <HoverHint title="Trellis 已初始化">
        <span className="app-repository-sdd-icon">
          <IconStub />
        </span>
      </HoverHint>,
    );
    expect(html).toContain('class="app-repository-sdd-icon"');
    expect(html).toContain('title="Trellis 已初始化"');
    expect(html).not.toMatch(/<svg[^>]*title=/);
  });

  test("deep-merges overlay props through passive span wrapper onto button", () => {
    const html = renderToStaticMarkup(
      <HoverHint title="拉取" className="ant-dropdown-trigger">
        <span className="git-sync-count-btn-wrap">
          <button type="button" className="git-sync-count-btn">
            Pull
          </button>
        </span>
      </HoverHint>,
    );
    expect(html).toContain('title="拉取"');
    expect(html).toContain("git-sync-count-btn");
    expect(html).toContain("ant-dropdown-trigger");
    expect(html).not.toMatch(/<span[^>]*ant-dropdown-trigger/);
  });

  test("keeps overlay props on wrapper when wrapper owns trigger handlers", () => {
    const html = renderToStaticMarkup(
      <HoverHint title="模型" className="ant-dropdown-trigger">
        <span className="wrap" onMouseDown={() => undefined}>
          <button type="button" className="inner-btn">
            Pick
          </button>
        </span>
      </HoverHint>,
    );
    expect(html).toContain('class="wrap ant-dropdown-trigger"');
    expect(html).not.toMatch(/inner-btn ant-dropdown-trigger/);
  });

  test("suppresses native title when open is false", () => {
    const html = renderToStaticMarkup(
      <HoverHint title="运行" open={false}>
        <button type="button">Run</button>
      </HoverHint>,
    );
    expect(html).not.toContain('title="');
  });

  test("does not leak tooltip-only props onto DOM trigger", () => {
    const html = renderToStaticMarkup(
      <HoverHint title="帮助" placement="top" destroyOnHidden mouseEnterDelay={0.5}>
        <button type="button">Help</button>
      </HoverHint>,
    );
    expect(html).not.toContain("destroyOnHidden");
    expect(html).not.toContain("mouseEnterDelay");
    expect(html).not.toContain('placement="top"');
  });

  test("uses ant Tooltip for rich ReactNode titles (no native title on trigger)", () => {
    const html = renderToStaticMarkup(
      <HoverHint title={<span>Rich help</span>}>
        <button type="button">Help</button>
      </HoverHint>,
    );
    expect(html).not.toContain('title="');
    expect(html).toContain("<button");
  });

  test("still merges trigger props when rich title uses Tooltip fallback", () => {
    const html = renderToStaticMarkup(
      <HoverHint
        title={<span>Rich help</span>}
        className="ant-dropdown-trigger"
      >
        <button type="button" className="app-btn">
          Help
        </button>
      </HoverHint>,
    );
    expect(html).toContain("app-btn");
    expect(html).toContain("ant-dropdown-trigger");
    expect(html).not.toContain('title="');
  });
});

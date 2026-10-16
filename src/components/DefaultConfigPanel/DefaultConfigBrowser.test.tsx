import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Window } from "happy-dom";
import { Input } from "antd";
import { DefaultConfigBrowser } from "./DefaultConfigBrowser";
import { DEFAULT_CONFIG_CATEGORIES, matchesConfigSearch } from "./configNavigation";

let renderer: ReactTestRenderer | undefined;
const globals = globalThis as unknown as Record<string, unknown>;
const previous = new Map<string, unknown>();
beforeEach(() => {
  const dom = new Window();
  for (const key of ["window", "document", "HTMLElement", "Element", "ShadowRoot", "getComputedStyle"]) {
    previous.set(key, globals[key]);
    globals[key] = (dom as unknown as Record<string, unknown>)[key];
  }
});
afterEach(() => {
  act(() => renderer?.unmount()); renderer = undefined;
  for (const [key, value] of previous) {
    if (value === undefined) delete globals[key];
    else globals[key] = value;
  }
  previous.clear();
});

function Setting(_props: { title: string; detail: string }) { return null; }

const sections = [
  { key: "session", title: "新建会话", content: <div title="回复语言">语言</div> },
  { key: "composer", title: "输入框", content: <div title="底栏按钮" /> },
  { key: "engines", title: "引擎与默认权限", content: <Setting title="Codex" detail="沙箱与审批" /> },
  { key: "gitFiles", title: "Git / 文件树", content: <div title="Markdown 打开" /> },
  { key: "updates", title: "版本更新", content: <div>版本</div>, keywords: "自动检查更新" },
];

function mount() { act(() => { renderer = create(<DefaultConfigBrowser sections={sections} />); }); }
function titles() { return renderer!.root.findAllByType("section").map((node) => node.props["aria-label"]); }
function search(value: string) {
  act(() => renderer!.root.findByType(Input.Search).props.onChange({ target: { value } }));
}

describe("默认配置导航", () => {
  test("every existing settings group has one destination", () => {
    const keys = DEFAULT_CONFIG_CATEGORIES.flatMap((category) => [...category.sections]);
    expect(keys.length).toBe(new Set(keys).size);
    expect([...keys].sort()).toEqual(["session", "engines", "terminal", "leftSidebar", "gitFiles", "composer", "chrome", "repoShortcuts", "dev", "updates"].sort());
  });

  test("opens common session settings and switches categories", () => {
    mount();
    expect(titles()).toEqual(["新建会话", "输入框"]);
    const button = renderer!.root.findAllByType("button").find((node) => node.children.includes("文件与产物"))!;
    act(() => button.props.onClick());
    expect(titles()).toEqual(["Git / 文件树"]);
  });

  test("searches labels and details across categories and clears empty results", () => {
    mount();
    search("codex 沙箱");
    expect(titles()).toEqual(["引擎与默认权限"]);
    search("产物");
    expect(titles()).toEqual(["Git / 文件树"]);
    search("自动检查更新");
    expect(titles()).toEqual(["版本更新"]);
    search("不存在的配置");
    expect(titles()).toEqual([]);
    const clear = renderer!.root.findAllByType("button").find((node) => node.children.includes("清除搜索"))!;
    act(() => clear.props.onClick());
    expect(titles()).toEqual(["新建会话", "输入框"]);
  });

  test("normalizes whitespace and case while requiring every search word", () => {
    expect(matchesConfigSearch("  CODEX  权限 ", "Codex 默认权限")).toBe(true);
    expect(matchesConfigSearch("Codex 终端", "Codex 默认权限")).toBe(false);
  });
});

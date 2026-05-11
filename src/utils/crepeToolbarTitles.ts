/**
 * Crepe 选区气泡工具栏（.milkdown-toolbar）未内置文案提示。
 * 优先按 SVG path 识别；失败时按 Crepe 默认按钮数量做顺序回退。
 * 同时写入 `title`（系统原生提示，不受父级 overflow 裁剪）与 `data-wise-crepe-title`（自定义悬停层）。
 */

function firstPathD(svg: Element): string {
  const path = svg.querySelector("path");
  const raw = path?.getAttribute("d") ?? "";
  return raw.replace(/\s+/g, " ").trim();
}

function labelForToolbarButton(btn: HTMLButtonElement): string | null {
  const svg = btn.querySelector("svg");
  if (!svg) return null;

  // 应用内追加的「新增任务」：stroke + 双圆（与 MilkdownViewer 中 WISE_SPLIT_TOOLBAR_ICON 一致）
  if (
    svg.getAttribute("stroke") === "currentColor"
    && svg.querySelectorAll("circle").length >= 2
  ) {
    return "新增任务";
  }

  const d = firstPathD(svg);
  if (d.startsWith("M8.85758")) return "加粗";
  if (d.startsWith("M6.29811")) return "斜体";
  if (d.startsWith("M3.25 13.7404")) return "删除线";
  if (d.startsWith("M9.4 16.6")) return "行内代码";
  if (d.startsWith("M7 19v")) return "公式（LaTeX）";
  if (d.startsWith("M17.0385")) return "链接";
  return null;
}

/** Crepe 默认开启 Latex 时的常见按钮数：5=无公式无拆分；6=有公式无拆分；7=有公式有拆分。 */
function labelsByToolbarButtonCount(n: number): string[] | null {
  if (n === 7) {
    return ["加粗", "斜体", "删除线", "行内代码", "公式（LaTeX）", "链接", "新增任务"];
  }
  if (n === 6) {
    return ["加粗", "斜体", "删除线", "行内代码", "公式（LaTeX）", "链接"];
  }
  if (n === 5) {
    return ["加粗", "斜体", "删除线", "行内代码", "链接"];
  }
  return null;
}

export function annotateCrepeToolbarButtons(root: ParentNode = document): void {
  const toolbars = root.querySelectorAll<HTMLElement>(".milkdown-toolbar");
  for (const toolbar of toolbars) {
    const buttons = [...toolbar.querySelectorAll<HTMLButtonElement>("button.toolbar-item")];
    const byCount = labelsByToolbarButtonCount(buttons.length);
    buttons.forEach((btn, index) => {
      const label = labelForToolbarButton(btn) ?? byCount?.[index] ?? null;
      if (!label) return;
      if (btn.getAttribute("data-wise-crepe-title") === label && btn.title === label) return;
      btn.title = label;
      btn.setAttribute("aria-label", label);
      btn.dataset.wiseCrepeTitle = label;
    });
  }
}

let annotateScheduled = false;
let selectionListenerAttached = false;

function scheduleAnnotateFromSelection(): void {
  if (annotateScheduled) return;
  annotateScheduled = true;
  requestAnimationFrame(() => {
    annotateScheduled = false;
    annotateCrepeToolbarButtons();
    requestAnimationFrame(() => {
      annotateCrepeToolbarButtons();
    });
    window.setTimeout(() => {
      annotateCrepeToolbarButtons();
    }, 100);
  });
}

/** 全局安装一次：选区变化 / 指针抬起后为 Crepe 气泡按钮写入文案（多实例 Milkdown 共用）。 */
export function ensureCrepeToolbarTitleHintsInstalled(): void {
  if (selectionListenerAttached) return;
  selectionListenerAttached = true;
  document.addEventListener("selectionchange", scheduleAnnotateFromSelection, { passive: true });
  document.addEventListener("pointerup", scheduleAnnotateFromSelection, { capture: true, passive: true });
}

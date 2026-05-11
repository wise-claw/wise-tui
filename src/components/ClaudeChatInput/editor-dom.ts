const ZERO_WIDTH = "\u200B";

/** Create DOM text nodes from a string, splitting on newlines into <br> elements. */
export function createTextFragment(text: string): Node[] {
  if (!text) return [];
  const lines = text.split("\n");
  const nodes: Node[] = [];
  lines.forEach((line, i) => {
    if (line) nodes.push(document.createTextNode(line));
    if (i < lines.length - 1) nodes.push(document.createElement("br"));
  });
  return nodes;
}

/** Insert a non-editable pill span at the current cursor position. */
export function insertPillAtCursor(
  editor: HTMLDivElement,
  type: "file" | "agent" | "team",
  label: string,
  data: Record<string, string>,
): void {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  // Ensure range is within editor
  if (!editor.contains(range.commonAncestorContainer)) return;

  range.deleteContents();

  const pill = document.createElement("span");
  pill.contentEditable = "false";
  pill.dataset.type = type;
  pill.style.userSelect = "text";
  pill.style.display = "inline-block";
  pill.style.margin = "0 2px";
  Object.entries(data).forEach(([k, v]) => { pill.dataset[k] = v; });
  pill.textContent = label;
  range.insertNode(pill);

  // Insert a space after the pill
  const space = document.createTextNode(" ");
  range.setStartAfter(pill);
  range.insertNode(space);

  // Insert a zero-width anchor after the space so the caret
  // always lands in an editable text node (outside non-editable pill).
  const anchor = document.createTextNode(ZERO_WIDTH);
  range.setStartAfter(space);
  range.insertNode(anchor);

  // Move cursor after the anchor
  range.setStart(anchor, anchor.textContent?.length ?? 1);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Get the character position of the cursor within the editor. */
export function getCursorPosition(editor: HTMLDivElement): number {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return 0;
  const range = sel.getRangeAt(0);
  if (!editor.contains(range.startContainer)) return 0;

  // Caret directly on the editor element (between top-level children)
  if (range.startContainer === editor) {
    return logicalLengthBeforeChildIndex(editor, range.startOffset);
  }

  const preCaret = document.createRange();
  preCaret.selectNodeContents(editor);
  preCaret.setEnd(range.startContainer, range.startOffset);
  return measureRangeToEnd(preCaret, editor);
}

/** Length of one top-level child for cursor offset math (text / pill / br). */
function logicalNodeLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? "").length;
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as HTMLElement;
    if (el.tagName === "BR") return 1;
    if (isPill(el)) return 1;
  }
  return 0;
}

function logicalLengthBeforeChildIndex(editor: HTMLDivElement, childIndex: number): number {
  let len = 0;
  const n = Math.min(childIndex, editor.childNodes.length);
  for (let i = 0; i < n; i++) {
    len += logicalNodeLength(editor.childNodes[i]!);
  }
  return len;
}

/** Walk from start of editor up to range end (exclusive of nodes after end). */
function measureRangeToEnd(range: Range, editor: HTMLDivElement): number {
  const { endContainer, endOffset } = range;
  let length = 0;
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let node: Node | null;

  while ((node = walker.nextNode())) {
    if (node === endContainer) {
      if (node.nodeType === Node.TEXT_NODE) {
        length += endOffset;
      } else if (node === editor) {
        length += logicalLengthBeforeChildIndex(editor, endOffset);
      }
      break;
    }
    length += logicalNodeLength(node);
  }
  return length;
}

function isPill(node: Node): boolean {
  return node.nodeType === Node.ELEMENT_NODE &&
    (node as HTMLElement).contentEditable === "false" &&
    !!(node as HTMLElement).dataset?.type;
}

/** Set the cursor to a character position within the editor. */
export function setCursorPosition(editor: HTMLDivElement, targetPos: number): void {
  const sel = window.getSelection();
  if (!sel) return;

  let pos = 0;
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let node: Node | null;

  while ((node = walker.nextNode())) {
    if (node.nodeType === Node.TEXT_NODE) {
      const textLen = node.textContent?.length ?? 0;
      if (pos + textLen >= targetPos) {
        const range = document.createRange();
        range.setStart(node, targetPos - pos);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
      pos += textLen;
    } else if (isPill(node)) {
      pos += 1;
      if (pos >= targetPos) {
        const range = document.createRange();
        range.setStartAfter(node);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
    } else if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR") {
      pos += 1;
      if (pos >= targetPos) {
        const range = document.createRange();
        range.setStartAfter(node);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
    }
  }

  // Position at end
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Parse contentEditable children into parts array. */
export function parseFromDOM(editor: HTMLDivElement): Array<{
  type: string;
  text?: string;
  path?: string;
  name?: string;
  workflowId?: string;
}> {
  const parts: Array<{
    type: string;
    text?: string;
    path?: string;
    name?: string;
    workflowId?: string;
  }> = [];
  let textBuffer = "";

  const flushText = () => {
    if (textBuffer) {
      parts.push({ type: "text", text: textBuffer });
      textBuffer = "";
    }
  };

  for (const child of Array.from(editor.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      let text = child.textContent ?? "";
      // Strip trailing zero-width space sentinel
      if (text.endsWith(ZERO_WIDTH)) text = text.slice(0, -1);
      if (!text) continue;
      // Split on newlines — 须把换行留在同一 textBuffer，不能用 flush 拆成多个 text part：
      // buildEditorDOM 会把相邻 text part 直接拼接，flush 会导致多行/软换行在 reconcile 后粘成一行（中间删除时像乱删）。
      const lines = text.split("\n");
      lines.forEach((line, i) => {
        if (line) {
          textBuffer += line;
        }
        if (i < lines.length - 1) {
          textBuffer += "\n";
        }
      });
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as HTMLElement;
      if (el.tagName === "BR") {
        textBuffer += "\n";
      } else if (el.contentEditable === "false" && el.dataset.type) {
        flushText();
        if (el.dataset.type === "file") {
          parts.push({ type: "file", path: el.dataset.path ?? "", text: el.textContent ?? "" });
        } else if (el.dataset.type === "agent") {
          parts.push({ type: "agent", name: el.dataset.name ?? "", text: el.textContent ?? "" });
        } else if (el.dataset.type === "team") {
          parts.push({
            type: "team",
            name: el.dataset.name ?? "",
            workflowId: el.dataset.workflowId ?? "",
            text: el.textContent ?? "",
          });
        }
      } else {
        // Recurse into non-pill elements
        for (const inner of Array.from(el.childNodes)) {
          if (inner.nodeType === Node.TEXT_NODE) {
            let text = inner.textContent ?? "";
            if (text.endsWith(ZERO_WIDTH)) text = text.slice(0, -1);
            textBuffer += text;
          } else if (inner.nodeType === Node.ELEMENT_NODE) {
            const innerEl = inner as HTMLElement;
            if (innerEl.tagName === "BR") {
              textBuffer += "\n";
            } else if (innerEl.contentEditable === "false" && innerEl.dataset.type) {
              flushText();
              if (innerEl.dataset.type === "file") {
                parts.push({ type: "file", path: innerEl.dataset.path ?? "", text: innerEl.textContent ?? "" });
              } else if (innerEl.dataset.type === "agent") {
                parts.push({ type: "agent", name: innerEl.dataset.name ?? "", text: innerEl.textContent ?? "" });
              } else if (innerEl.dataset.type === "team") {
                parts.push({
                  type: "team",
                  name: innerEl.dataset.name ?? "",
                  workflowId: innerEl.dataset.workflowId ?? "",
                  text: innerEl.textContent ?? "",
                });
              }
            }
          }
        }
        // If element is a block (div/p), add implicit newline
        if (el.tagName === "DIV" || el.tagName === "P") {
          flushText();
        }
      }
    }
  }
  flushText();
  return mergeConsecutiveTextParts(parts);
}

/** 将相邻的 text part 合并为一段并插入换行（来自多 div 等块级 flush，或历史错误解析）。 */
function mergeConsecutiveTextParts(
  parts: Array<{
    type: string;
    text?: string;
    path?: string;
    name?: string;
    workflowId?: string;
  }>,
): Array<{
  type: string;
  text?: string;
  path?: string;
  name?: string;
  workflowId?: string;
}> {
  const out: typeof parts = [];
  for (const p of parts) {
    if (p.type === "text" && out.length > 0) {
      const last = out[out.length - 1]!;
      if (last.type === "text") {
        last.text = `${last.text ?? ""}\n${p.text ?? ""}`;
        continue;
      }
    }
    out.push({ ...p });
  }
  return out;
}

/** Check if DOM content matches the expected parts (ignoring zero-width spaces). */
export function isDOMNormalized(editor: HTMLDivElement): boolean {
  for (const child of Array.from(editor.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? "";
      if (text.includes(ZERO_WIDTH) && text.length > 1) return false;
    }
  }
  return true;
}

/** Ensure the editor always has content (add zero-width space if empty). */
export function ensureEditorHasContent(editor: HTMLDivElement): void {
  if (editor.childNodes.length === 0) {
    editor.appendChild(document.createTextNode(ZERO_WIDTH));
  }
}

/** Get the bounding rect of the word at the given cursor position. */
export function getCurrentWordRect(editor: HTMLDivElement): DOMRect | null {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return editor.getBoundingClientRect();

  const range = sel.getRangeAt(0);
  if (!editor.contains(range.startContainer)) return editor.getBoundingClientRect();

  // Try to get the word range by expanding the current range
  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    const text = range.startContainer.textContent ?? "";
    const start = Math.max(0, range.startOffset - 1);
    const end = Math.min(text.length, range.startOffset + 1);

    const wordRange = document.createRange();
    wordRange.setStart(range.startContainer, start);
    wordRange.setEnd(range.startContainer, end);
    return wordRange.getBoundingClientRect();
  }

  return editor.getBoundingClientRect();
}

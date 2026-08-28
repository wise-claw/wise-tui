/**
 * 页面内采集选中图文。`chrome.scripting.executeScript({ func })` 只会序列化函数体，
 * 因此注入函数必须自包含、不得引用模块级绑定。
 */

export const MAX_SELECTION_IMAGES = 8;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_TEXT_CHARS = 50_000;
export const MIN_CROP_CSS_PX = 8;
export const MAX_SCREENSHOT_EDGE = 1600;

/**
 * @param {string} dataUrl
 * @returns {{ mime: string, data: string } | null}
 */
export function parseDataUrl(dataUrl) {
  const raw = String(dataUrl || "").trim();
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(raw);
  if (!match) return null;
  const mime = match[1].trim().toLowerCase();
  const data = match[2].replace(/\s+/g, "");
  if (!mime.startsWith("image/") || !data) return null;
  return { mime, data };
}

/**
 * @param {{ left: number, top: number, right: number, bottom: number }} rect
 * @param {{ width: number, height: number }} viewport
 * @returns {{ x: number, y: number, width: number, height: number } | null}
 */
export function clipRectToViewport(rect, viewport) {
  const vw = Number(viewport?.width);
  const vh = Number(viewport?.height);
  if (!Number.isFinite(vw) || !Number.isFinite(vh) || vw < 8 || vh < 8) return null;
  const left = Math.max(0, Number(rect?.left) || 0);
  const top = Math.max(0, Number(rect?.top) || 0);
  const right = Math.min(vw, Number(rect?.right) || 0);
  const bottom = Math.min(vh, Number(rect?.bottom) || 0);
  const width = right - left;
  const height = bottom - top;
  if (width < MIN_CROP_CSS_PX || height < MIN_CROP_CSS_PX) return null;
  return { x: left, y: top, width, height };
}

/**
 * @param {{ x: number, y: number, width: number, height: number }} rect
 * @param {number} dpr
 * @param {number} bitmapWidth
 * @param {number} bitmapHeight
 */
export function computeCropPixels(rect, dpr, bitmapWidth, bitmapHeight) {
  const scale = Number(dpr) > 0 ? Number(dpr) : 1;
  const bw = Math.max(1, Math.floor(Number(bitmapWidth) || 1));
  const bh = Math.max(1, Math.floor(Number(bitmapHeight) || 1));
  const sx = Math.min(bw - 1, Math.max(0, Math.round((Number(rect?.x) || 0) * scale)));
  const sy = Math.min(bh - 1, Math.max(0, Math.round((Number(rect?.y) || 0) * scale)));
  const sw = Math.min(bw - sx, Math.max(1, Math.round((Number(rect?.width) || 0) * scale)));
  const sh = Math.min(bh - sy, Math.max(1, Math.round((Number(rect?.height) || 0) * scale)));
  return { sx, sy, sw, sh };
}

/**
 * @param {number} sw
 * @param {number} sh
 * @param {number} [maxEdge]
 */
export function fitCropSize(sw, sh, maxEdge = MAX_SCREENSHOT_EDGE) {
  const w = Math.max(1, Math.round(Number(sw) || 1));
  const h = Math.max(1, Math.round(Number(sh) || 1));
  const cap = Math.max(32, Math.floor(Number(maxEdge) || MAX_SCREENSHOT_EDGE));
  const edge = Math.max(w, h);
  if (edge <= cap) return { width: w, height: h };
  const scale = cap / edge;
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

export function prependRequirementNote(note, body) {
  const n = String(note || "").trim();
  const b = String(body || "").trim();
  if (n && b) return `${n}\n\n${b}`;
  return n || b;
}

function collapseMarkdownWhitespace(text) {
  return String(text || "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * 把选区 HTML 转成需求 Markdown：保留标题、列表、链接、代码，丢掉脚本和纯图片节点。
 * @param {ParentNode} root
 */
export function elementToMarkdown(root) {
  if (!root) return "";
  const parts = [];
  const walk = (node) => {
    if (!node) return;
    if (node.nodeType === 3) {
      const t = String(node.nodeValue || "").replace(/\s+/g, " ");
      if (t) parts.push(t);
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = String(node.tagName || "").toLowerCase();
    if (tag === "script" || tag === "style" || tag === "noscript" || tag === "img" || tag === "svg") {
      return;
    }
    if (tag === "br") {
      parts.push("\n");
      return;
    }
    if (tag === "a") {
      const href = String(node.href || node.getAttribute?.("href") || "").trim();
      const label =
        String(node.textContent || "")
          .replace(/\s+/g, " ")
          .trim() || href;
      if (/^https?:\/\//i.test(href)) parts.push(`[${label}](${href})`);
      else if (label) parts.push(label);
      return;
    }
    if (/^h[1-6]$/.test(tag)) {
      parts.push(`\n${"#".repeat(Number(tag[1]))} `);
      for (const child of node.childNodes) walk(child);
      parts.push("\n");
      return;
    }
    if (tag === "li") {
      parts.push("\n- ");
      for (const child of node.childNodes) walk(child);
      return;
    }
    if (tag === "pre") {
      parts.push(`\n\`\`\`\n${String(node.textContent || "").trim()}\n\`\`\`\n`);
      return;
    }
    if (tag === "code" && String(node.parentElement?.tagName || "").toLowerCase() !== "pre") {
      const code = String(node.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
      if (code) parts.push(`\`${code}\``);
      return;
    }
    if (tag === "p" || tag === "div" || tag === "tr" || tag === "blockquote" || tag === "section") {
      parts.push("\n");
      for (const child of node.childNodes) walk(child);
      parts.push("\n");
      return;
    }
    for (const child of node.childNodes) walk(child);
  };
  walk(root);
  return collapseMarkdownWhitespace(parts.join(""));
}

/**
 * @param {string} html
 * @param {Document} doc
 */
export function htmlFragmentToMarkdown(html, doc) {
  if (!doc?.createElement) return collapseMarkdownWhitespace(html);
  const wrap = doc.createElement("div");
  wrap.innerHTML = String(html || "");
  return elementToMarkdown(wrap);
}

/**
 * @param {string} [clickedImageSrc]
 * @param {string} [mode]
 * @returns {Promise<{
 *   text: string,
 *   pageUrl: string,
 *   pageTitle: string,
 *   images: Array<{ alt: string, mime: string, dataBase64: string, url: string }>,
 *   rect: { x: number, y: number, width: number, height: number, dpr: number } | null
 * }>}
 */
export async function capturePageSelection(clickedImageSrc, mode) {
  const maxImages = 8;
  const maxImageBytes = 4 * 1024 * 1024;
  const maxTextChars = 50_000;
  const minCrop = 8;
  const pageUrl = String(location.href || "");
  const pageTitle = String(document.title || "");
  const dpr = window.devicePixelRatio || 1;
  const captureMode = String(mode || "selection") === "viewport" ? "viewport" : "selection";
  /** @type {Array<{ alt: string, mime: string, dataBase64: string, url: string }>} */
  const images = [];
  const seen = new Set();

  function parseInlineDataUrl(dataUrl) {
    const raw = String(dataUrl || "").trim();
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(raw);
    if (!match) return null;
    const mime = match[1].trim().toLowerCase();
    const data = match[2].replace(/\s+/g, "");
    if (!mime.startsWith("image/") || !data) return null;
    return { mime, data };
  }

  function clipRect(rect) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(0, rect.left);
    const top = Math.max(0, rect.top);
    const right = Math.min(vw, rect.right);
    const bottom = Math.min(vh, rect.bottom);
    const width = right - left;
    const height = bottom - top;
    if (width < minCrop || height < minCrop) return null;
    return { x: left, y: top, width, height, dpr };
  }

  function viewportRect() {
    return clipRect({
      left: 0,
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
    });
  }

  function toMarkdown(root) {
    const parts = [];
    const walk = (node) => {
      if (!node) return;
      if (node.nodeType === 3) {
        const t = String(node.nodeValue || "").replace(/\s+/g, " ");
        if (t) parts.push(t);
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = String(node.tagName || "").toLowerCase();
      if (tag === "script" || tag === "style" || tag === "noscript" || tag === "img" || tag === "svg") {
        return;
      }
      if (tag === "br") {
        parts.push("\n");
        return;
      }
      if (tag === "a") {
        const href = String(node.href || "").trim();
        const label =
          String(node.textContent || "")
            .replace(/\s+/g, " ")
            .trim() || href;
        if (/^https?:\/\//i.test(href)) parts.push(`[${label}](${href})`);
        else if (label) parts.push(label);
        return;
      }
      if (/^h[1-6]$/.test(tag)) {
        parts.push(`\n${"#".repeat(Number(tag[1]))} `);
        for (const child of node.childNodes) walk(child);
        parts.push("\n");
        return;
      }
      if (tag === "li") {
        parts.push("\n- ");
        for (const child of node.childNodes) walk(child);
        return;
      }
      if (tag === "pre") {
        parts.push(`\n\`\`\`\n${String(node.textContent || "").trim()}\n\`\`\`\n`);
        return;
      }
      if (tag === "code" && String(node.parentElement?.tagName || "").toLowerCase() !== "pre") {
        const code = String(node.textContent || "")
          .replace(/\s+/g, " ")
          .trim();
        if (code) parts.push(`\`${code}\``);
        return;
      }
      if (tag === "p" || tag === "div" || tag === "tr" || tag === "blockquote" || tag === "section") {
        parts.push("\n");
        for (const child of node.childNodes) walk(child);
        parts.push("\n");
        return;
      }
      for (const child of node.childNodes) walk(child);
    };
    walk(root);
    return parts
      .join("")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }

  async function fetchAsDataUrl(src) {
    try {
      const res = await fetch(src, { credentials: "include" });
      if (!res.ok) return null;
      const blob = await res.blob();
      if (!blob || blob.size <= 0 || blob.size > maxImageBytes) return null;
      const mime = (blob.type || "image/png").split(";")[0].trim().toLowerCase();
      if (!mime.startsWith("image/")) return null;
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      return { mime, data: btoa(binary) };
    } catch {
      return null;
    }
  }

  async function addImage(src, alt) {
    const url = String(src || "").trim();
    if (!url || seen.has(url) || images.length >= maxImages) return;
    seen.add(url);
    const altText = String(alt || "").trim();
    if (url.startsWith("data:")) {
      const parsed = parseInlineDataUrl(url);
      if (parsed) {
        images.push({ alt: altText, mime: parsed.mime, dataBase64: parsed.data, url: "" });
      }
      return;
    }
    const fetched = await fetchAsDataUrl(url);
    if (fetched) {
      images.push({
        alt: altText,
        mime: fetched.mime,
        dataBase64: fetched.data,
        url: /^https?:\/\//i.test(url) ? url : "",
      });
      return;
    }
    if (/^https?:\/\//i.test(url)) {
      images.push({ alt: altText, mime: "", dataBase64: "", url });
    }
  }

  function backgroundUrls(el) {
    try {
      const bg = getComputedStyle(el).backgroundImage || "";
      const urls = [];
      const re = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
      let match = re.exec(bg);
      while (match) {
        const src = String(match[2] || "").trim();
        if (src && src !== "none") urls.push(src);
        match = re.exec(bg);
      }
      return urls;
    } catch {
      return [];
    }
  }

  function intersectsRange(el, range) {
    try {
      const er = document.createRange();
      er.selectNode(el);
      return (
        range.compareBoundaryPoints(Range.END_TO_START, er) < 0 &&
        range.compareBoundaryPoints(Range.START_TO_END, er) > 0
      );
    } catch {
      return true;
    }
  }

  async function collectFromElement(el) {
    if (!el || el.nodeType !== 1) return;
    const tag = String(el.tagName || "").toLowerCase();
    if (tag === "img") {
      const src = el.currentSrc || el.getAttribute("src") || el.src || "";
      await addImage(src, el.getAttribute("alt") || "");
    } else if (tag === "video") {
      await addImage(el.getAttribute("poster") || "", "视频封面");
    } else if (tag === "canvas") {
      try {
        await addImage(el.toDataURL("image/png"), "canvas");
      } catch {
        /* tainted canvas */
      }
    } else if (tag === "image") {
      const href = el.getAttribute("href") || el.getAttribute("xlink:href") || "";
      await addImage(href, "svg");
    }
    for (const src of backgroundUrls(el)) {
      await addImage(src, "");
    }
  }

  async function walkLive(el, range, isRoot) {
    if (!el || el.nodeType !== 1) return;
    if (!isRoot && !intersectsRange(el, range)) return;
    await collectFromElement(el);
    const kids = [];
    if (el.shadowRoot) kids.push(...el.shadowRoot.children);
    kids.push(...el.children);
    for (const child of kids) {
      await walkLive(child, range, false);
    }
  }

  if (captureMode === "viewport") {
    return {
      text: "",
      pageUrl,
      pageTitle,
      images,
      rect: viewportRect(),
    };
  }

  const sel = window.getSelection();
  let text = "";
  /** @type {{ x: number, y: number, width: number, height: number, dpr: number } | null} */
  let rect = null;
  if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
    const range = sel.getRangeAt(0);
    rect = clipRect(range.getBoundingClientRect());
    try {
      const fragment = range.cloneContents();
      const holder = document.createElement("div");
      holder.appendChild(fragment);
      text = toMarkdown(holder).slice(0, maxTextChars);
      if (!text) text = String(sel.toString() || "").slice(0, maxTextChars);
      const ancestor = range.commonAncestorContainer;
      const root =
        ancestor.nodeType === 1 ? ancestor : ancestor.parentElement || document.body;
      if (root) await walkLive(root, range, true);
    } catch {
      text = String(sel.toString() || "").slice(0, maxTextChars);
    }
  }

  const clicked = String(clickedImageSrc || "").trim();
  if (clicked) {
    await addImage(clicked, "");
  }

  return { text, pageUrl, pageTitle, images, rect };
}

/**
 * @param {{
 *   textPreview?: string,
 *   imageCount?: number,
 *   pageTitle?: string,
 *   hasScreenshot?: boolean,
 *   mode?: string
 * }} preview
 * @returns {Promise<{ cancelled: boolean, note: string }>}
 */
export function showWiseSelectionConfirm(preview) {
  const info = preview && typeof preview === "object" ? preview : {};
  const mode = String(info.mode || "selection") === "viewport" ? "viewport" : "selection";
  const imageCount = Math.max(0, Number(info.imageCount) || 0);
  const hasScreenshot = Boolean(info.hasScreenshot);
  const title = String(info.pageTitle || "").trim();
  const textPreview = String(info.textPreview || "").trim();

  return new Promise((resolve) => {
    document.getElementById("wise-page-monitor-confirm")?.remove();
    const host = document.createElement("div");
    host.id = "wise-page-monitor-confirm";
    host.setAttribute("data-wise-confirm", "1");
    Object.assign(host.style, {
      all: "initial",
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
    });
    const shadow = host.attachShadow({ mode: "closed" });
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <style>
        :host { all: initial; }
        .mask {
          position: fixed; inset: 0;
          background: rgba(15, 23, 42, .38);
          display: flex; align-items: flex-end; justify-content: center;
          font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          color: #0f172a;
        }
        .card {
          width: min(420px, calc(100vw - 24px));
          margin: 0 12px 16px;
          background: #fff;
          border-radius: 12px;
          box-shadow: 0 16px 48px rgba(15, 23, 42, .22);
          padding: 14px 14px 12px;
        }
        h2 { margin: 0 0 6px; font-size: 14px; }
        .meta { color: #64748b; font-size: 12px; margin-bottom: 8px; }
        .preview {
          max-height: 88px; overflow: auto; white-space: pre-wrap; word-break: break-word;
          background: #f8fafc; border-radius: 8px; padding: 8px; margin-bottom: 8px;
          color: #334155; font-size: 12px;
        }
        textarea {
          width: 100%; box-sizing: border-box; min-height: 72px; resize: vertical;
          border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px;
          font: inherit; color: inherit;
        }
        textarea:focus { outline: 2px solid #93c5fd; border-color: #3b82f6; }
        .row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 10px; }
        button {
          border: 0; border-radius: 8px; padding: 7px 12px; font: inherit; cursor: pointer;
        }
        .cancel { background: #e2e8f0; color: #0f172a; }
        .send { background: #15803d; color: #fff; }
      </style>
      <div class="mask">
        <div class="card" role="dialog" aria-modal="true" aria-labelledby="wise-confirm-title">
          <h2 id="wise-confirm-title">发送到 Wise 作为需求</h2>
          <div class="meta"></div>
          <div class="preview" hidden></div>
          <textarea placeholder="补充需求说明（可选），例如：按这个样式改登录按钮"></textarea>
          <div class="row">
            <button type="button" class="cancel">取消</button>
            <button type="button" class="send">发送</button>
          </div>
        </div>
      </div>
    `;
    shadow.appendChild(wrap);
    const meta = shadow.querySelector(".meta");
    const previewEl = shadow.querySelector(".preview");
    const textarea = shadow.querySelector("textarea");
    const bits = [];
    bits.push(mode === "viewport" ? "当前可见区域" : "当前选区");
    if (hasScreenshot) bits.push("含截图");
    if (imageCount > 0) bits.push(`${imageCount} 张图片`);
    if (title) bits.push(title);
    meta.textContent = bits.join(" · ");
    if (textPreview) {
      previewEl.hidden = false;
      previewEl.textContent = textPreview.length > 280 ? `${textPreview.slice(0, 279)}…` : textPreview;
    }
    const finish = (cancelled) => {
      window.removeEventListener("keydown", onKey, true);
      host.remove();
      resolve({ cancelled, note: cancelled ? "" : String(textarea.value || "").trim() });
    };
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(true);
      } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        finish(false);
      }
    };
    shadow.querySelector(".cancel")?.addEventListener("click", () => finish(true));
    shadow.querySelector(".send")?.addEventListener("click", () => finish(false));
    shadow.querySelector(".mask")?.addEventListener("click", (event) => {
      if (event.target?.classList?.contains("mask")) finish(true);
    });
    window.addEventListener("keydown", onKey, true);
    document.documentElement.appendChild(host);
    textarea?.focus();
  });
}

/**
 * @param {string} message
 * @param {boolean} ok
 */
export function showWisePageToast(message, ok) {
  const id = "wise-page-monitor-toast";
  document.getElementById(id)?.remove();
  const el = document.createElement("div");
  el.id = id;
  el.textContent = String(message || "");
  el.setAttribute("role", "status");
  Object.assign(el.style, {
    position: "fixed",
    right: "16px",
    bottom: "16px",
    zIndex: "2147483647",
    maxWidth: "320px",
    padding: "10px 12px",
    borderRadius: "8px",
    font: '13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    color: "#fff",
    background: ok ? "#15803d" : "#b45309",
    boxShadow: "0 8px 24px rgba(0,0,0,.18)",
  });
  document.documentElement.appendChild(el);
  window.setTimeout(() => el.remove(), 2800);
}

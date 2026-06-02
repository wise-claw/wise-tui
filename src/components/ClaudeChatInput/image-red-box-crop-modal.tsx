import { useCallback, useEffect, useRef, useState } from "react";
import { Modal, Button, Segmented } from "antd";
import type { ImageAttachmentPart } from "../../types";

export type ImageRedBoxCropModalProps = {
  open: boolean;
  image: ImageAttachmentPart | null;
  onClose: () => void;
  /** 用编辑后的图替换原附件（保留 id） */
  onApply: (next: ImageAttachmentPart) => void;
};

type Pt = { x: number; y: number };

type EditMode = "crop" | "rect" | "line";

/** natural 像素中的矩形描边 */
type NatRect = { sx: number; sy: number; sw: number; sh: number };
/** natural 像素中的折线路径 */
type NatStroke = { points: Pt[] };

function containedMetrics(img: HTMLImageElement) {
  const nw = img.naturalWidth || 1;
  const nh = img.naturalHeight || 1;
  const rw = img.clientWidth;
  const rh = img.clientHeight;
  const scale = Math.min(rw / nw, rh / nh);
  const dw = nw * scale;
  const dh = nh * scale;
  const ox = (rw - dw) / 2;
  const oy = (rh - dh) / 2;
  return { nw, nh, scale, ox, oy, dw, dh };
}

/** 将两次指针位置（视口坐标）转为 natural 像素矩形；选区过小返回 null */
function clientPointsToNaturalRect(
  img: HTMLImageElement,
  p0: Pt,
  p1: Pt,
  minDisplayEdge = 4,
  minNaturalEdge = 2,
): NatRect | null {
  const br = img.getBoundingClientRect();
  const { nw, nh, scale, ox, oy, dw, dh } = containedMetrics(img);
  const ax = Math.min(p0.x, p1.x) - br.left - ox;
  const ay = Math.min(p0.y, p1.y) - br.top - oy;
  const bx = Math.max(p0.x, p1.x) - br.left - ox;
  const by = Math.max(p0.y, p1.y) - br.top - oy;
  const ix = Math.max(0, Math.min(dw, ax));
  const iy = Math.max(0, Math.min(dh, ay));
  const jx = Math.max(0, Math.min(dw, bx));
  const jy = Math.max(0, Math.min(dh, by));
  const iw = jx - ix;
  const ih = jy - iy;
  if (iw < minDisplayEdge || ih < minDisplayEdge) return null;
  const sx = Math.floor(ix / scale);
  const sy = Math.floor(iy / scale);
  const sw = Math.min(nw - sx, Math.ceil(iw / scale));
  const sh = Math.min(nh - sy, Math.ceil(ih / scale));
  if (sw < minNaturalEdge || sh < minNaturalEdge) return null;
  return { sx, sy, sw, sh };
}

function wrapToNaturalClamped(img: HTMLImageElement, wrap: HTMLElement, pw: Pt): Pt {
  const br = img.getBoundingClientRect();
  const wr = wrap.getBoundingClientRect();
  const clientX = wr.left + pw.x;
  const clientY = wr.top + pw.y;
  const { scale, ox, oy, dw, dh } = containedMetrics(img);
  let ax = clientX - br.left - ox;
  let ay = clientY - br.top - oy;
  ax = Math.max(0, Math.min(dw, ax));
  ay = Math.max(0, Math.min(dh, ay));
  return { x: ax / scale, y: ay / scale };
}

function natRectToStyle(img: HTMLImageElement, r: NatRect): React.CSSProperties {
  const { scale, ox, oy } = containedMetrics(img);
  return {
    position: "absolute" as const,
    left: ox + r.sx * scale,
    top: oy + r.sy * scale,
    width: r.sw * scale,
    height: r.sh * scale,
    border: "2px solid #f5222d",
    boxSizing: "border-box",
    pointerEvents: "none",
    zIndex: 2,
  };
}

function strokeWrapPoints(img: HTMLImageElement, s: NatStroke): string {
  const { scale, ox, oy } = containedMetrics(img);
  return s.points.map((p) => `${ox + p.x * scale},${oy + p.y * scale}`).join(" ");
}

function strokeLineWidthPx(img: HTMLImageElement): number {
  const { nw, nh, scale } = containedMetrics(img);
  const base = Math.max(2, Math.round(Math.min(nw, nh) / 320));
  return Math.max(2, base * scale);
}

function renderAnnotationsToCanvas(
  img: HTMLImageElement,
  rects: NatRect[],
  strokes: NatStroke[],
): string | null {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (!nw || !nh) return null;
  const canvas = document.createElement("canvas");
  canvas.width = nw;
  canvas.height = nh;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, nw, nh);
  const lw = Math.max(2, Math.round(Math.min(nw, nh) / 320));
  ctx.strokeStyle = "#f5222d";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = lw;
  for (const r of rects) {
    const inset = lw / 2;
    ctx.strokeRect(r.sx + inset, r.sy + inset, Math.max(0, r.sw - lw), Math.max(0, r.sh - lw));
  }
  for (const s of strokes) {
    if (s.points.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(s.points[0].x, s.points[0].y);
    for (let i = 1; i < s.points.length; i++) {
      ctx.lineTo(s.points[i].x, s.points[i].y);
    }
    ctx.stroke();
  }
  return canvas.toDataURL("image/png");
}

export function ImageRedBoxCropModal({ open, image, onClose, onApply }: ImageRedBoxCropModalProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [mode, setMode] = useState<EditMode>("crop");

  const [dragging, setDragging] = useState(false);
  const [a, setA] = useState<Pt | null>(null);
  const [b, setB] = useState<Pt | null>(null);
  const [clientA, setClientA] = useState<Pt | null>(null);
  const [clientB, setClientB] = useState<Pt | null>(null);

  const [rectAnnots, setRectAnnots] = useState<NatRect[]>([]);
  const [lineStrokes, setLineStrokes] = useState<NatStroke[]>([]);
  const [linePointsWrap, setLinePointsWrap] = useState<Pt[]>([]);
  /** 划线拖拽中同步累积，避免 pointerup 读到过时的 state */
  const linePointsWrapRef = useRef<Pt[]>([]);

  const toWrap = useCallback((e: React.PointerEvent) => {
    const w = wrapRef.current?.getBoundingClientRect();
    if (!w) return { x: 0, y: 0 };
    return { x: e.clientX - w.left, y: e.clientY - w.top };
  }, []);

  const toClient = useCallback((p: Pt): Pt => {
    const w = wrapRef.current?.getBoundingClientRect();
    if (!w) return p;
    return { x: w.left + p.x, y: w.top + p.y };
  }, []);

  useEffect(() => {
    if (!open) {
      setMode("crop");
      setDragging(false);
      setA(null);
      setB(null);
      setClientA(null);
      setClientB(null);
      setRectAnnots([]);
      setLineStrokes([]);
      setLinePointsWrap([]);
      linePointsWrapRef.current = [];
    }
  }, [open, image?.id]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const img = imgRef.current;
    const wrap = wrapRef.current;
    if (!img?.complete || img.naturalWidth === 0 || !wrap) return;
    const p = toWrap(e);
    if (mode === "line") {
      setDragging(true);
      linePointsWrapRef.current = [p];
      setLinePointsWrap([p]);
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    setDragging(true);
    setA(toClient(p));
    setB(toClient(p));
    setClientA(p);
    setClientB(p);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const img = imgRef.current;
    const wrap = wrapRef.current;
    if (!img || !wrap) return;
    const p = toWrap(e);
    if (mode === "line") {
      const cur = linePointsWrapRef.current;
      if (cur.length === 0) {
        linePointsWrapRef.current = [p];
        setLinePointsWrap([p]);
        return;
      }
      const last = cur[cur.length - 1];
      const dx = p.x - last.x;
      const dy = p.y - last.y;
      if (dx * dx + dy * dy < 4) return;
      const next = [...cur, p];
      linePointsWrapRef.current = next;
      setLinePointsWrap(next);
      return;
    }
    setClientB(p);
    setB(toClient(p));
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const img = imgRef.current;
    const wrap = wrapRef.current;
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* 已释放 */
    }
    if (mode === "rect" && img && wrap && a && b) {
      const nr = clientPointsToNaturalRect(img, a, b, 3, 1);
      if (nr) {
        setRectAnnots((prev) => [...prev, nr]);
      }
      setA(null);
      setB(null);
      setClientA(null);
      setClientB(null);
    }
    if (mode === "line" && img && wrap) {
      const wrapPts = linePointsWrapRef.current;
      if (wrapPts.length === 0) return;
      const natPts: Pt[] = wrapPts.map((q) => wrapToNaturalClamped(img, wrap, q));
      const dedup: Pt[] = [];
      for (const q of natPts) {
        const prev = dedup[dedup.length - 1];
        if (!prev || Math.hypot(q.x - prev.x, q.y - prev.y) > 0.5) dedup.push(q);
      }
      if (dedup.length >= 2) {
        setLineStrokes((prev) => [...prev, { points: dedup }]);
      }
      linePointsWrapRef.current = [];
      setLinePointsWrap([]);
    }
  };

  const clearCropSelection = () => {
    setA(null);
    setB(null);
    setClientA(null);
    setClientB(null);
  };

  const clearAllAnnots = () => {
    setRectAnnots([]);
    setLineStrokes([]);
    linePointsWrapRef.current = [];
    setLinePointsWrap([]);
  };

  const undoLastAnnot = () => {
    if (lineStrokes.length > 0) {
      setLineStrokes((prev) => prev.slice(0, -1));
      return;
    }
    if (rectAnnots.length > 0) {
      setRectAnnots((prev) => prev.slice(0, -1));
    }
  };

  const handleApplyCrop = () => {
    const img = imgRef.current;
    if (!img || !image) return;
    if (!a || !b) {
      return;
    }
    const crop = clientPointsToNaturalRect(img, a, b, 4, 2);
    if (!crop) {
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = crop.sw;
    canvas.height = crop.sh;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, crop.sw, crop.sh);
    const outMime = "image/png";
    const dataUrl = canvas.toDataURL(outMime);
    const base = image.filename.replace(/\.[^.]+$/, "") || "image";
    const next: ImageAttachmentPart = {
      ...image,
      filename: `${base}_crop.png`,
      mime: outMime,
      dataUrl,
    };
    onApply(next);
    onClose();
    clearCropSelection();
  };

  const handleApplyAnnot = () => {
    const img = imgRef.current;
    if (!img || !image) return;
    if (rectAnnots.length === 0 && lineStrokes.length === 0) {
      return;
    }
    const dataUrl = renderAnnotationsToCanvas(img, rectAnnots, lineStrokes);
    if (!dataUrl) {
      return;
    }
    const base = image.filename.replace(/\.[^.]+$/, "") || "image";
    const next: ImageAttachmentPart = {
      ...image,
      filename: `${base}_annot.png`,
      mime: "image/png",
      dataUrl,
    };
    onApply(next);
    onClose();
    clearAllAnnots();
    clearCropSelection();
  };

  const redBoxPreview =
    clientA && clientB && (mode === "crop" || mode === "rect") ? (
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: Math.min(clientA.x, clientB.x),
          top: Math.min(clientA.y, clientB.y),
          width: Math.abs(clientB.x - clientA.x),
          height: Math.abs(clientB.y - clientA.y),
          border: "2px solid #f5222d",
          boxSizing: "border-box",
          pointerEvents: "none",
          zIndex: 2,
        }}
      />
    ) : null;

  const imgEl = imgRef.current;
  const committedRects =
    imgEl && rectAnnots.length > 0
      ? rectAnnots.map((r, i) => <div key={`r-${i}`} aria-hidden style={natRectToStyle(imgEl, r)} />)
      : null;

  const linePreviewSvg =
    imgEl && linePointsWrap.length >= 2 ? (
      <svg
        aria-hidden
        style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 3 }}
        width={imgEl.clientWidth}
        height={imgEl.clientHeight}
      >
        <polyline
          fill="none"
          stroke="#f5222d"
          strokeWidth={strokeLineWidthPx(imgEl)}
          strokeLinecap="round"
          strokeLinejoin="round"
          points={linePointsWrap.map((p) => `${p.x},${p.y}`).join(" ")}
        />
      </svg>
    ) : null;

  const committedLines =
    imgEl && lineStrokes.length > 0 ? (
      <svg
        aria-hidden
        style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 3 }}
        width={imgEl.clientWidth}
        height={imgEl.clientHeight}
      >
        {lineStrokes.map((s, i) => (
          <polyline
            key={`s-${i}`}
            fill="none"
            stroke="#f5222d"
            strokeWidth={strokeLineWidthPx(imgEl)}
            strokeLinecap="round"
            strokeLinejoin="round"
            points={strokeWrapPoints(imgEl, s)}
          />
        ))}
      </svg>
    ) : null;

  const hint =
    mode === "crop"
      ? "在图片上按住左键拖动，用红框圈选要保留的区域，然后点「应用裁剪」。"
      : mode === "rect"
        ? "每次按住左键拖动画一个红框标注；可画多个。完成后点「应用标注」将标注合成到图片。"
        : "按住左键拖动绘制红色线条；可多次绘制。完成后点「应用标注」。";

  const footer =
    mode === "crop"
      ? [
          <Button key="clear" onClick={clearCropSelection}>
            清除选区
          </Button>,
          <Button key="cancel" onClick={onClose}>
            取消
          </Button>,
          <Button key="ok" type="primary" onClick={handleApplyCrop}>
            应用裁剪
          </Button>,
        ]
      : [
          <Button key="undo" onClick={undoLastAnnot} disabled={rectAnnots.length === 0 && lineStrokes.length === 0}>
            撤销上一笔
          </Button>,
          <Button key="clearA" onClick={clearAllAnnots} disabled={rectAnnots.length === 0 && lineStrokes.length === 0}>
            清空标注
          </Button>,
          <Button key="cancel" onClick={onClose}>
            取消
          </Button>,
          <Button key="ok" type="primary" onClick={handleApplyAnnot}>
            应用标注
          </Button>,
        ];

  return (
    <Modal
      title="编辑图片"
      open={open}
      onCancel={onClose}
      destroyOnHidden
      width="min(92vw, 920px)"
      footer={footer}
    >
      <div style={{ marginBottom: 12 }}>
        <Segmented<EditMode>
          value={mode}
          onChange={(v) => {
            setMode(v);
            setDragging(false);
            clearCropSelection();
            linePointsWrapRef.current = [];
            setLinePointsWrap([]);
          }}
          options={[
            { label: "裁剪", value: "crop" },
            { label: "红框标注", value: "rect" },
            { label: "划线", value: "line" },
          ]}
        />
      </div>
      <p style={{ marginTop: 0, marginBottom: 12, color: "var(--ant-color-text-secondary)", fontSize: 13 }}>{hint}</p>
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: 120,
          maxHeight: "58vh",
          overflow: "auto",
          background: "var(--ant-color-fill-quaternary)",
          borderRadius: 8,
          padding: 12,
        }}
      >
        {image ? (
          <div
            ref={wrapRef}
            style={{
              position: "relative",
              display: "inline-block",
              maxWidth: "100%",
              maxHeight: "52vh",
              lineHeight: 0,
            }}
          >
            <img
              ref={imgRef}
              src={image.dataUrl}
              alt={image.filename}
              draggable={false}
              style={{
                display: "block",
                maxWidth: "min(85vw, 860px)",
                maxHeight: "52vh",
                width: "auto",
                height: "auto",
                objectFit: "contain",
                userSelect: "none",
              }}
            />
            {committedRects}
            {committedLines}
            {redBoxPreview}
            {linePreviewSvg}
            <div
              role="presentation"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              style={{
                position: "absolute",
                inset: 0,
                cursor: "crosshair",
                touchAction: "none",
                zIndex: 5,
              }}
            />
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

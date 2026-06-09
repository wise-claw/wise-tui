import { useCallback, useEffect, useState } from "react";
import { HoverHint } from "../shared/HoverHint";
import { Button } from "antd";
import {
  ZoomInOutlined,
  ZoomOutOutlined,
  RotateLeftOutlined,
  RotateRightOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import "./index.css";

// ── Types ──

interface Props {
  src: string;
  alt: string;
}

// ── Constants ──

const SCALE_MIN = 0.2;
const SCALE_MAX = 5;
const SCALE_STEP = 0.15;
const SCALE_WHEEL_FACTOR = 1.08;

// ── Main Component ──

export function RepositoryImagePreview({ src, alt }: Props) {
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    setScale(1);
    setRotation(0);
  }, [src]);

  const zoomIn = useCallback(() => {
    setScale((s) => Math.min(SCALE_MAX, Math.round((s + SCALE_STEP) * 100) / 100));
  }, []);

  const zoomOut = useCallback(() => {
    setScale((s) => Math.max(SCALE_MIN, Math.round((s - SCALE_STEP) * 100) / 100));
  }, []);

  const resetView = useCallback(() => {
    setScale(1);
    setRotation(0);
  }, []);

  const rotateLeft = useCallback(() => {
    setRotation((r) => (r - 90 + 360) % 360);
  }, []);

  const rotateRight = useCallback(() => {
    setRotation((r) => (r + 90) % 360);
  }, []);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }
    event.preventDefault();
    const factor = event.deltaY < 0 ? SCALE_WHEEL_FACTOR : 1 / SCALE_WHEEL_FACTOR;
    setScale((s) => {
      const next = s * factor;
      return Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(next * 100) / 100));
    });
  }, []);

  const scalePct = Math.round(scale * 100);

  return (
    <div className="app-repository-image-preview-root">
      <div className="app-repository-image-preview-toolbar">
        <HoverHint title="缩小">
          <Button type="text" size="small" icon={<ZoomOutOutlined />} onClick={zoomOut} aria-label="缩小" />
        </HoverHint>
        <span className="app-repository-image-preview-scale">{scalePct}%</span>
        <HoverHint title="放大">
          <Button type="text" size="small" icon={<ZoomInOutlined />} onClick={zoomIn} aria-label="放大" />
        </HoverHint>
        <HoverHint title="逆时针旋转 90°">
          <Button
            type="text"
            size="small"
            icon={<RotateLeftOutlined />}
            onClick={rotateLeft}
            aria-label="逆时针旋转"
          />
        </HoverHint>
        <HoverHint title="顺时针旋转 90°">
          <Button
            type="text"
            size="small"
            icon={<RotateRightOutlined />}
            onClick={rotateRight}
            aria-label="顺时针旋转"
          />
        </HoverHint>
        <HoverHint title="重置缩放与旋转">
          <Button type="text" size="small" icon={<UndoOutlined />} onClick={resetView} aria-label="重置视图" />
        </HoverHint>
      </div>
      <div
        className="app-repository-image-preview-stage"
        onWheel={handleWheel}
        role="region"
        aria-label="图片预览区域，可滚动查看放大后的内容"
        tabIndex={0}
      >
        <div
          className="app-repository-image-preview-transform"
          style={{
            transform: `rotate(${rotation}deg) scale(${scale})`,
            transformOrigin: "center center",
          }}
        >
          <img src={src} alt={alt} className="app-repository-image-preview-img" draggable={false} />
        </div>
      </div>
      <p className="app-repository-image-preview-hint">在预览区域内按住 ⌘ 或 Ctrl 并滚动滚轮可缩放</p>
    </div>
  );
}

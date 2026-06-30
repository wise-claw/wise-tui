import { Button, InputNumber } from "antd";
import { CloseOutlined, CheckOutlined, PlusOutlined, MinusOutlined } from "@ant-design/icons";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
} from "react";

const BAR_COUNT = 12;
/** 柱条最小可见高度（相对柱容器高度的比例），让静音态仍有底线。 */
const MIN_BAR_RATIO = 0.18;
/** 柱条最大高度比例。 */
const MAX_BAR_RATIO = 1;
/** 监听状态下的电平衰减系数：避免波形长时间停在峰值。 */
const LISTEN_DECAY = 0.85;
/** 转写/整理中脉冲动效周期（ms）。 */
const POLISH_PULSE_PERIOD_MS = 900;
/** rAF 节流上限（ms）。约 60fps。 */
const FRAME_INTERVAL_MS = 1000 / 60;

/** 手动脉冲度默认范围（毫秒）。与 `composerSpeechPreferences` 的 MIN/MAX 双向同步。 */
const MANUAL_IDLE_MS_MIN = 400;
const MANUAL_IDLE_MS_MAX = 10_000;
const MANUAL_IDLE_MS_STEP = 100;

export type ComposerVoiceBubblePhase = "idle" | "listening" | "transcribing" | "polishing";

export interface ComposerVoiceDictationBubbleProps {
  /** 是否在听写中，决定圆点颜色与柱条是否随电平起伏。 */
  phase: ComposerVoiceBubblePhase;
  /** 0..1 区间电平，由 useComposerSpeechLevelMeter 暴露的 ref.current 读取。 */
  levelRef: MutableRefObject<number>;
  /** 段实时草稿；仅展示用。 */
  previewText: string;
  /** 取消当前听写（保留当前整理入框行为 = 直接丢弃，不发 final）。 */
  onCancel: () => void;
  /** 立即转写并停止当前段（继续保留 listening=false，与 toggle 的"按一下停"语义对齐）。 */
  onFinalizeNow: () => void;
  /** 当前手动脉冲度（毫秒），在气泡里调节后透出。默认 1000ms。 */
  manualSegmentIdleMs: number;
  /** 用户调节脉冲度（毫秒）时回调。父级负责持久化与写回 prefs。 */
  onManualSegmentIdleChange: (ms: number) => void;
}

interface BarState {
  current: number;
  target: number;
}

function isReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * 听写中浮层。取代 composer-region.tsx 内的静态"听写中"气泡：
 * - 听写中：12 根柱条随电平起伏
 * - 转写/整理中：脉冲动效 + 圆点变黄
 * - 隐藏状态：null（受 phase 控制）
 *
 * 性能：组件内部 rAF 循环读 `levelRef.current`，避免 React 重渲染。
 */
export function ComposerVoiceDictationBubble({
  phase,
  levelRef,
  previewText,
  onCancel,
  onFinalizeNow,
  manualSegmentIdleMs,
  onManualSegmentIdleChange,
}: ComposerVoiceDictationBubbleProps) {
  const [heights, setHeights] = useState<number[]>(() =>
    Array.from({ length: BAR_COUNT }, () => MIN_BAR_RATIO),
  );
  const [hover, setHover] = useState(false);
  const rafRef = useRef<number | null>(null);
  const barsStateRef = useRef<BarState[]>(
    Array.from({ length: BAR_COUNT }, () => ({ current: MIN_BAR_RATIO, target: MIN_BAR_RATIO })),
  );
  const reducedMotion = useMemo(() => isReducedMotion(), []);

  // 主循环：rAF 内根据 phase 决定渲染策略
  useEffect(() => {
    if (phase === "idle") {
      // 重置柱条到最小，避免下次显示时还残留上次峰值
      barsStateRef.current = Array.from({ length: BAR_COUNT }, () => ({
        current: MIN_BAR_RATIO,
        target: MIN_BAR_RATIO,
      }));
      setHeights(Array.from({ length: BAR_COUNT }, () => MIN_BAR_RATIO));
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }

    let lastFrameAt = 0;
    let pulseStartedAt = performance.now();
    const tick = (now: number) => {
      if (now - lastFrameAt < FRAME_INTERVAL_MS) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      lastFrameAt = now;

      if (phase === "listening" && !reducedMotion) {
        const level = Math.max(0, Math.min(1, levelRef.current ?? 0));
        // 把"整段电平"映射为 12 根柱的目标振幅；靠近中心的略高、两侧稍弱
        const next = barsStateRef.current.map((bar, idx) => {
          const distance = Math.abs(idx - (BAR_COUNT - 1) / 2) / ((BAR_COUNT - 1) / 2);
          const local = Math.max(0, level - distance * 0.35);
          const jitter = (Math.sin(now / 110 + idx * 1.3) + 1) * 0.06;
          const target = Math.max(
            MIN_BAR_RATIO,
            Math.min(MAX_BAR_RATIO, local * 1.6 + jitter),
          );
          return {
            current: bar.current * LISTEN_DECAY + target * (1 - LISTEN_DECAY),
            target,
          };
        });
        barsStateRef.current = next;
        setHeights(next.map((b) => b.current));
      } else if (phase === "transcribing" || phase === "polishing") {
        // 脉冲动效：从中心向外扩散的"呼吸"
        const elapsed = now - pulseStartedAt;
        const phase01 = (elapsed % POLISH_PULSE_PERIOD_MS) / POLISH_PULSE_PERIOD_MS;
        const next = barsStateRef.current.map((_, idx) => {
          const distance = Math.abs(idx - (BAR_COUNT - 1) / 2) / ((BAR_COUNT - 1) / 2);
          const localPhase = (phase01 + distance * 0.4) % 1;
          const v = Math.sin(localPhase * Math.PI * 2) * 0.5 + 0.5;
          return {
            current: v,
            target: v,
          };
        });
        barsStateRef.current = next;
        setHeights(next.map((b) => b.current));
      } else if (reducedMotion && phase === "listening") {
        // 退化：等高柱条
        const level = Math.max(0, Math.min(1, levelRef.current ?? 0));
        const h = MIN_BAR_RATIO + level * (MAX_BAR_RATIO - MIN_BAR_RATIO);
        const next = barsStateRef.current.map(() => ({ current: h, target: h }));
        barsStateRef.current = next;
        setHeights(next.map((b) => b.current));
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [levelRef, phase, reducedMotion]);

  const statusText = useMemo(() => {
    if (phase === "polishing") return "整理中…";
    if (phase === "transcribing") return "转写中…";
    if (phase === "listening") return previewText.trim() ? previewText : "请说话…";
    return "";
  }, [phase, previewText]);

  const dotColor = useMemo(() => {
    if (phase === "polishing" || phase === "transcribing") {
      return "var(--ant-color-warning, #d89614)";
    }
    return "var(--ant-color-error, #dc4446)";
  }, [phase]);

  const handleFinalizeNow = useCallback(() => {
    onFinalizeNow();
  }, [onFinalizeNow]);

  // 将外部毫秒值按 100ms 步进封箱，避免反复抖动；区间被用户偏好 normalize 工具覆盖。
  const handleIdleMsChange = useCallback(
    (next: number | null) => {
      if (next == null || !Number.isFinite(next)) return;
      const stepped = Math.round(next / MANUAL_IDLE_MS_STEP) * MANUAL_IDLE_MS_STEP;
      const clamped = Math.min(MANUAL_IDLE_MS_MAX, Math.max(MANUAL_IDLE_MS_MIN, stepped));
      if (clamped === manualSegmentIdleMs) return;
      onManualSegmentIdleChange(clamped);
    },
    [manualSegmentIdleMs, onManualSegmentIdleChange],
  );

  const idleSecLabel = useMemo(
    () => (manualSegmentIdleMs / 1000).toFixed(Math.abs(manualSegmentIdleMs % 1000) === 0 ? 0 : 1),
    [manualSegmentIdleMs],
  );

  if (phase === "idle") return null;

  const bubbleStyle: CSSProperties = {
    position: "absolute",
    bottom: "calc(100% + 6px)",
    left: 0,
    zIndex: 20,
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 12px",
    borderRadius: 12,
    backgroundColor: "var(--ant-color-bg-container, #ffffff)",
    border: "1px solid var(--ant-color-border-secondary)",
    boxShadow: "var(--ant-box-shadow-secondary, 0 6px 16px rgba(0,0,0,0.16))",
    fontSize: 12,
    lineHeight: 1.45,
    color: "var(--ant-color-text)",
    minWidth: 280,
    maxWidth: 420,
    transform: "translateZ(0)",
    isolation: "isolate",
  };

  return (
    <div
      className="app-claude-composer-voice-preview"
      role="status"
      aria-live="polite"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={bubbleStyle}
    >
      <span
        aria-hidden
        style={{
          flex: "0 0 auto",
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: dotColor,
          boxShadow: `0 0 0 4px color-mix(in srgb, ${dotColor} 18%, transparent)`,
          animation:
            phase === "listening" ? "app-voice-dot-pulse 1.2s ease-in-out infinite" : undefined,
        }}
      />
      <div
        style={{
          flex: "0 0 auto",
          display: "flex",
          alignItems: "center",
          gap: 2,
          height: 24,
        }}
        aria-hidden
      >
        {heights.map((h, idx) => (
          <span
            // eslint-disable-next-line react/no-array-index-key
            key={idx}
            style={{
              display: "inline-block",
              width: 3,
              height: `${Math.round(h * 22) + 2}px`,
              borderRadius: 2,
              background:
                phase === "transcribing" || phase === "polishing"
                  ? "var(--ant-color-warning, #d89614)"
                  : "var(--ant-color-primary, #1677ff)",
              opacity: phase === "listening" ? 0.85 : 0.9,
              transition: reducedMotion ? "none" : "height 60ms ease-out",
            }}
          />
        ))}
      </div>
      <div
        style={{
          flex: "1 1 auto",
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        <span
          style={{
            color: "var(--ant-color-text-secondary, rgba(255,255,255,0.65))",
            fontSize: 11,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {phase === "polishing"
            ? "整理中…"
            : phase === "transcribing"
              ? "转写中…"
              : "听写中"}
        </span>
        <span
          style={{
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: 40,
            overflow: "hidden",
            color: "var(--ant-color-text)",
          }}
        >
          {statusText}
        </span>
      </div>
      <div
        style={{
          flex: "0 0 auto",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 2,
        }}
        aria-label="停顿时长"
      >
        <span
          aria-hidden
          style={{
            color: "var(--ant-color-text-secondary, rgba(255,255,255,0.65))",
            fontSize: 10,
            lineHeight: 1.2,
            whiteSpace: "nowrap",
          }}
        >
          停顿 {idleSecLabel}s 转整理
        </span>
        <InputNumber
          size="small"
          value={manualSegmentIdleMs}
          min={MANUAL_IDLE_MS_MIN}
          max={MANUAL_IDLE_MS_MAX}
          step={MANUAL_IDLE_MS_STEP}
          controls={{ upIcon: <PlusOutlined />, downIcon: <MinusOutlined /> }}
          disabled={phase === "transcribing" || phase === "polishing"}
          onChange={handleIdleMsChange}
          aria-label="停顿毫秒"
          title="停顿毫秒（转整理等待时长，默认 1000ms）"
          style={{ width: 96 }}
          suffix="ms"
        />
      </div>
      <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 4 }}>
        <Button
          size="small"
          type="text"
          icon={<CheckOutlined />}
          onClick={handleFinalizeNow}
          disabled={phase === "transcribing" || phase === "polishing"}
          aria-label="立即转写并结束本段"
          title="立即转写并结束本段"
        />
        <Button
          size="small"
          type="text"
          danger={hover}
          icon={<CloseOutlined />}
          onClick={onCancel}
          aria-label="取消听写"
          title="取消听写"
        />
      </div>
    </div>
  );
}

// CSS keyframes（注入在 ComposerChatInput 所在 CSS 文件中）：
// @keyframes app-voice-dot-pulse {
//   0%, 100% { transform: scale(1); opacity: 1; }
//   50% { transform: scale(1.18); opacity: 0.7; }
// }
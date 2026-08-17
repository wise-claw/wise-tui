import { useEffect, type RefObject } from "react";

const SPIN_KEYFRAMES: Keyframe[] = [
  { transform: "rotate(0deg)" },
  { transform: "rotate(360deg)" },
];

/**
 * 左栏列表会按「执行中置顶 / 最近活跃」重排；WebKit（Tauri macOS/Linux）移动 DOM 节点时
 * 会重启甚至冻结 CSS `animation`，多会话运行时转圈会出现「转不动 / 闪帧」。
 * 用 Web Animations API 把旋转挂在元素上：DOM 移动不会重启动画。
 * 旧引擎不支持 `element.animate` 时保持原有 CSS `--spin` 动画兜底。
 */
export function useElementInfiniteSpin(
  ref: RefObject<SVGSVGElement | null>,
  durationMs = 750,
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== "function") return;
    const prefersReducedMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    if (prefersReducedMotion) return;
    // 禁用样式表中的 CSS 动画，避免与 WAAPI 同时跑并在 DOM 移动时重启。
    el.style.animation = "none";
    const animation = el.animate(SPIN_KEYFRAMES, {
      duration: durationMs,
      iterations: Infinity,
      easing: "linear",
    });
    return () => {
      animation.cancel();
      el.style.animation = "";
    };
  }, [durationMs, ref]);
}

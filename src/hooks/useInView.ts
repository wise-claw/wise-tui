import { useEffect, useRef, useState, type RefObject } from "react";

/** 元素进入视口（含 rootMargin）后返回 true，用于懒加载 Git / 文件树。 */
export function useInView(
  rootMargin = "120px",
  enabled = true,
): [RefObject<HTMLElement | null>, boolean] {
  const ref = useRef<HTMLElement | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setInView(false);
      return;
    }
    const el = ref.current;
    if (!el || inView) return;

    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled, inView, rootMargin]);

  return [ref, enabled ? inView : false];
}

/** 双向视口检测：离开视口时返回 false，便于卸载大对象。 */
export function useInViewActive(
  rootMargin = "120px",
  enabled = true,
): [RefObject<HTMLElement | null>, boolean] {
  const ref = useRef<HTMLElement | null>(null);
  const [inView, setInView] = useState(false);
  const observerInViewRef = useRef(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) {
      observerInViewRef.current = false;
      setInView(false);
      return;
    }
    const el = ref.current;
    if (!el) return;

    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }

    const commitInView = (next: boolean) => {
      if (debounceTimerRef.current != null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      const delayMs = next ? 80 : 650;
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        setInView(observerInViewRef.current);
      }, delayMs);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        const next = entries.some((entry) => entry.isIntersecting);
        if (next === observerInViewRef.current) return;
        observerInViewRef.current = next;
        commitInView(next);
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (debounceTimerRef.current != null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [enabled, rootMargin]);

  return [ref, enabled ? inView : false];
}

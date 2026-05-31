import { useCallback, useEffect, useRef, useState, type Ref } from "react";

type InViewRoot = Element | null;

function parseRootMarginPx(margin: string): { top: number; right: number; bottom: number; left: number } {
  const parts = margin.trim().split(/\s+/).map((part) => Number.parseFloat(part) || 0);
  if (parts.length === 1) {
    const value = parts[0]!;
    return { top: value, right: value, bottom: value, left: value };
  }
  if (parts.length === 2) {
    return { top: parts[0]!, right: parts[1]!, bottom: parts[0]!, left: parts[1]! };
  }
  if (parts.length === 4) {
    return { top: parts[0]!, right: parts[1]!, bottom: parts[2]!, left: parts[3]! };
  }
  return { top: 120, right: 120, bottom: 120, left: 120 };
}

function rectsIntersect(
  target: DOMRect,
  bounds: { top: number; left: number; bottom: number; right: number },
): boolean {
  return (
    target.bottom > bounds.top &&
    target.top < bounds.bottom &&
    target.right > bounds.left &&
    target.left < bounds.right
  );
}

/** 同步判断元素是否在 root（或视口）+ rootMargin 范围内；IO 初始回调可能缺失，需主动探测。 */
export function isElementInScrollRoot(
  el: Element,
  root: InViewRoot,
  rootMargin = "120px",
): boolean {
  const targetRect = el.getBoundingClientRect();
  const margin = parseRootMarginPx(rootMargin);
  if (!root) {
    return rectsIntersect(targetRect, {
      top: -margin.top,
      left: -margin.left,
      bottom: window.innerHeight + margin.bottom,
      right: window.innerWidth + margin.right,
    });
  }
  const rootRect = root.getBoundingClientRect();
  return rectsIntersect(targetRect, {
    top: rootRect.top - margin.top,
    left: rootRect.left - margin.left,
    bottom: rootRect.bottom + margin.bottom,
    right: rootRect.right + margin.right,
  });
}

function useObservedElementRef(): [Ref<HTMLElement | null>, HTMLElement | null] {
  const ref = useRef<HTMLElement | null>(null);
  const [element, setElement] = useState<HTMLElement | null>(null);
  const setRef = useCallback((node: HTMLElement | null) => {
    ref.current = node;
    setElement(node);
  }, []);
  return [setRef, element];
}

/** 元素进入视口（含 rootMargin）后返回 true，用于懒加载 Git / 文件树。 */
export function useInView(
  rootMargin = "120px",
  enabled = true,
  root: InViewRoot = null,
): [Ref<HTMLElement | null>, boolean] {
  const [setRef, element] = useObservedElementRef();
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setInView(false);
      return;
    }
    if (!element || inView) return;

    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }

    if (isElementInScrollRoot(element, root, rootMargin)) {
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
      { rootMargin, root },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled, element, inView, root, rootMargin]);

  return [setRef, enabled ? inView : false];
}

/** 双向视口检测：离开视口时返回 false，便于卸载大对象。 */
export function useInViewActive(
  rootMargin = "120px",
  enabled = true,
  root: InViewRoot = null,
): [Ref<HTMLElement | null>, boolean] {
  const [setRef, element] = useObservedElementRef();
  const [inView, setInView] = useState(false);
  const observerInViewRef = useRef(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) {
      observerInViewRef.current = false;
      setInView(false);
      return;
    }
    if (!element) return;

    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }

    const commitInView = (next: boolean, immediate = false) => {
      if (debounceTimerRef.current != null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (immediate) {
        setInView(next);
        return;
      }
      const delayMs = next ? 80 : 650;
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        setInView(observerInViewRef.current);
      }, delayMs);
    };

    const initialInView = isElementInScrollRoot(element, root, rootMargin);
    observerInViewRef.current = initialInView;
    commitInView(initialInView, true);

    const observer = new IntersectionObserver(
      (entries) => {
        const next = entries.some((entry) => entry.isIntersecting);
        if (next === observerInViewRef.current) return;
        observerInViewRef.current = next;
        commitInView(next);
      },
      { rootMargin, root },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (debounceTimerRef.current != null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [enabled, element, root, rootMargin]);

  return [setRef, enabled ? inView : false];
}

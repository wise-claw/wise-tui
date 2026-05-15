/**
 * Wise 内嵌 CC Workflow Studio：替换 `@radix-ui/react-dismissable-layer`。
 *
 * 上游在 `disableOutsidePointerEvents` 时会把 `document.body.style.pointerEvents = "none"`，
 * 导致弹窗打开期间整个 Wise 主窗无法点击。嵌入时改为仅抑制 `.wise-cc-wf-studio-shell-main`
 *（与 portal 内弹窗兄弟），从而交互限制在工作流叠层内。
 *
 * 逻辑与 `@radix-ui/react-dismissable-layer@1.1.11` 的 `dist/index.mjs` 一致，仅替换 pointer-events 作用目标。
 */
"use client";

import * as React from "react";
import { composeEventHandlers } from "@radix-ui/primitive";
import { Primitive, dispatchDiscreteCustomEvent } from "@radix-ui/react-primitive";
import { useComposedRefs } from "@radix-ui/react-compose-refs";
import { useCallbackRef } from "@radix-ui/react-use-callback-ref";
import { useEscapeKeydown } from "@radix-ui/react-use-escape-keydown";
import { jsx } from "react/jsx-runtime";

const DISMISSABLE_LAYER_NAME = "DismissableLayer";
const CONTEXT_UPDATE = "dismissableLayer.update";
const POINTER_DOWN_OUTSIDE = "dismissableLayer.pointerDownOutside";
const FOCUS_OUTSIDE = "dismissableLayer.focusOutside";

let originalSuppressionTargetPointerEvents: string;

function getPointerEventsSuppressionTarget(ownerDocument: Document): HTMLElement {
  if (ownerDocument.documentElement.classList.contains("wise-cc-wf-studio-host-active")) {
    const shellMain = ownerDocument.querySelector(".wise-cc-wf-studio-shell-main") as HTMLElement | null;
    if (shellMain) {
      return shellMain;
    }
  }
  return ownerDocument.body;
}

const DismissableLayerContext = React.createContext({
  layers: new Set<Element>(),
  layersWithOutsidePointerEventsDisabled: new Set<Element>(),
  branches: new Set<Element>(),
});

const DismissableLayer = React.forwardRef((props: Record<string, unknown>, forwardedRef: React.Ref<HTMLDivElement>) => {
  const {
    disableOutsidePointerEvents = false,
    onEscapeKeyDown,
    onPointerDownOutside,
    onFocusOutside,
    onInteractOutside,
    onDismiss,
    ...layerProps
  } = props as Record<string, unknown> & {
    disableOutsidePointerEvents?: boolean;
    onEscapeKeyDown?: (e: KeyboardEvent) => void;
    onPointerDownOutside?: (e: CustomEvent<{ originalEvent: PointerEvent }>) => void;
    onFocusOutside?: (e: CustomEvent<{ originalEvent: FocusEvent }>) => void;
    onInteractOutside?: (e: CustomEvent<{ originalEvent: PointerEvent | FocusEvent }>) => void;
    onDismiss?: () => void;
  };
  const context = React.useContext(DismissableLayerContext);
  const [node, setNode] = React.useState<Element | null>(null);
  const ownerDocument = node?.ownerDocument ?? globalThis.document;
  const [, force] = React.useState({});
  const composedRefs = useComposedRefs(forwardedRef, (node2: Element | null) => setNode(node2));
  const layers = Array.from(context.layers);
  const [highestLayerWithOutsidePointerEventsDisabled] = [
    ...context.layersWithOutsidePointerEventsDisabled,
  ].slice(-1);
  const highestLayerWithOutsidePointerEventsDisabledIndex = layers.indexOf(highestLayerWithOutsidePointerEventsDisabled);
  const index = node ? layers.indexOf(node) : -1;
  const isBodyPointerEventsDisabled = context.layersWithOutsidePointerEventsDisabled.size > 0;
  const isPointerEventsEnabled = index >= highestLayerWithOutsidePointerEventsDisabledIndex;
  const pointerDownOutside = usePointerDownOutside((event: Event) => {
    const target = event.target as Node | null;
    const isPointerDownOnBranch = [...context.branches].some((branch) => target && branch.contains(target));
    if (!isPointerEventsEnabled || isPointerDownOnBranch) return;
    onPointerDownOutside?.(event as CustomEvent<{ originalEvent: PointerEvent }>);
    onInteractOutside?.(event as CustomEvent<{ originalEvent: PointerEvent | FocusEvent }>);
    const ce = event as CustomEvent<{ originalEvent: PointerEvent }>;
    if (!ce.defaultPrevented) onDismiss?.();
  }, ownerDocument);
  const focusOutside = useFocusOutside((event: Event) => {
    const target = event.target as Node | null;
    const isFocusInBranch = [...context.branches].some((branch) => target && branch.contains(target));
    if (isFocusInBranch) return;
    onFocusOutside?.(event as CustomEvent<{ originalEvent: FocusEvent }>);
    onInteractOutside?.(event as CustomEvent<{ originalEvent: PointerEvent | FocusEvent }>);
    const ce = event as CustomEvent<{ originalEvent: FocusEvent }>;
    if (!ce.defaultPrevented) onDismiss?.();
  }, ownerDocument);
  useEscapeKeydown((event) => {
    const isHighestLayer = index === context.layers.size - 1;
    if (!isHighestLayer) return;
    onEscapeKeyDown?.(event);
    if (!event.defaultPrevented && onDismiss) {
      event.preventDefault();
      onDismiss();
    }
  }, ownerDocument);
  React.useEffect(() => {
    if (!node) return;
    if (disableOutsidePointerEvents) {
      if (context.layersWithOutsidePointerEventsDisabled.size === 0) {
        const suppressionTarget = getPointerEventsSuppressionTarget(ownerDocument);
        originalSuppressionTargetPointerEvents = suppressionTarget.style.pointerEvents;
        suppressionTarget.style.pointerEvents = "none";
      }
      context.layersWithOutsidePointerEventsDisabled.add(node);
    }
    context.layers.add(node);
    dispatchUpdate();
    return () => {
      if (disableOutsidePointerEvents && context.layersWithOutsidePointerEventsDisabled.size === 1) {
        const suppressionTarget = getPointerEventsSuppressionTarget(ownerDocument);
        suppressionTarget.style.pointerEvents = originalSuppressionTargetPointerEvents;
      }
    };
  }, [node, ownerDocument, disableOutsidePointerEvents, context]);
  React.useEffect(() => {
    return () => {
      if (!node) return;
      context.layers.delete(node);
      context.layersWithOutsidePointerEventsDisabled.delete(node);
      dispatchUpdate();
    };
  }, [node, context]);
  React.useEffect(() => {
    const handleUpdate = () => force({});
    document.addEventListener(CONTEXT_UPDATE, handleUpdate);
    return () => document.removeEventListener(CONTEXT_UPDATE, handleUpdate);
  }, []);
  return jsx(Primitive.div, {
    ...layerProps,
    ref: composedRefs,
    style: {
      pointerEvents: isBodyPointerEventsDisabled ? (isPointerEventsEnabled ? "auto" : "none") : undefined,
      ...(props as { style?: React.CSSProperties }).style,
    },
    onFocusCapture: composeEventHandlers(
      (props as { onFocusCapture?: React.FocusEventHandler }).onFocusCapture,
      focusOutside.onFocusCapture,
    ),
    onBlurCapture: composeEventHandlers(
      (props as { onBlurCapture?: React.FocusEventHandler }).onBlurCapture,
      focusOutside.onBlurCapture,
    ),
    onPointerDownCapture: composeEventHandlers(
      (props as { onPointerDownCapture?: React.PointerEventHandler }).onPointerDownCapture,
      pointerDownOutside.onPointerDownCapture,
    ),
  });
});
DismissableLayer.displayName = DISMISSABLE_LAYER_NAME;

const BRANCH_NAME = "DismissableLayerBranch";
const DismissableLayerBranch = React.forwardRef((props: Record<string, unknown>, forwardedRef: React.Ref<HTMLDivElement>) => {
  const context = React.useContext(DismissableLayerContext);
  const ref = React.useRef<HTMLDivElement>(null);
  const composedRefs = useComposedRefs(forwardedRef, ref);
  React.useEffect(() => {
    const n = ref.current;
    if (n) {
      context.branches.add(n);
      return () => {
        context.branches.delete(n);
      };
    }
    return;
  }, [context.branches]);
  return jsx(Primitive.div, { ...props, ref: composedRefs });
});
DismissableLayerBranch.displayName = BRANCH_NAME;

function usePointerDownOutside(
  onPointerDownOutside: (event: Event) => void,
  ownerDocument: Document = globalThis.document,
) {
  const handlePointerDownOutside = useCallbackRef(onPointerDownOutside);
  const isPointerInsideReactTreeRef = React.useRef(false);
  const handleClickRef = React.useRef(() => {});

  React.useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target && !isPointerInsideReactTreeRef.current) {
        const eventDetail = { originalEvent: event };
        const handleAndDispatchPointerDownOutsideEvent2 = () => {
          handleAndDispatchCustomEvent(
            POINTER_DOWN_OUTSIDE,
            handlePointerDownOutside,
            eventDetail,
            { discrete: true },
          );
        };
        if (event.pointerType === "touch") {
          ownerDocument.removeEventListener("click", handleClickRef.current);
          handleClickRef.current = handleAndDispatchPointerDownOutsideEvent2;
          ownerDocument.addEventListener("click", handleClickRef.current, { once: true });
        } else {
          handleAndDispatchPointerDownOutsideEvent2();
        }
      } else {
        ownerDocument.removeEventListener("click", handleClickRef.current);
      }
      isPointerInsideReactTreeRef.current = false;
    };
    const timerId = window.setTimeout(() => {
      ownerDocument.addEventListener("pointerdown", handlePointerDown);
    }, 0);
    return () => {
      window.clearTimeout(timerId);
      ownerDocument.removeEventListener("pointerdown", handlePointerDown);
      ownerDocument.removeEventListener("click", handleClickRef.current);
    };
  }, [ownerDocument, handlePointerDownOutside]);

  return {
    onPointerDownCapture: () => {
      isPointerInsideReactTreeRef.current = true;
    },
  };
}

function useFocusOutside(
  onFocusOutside: (event: Event) => void,
  ownerDocument: Document = globalThis.document,
) {
  const handleFocusOutside = useCallbackRef(onFocusOutside);
  const isFocusInsideReactTreeRef = React.useRef(false);

  React.useEffect(() => {
    const handleFocus = (event: FocusEvent) => {
      if (event.target && !isFocusInsideReactTreeRef.current) {
        const eventDetail = { originalEvent: event };
        handleAndDispatchCustomEvent(FOCUS_OUTSIDE, handleFocusOutside, eventDetail, { discrete: false });
      }
    };
    ownerDocument.addEventListener("focusin", handleFocus);
    return () => ownerDocument.removeEventListener("focusin", handleFocus);
  }, [ownerDocument, handleFocusOutside]);

  return {
    onFocusCapture: () => {
      isFocusInsideReactTreeRef.current = true;
    },
    onBlurCapture: () => {
      isFocusInsideReactTreeRef.current = false;
    },
  };
}

function dispatchUpdate() {
  document.dispatchEvent(new CustomEvent(CONTEXT_UPDATE));
}

function handleAndDispatchCustomEvent(
  name: string,
  handler: EventListener | undefined,
  detail: { originalEvent: Event },
  options: { discrete: boolean },
) {
  const target = detail.originalEvent.target;
  if (!(target instanceof EventTarget)) return;
  const event = new CustomEvent(name, { bubbles: false, cancelable: true, detail });
  if (handler) target.addEventListener(name, handler, { once: true });
  if (options.discrete) {
    dispatchDiscreteCustomEvent(target, event);
  } else {
    target.dispatchEvent(event);
  }
}

const Root = DismissableLayer;
const Branch = DismissableLayerBranch;

export { Branch, DismissableLayer, DismissableLayerBranch, Root };

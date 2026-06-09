import {
  Children,
  cloneElement,
  forwardRef,
  isValidElement,
  type MouseEventHandler,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { getNodeRef, useComposeRef } from "@rc-component/util/es/ref";
import { Tooltip, type TooltipProps } from "antd";

function canUseNativeTitle(title: TooltipProps["title"]): title is string {
  return typeof title === "string" && title.trim().length > 0;
}

function mergeClassName(...parts: Array<string | undefined>): string | undefined {
  const merged = parts.filter(Boolean).join(" ");
  return merged || undefined;
}

function mergeHandler<E>(
  outer?: MouseEventHandler<E>,
  inner?: MouseEventHandler<E>,
): MouseEventHandler<E> | undefined {
  if (!outer) return inner;
  if (!inner) return outer;
  return (event) => {
    outer(event);
    if (!event.defaultPrevented) inner(event);
  };
}

const TRIGGER_HANDLER_KEYS = [
  "onClick",
  "onMouseDown",
  "onMouseUp",
  "onPointerDown",
  "onPointerUp",
  "onKeyDown",
  "onKeyUp",
  "onContextMenu",
] as const;

/** Ant Tooltip 专用；不可落到 DOM trigger 上。 */
const TOOLTIP_ONLY_PROP_KEYS = new Set<string>([
  "arrow",
  "align",
  "autoAdjustOverflow",
  "builtinPlacements",
  "color",
  "destroyOnHidden",
  "destroyTooltipOnHide",
  "fresh",
  "getPopupContainer",
  "mouseEnterDelay",
  "mouseLeaveDelay",
  "overlay",
  "overlayClassName",
  "overlayInnerStyle",
  "overlayStyle",
  "placement",
  "showArrow",
  "styles",
  "classNames",
  "rootClassName",
  "trigger",
  "zIndex",
]);

function isDomWrapper(type: unknown): type is "span" | "div" {
  return type === "span" || type === "div";
}

function wrapperHasTriggerHandlers(props: Record<string, unknown>): boolean {
  return TRIGGER_HANDLER_KEYS.some((key) => typeof props[key] === "function");
}

/** 不传给 DOM / 子节点；其余（含 Dropdown / Popover 注入的 ref、事件）保留。 */
function pickPassthroughProps(props: TooltipProps): Record<string, unknown> {
  const passthrough: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (!TOOLTIP_ONLY_PROP_KEYS.has(key)) {
      passthrough[key] = value;
    }
  }
  return passthrough;
}

function mergePassthroughOntoChild(
  child: ReactElement,
  passthrough: Record<string, unknown>,
  mergedRef: Ref<unknown>,
  title?: string,
): ReactElement {
  const childProps = child.props as Record<string, unknown> & {
    className?: string;
    style?: React.CSSProperties;
  };
  const passthroughStyle =
    passthrough.style && typeof passthrough.style === "object"
      ? (passthrough.style as React.CSSProperties)
      : undefined;
  const mergedStyle =
    passthroughStyle || childProps.style
      ? { ...(childProps.style as React.CSSProperties | undefined), ...passthroughStyle }
      : undefined;

  const patch: Record<string, unknown> = {
    ...passthrough,
    ref: mergedRef,
    className: mergeClassName(
      childProps.className,
      passthrough.className as string | undefined,
    ),
  };

  for (const key of TRIGGER_HANDLER_KEYS) {
    const outer = passthrough[key];
    const inner = childProps[key];
    if (typeof outer === "function" || typeof inner === "function") {
      patch[key] = mergeHandler(
        outer as MouseEventHandler<HTMLElement> | undefined,
        inner as MouseEventHandler<HTMLElement> | undefined,
      );
    }
  }

  if (mergedStyle) patch.style = mergedStyle;
  if (title !== undefined) patch.title = title;

  return cloneElement(child, patch as Partial<unknown> & Record<string, unknown>);
}

/** span/div 包装层无 trigger 事件时，把 overlay 注入合并到内层 button 等真实 trigger。 */
function mergePassthroughThroughWrappers(
  child: ReactElement,
  passthrough: Record<string, unknown>,
  mergedRef: Ref<unknown>,
  title?: string,
): ReactElement {
  if (!isDomWrapper(child.type)) {
    return mergePassthroughOntoChild(child, passthrough, mergedRef, title);
  }

  const childProps = child.props as Record<string, unknown> & { children?: ReactNode };
  if (wrapperHasTriggerHandlers(childProps)) {
    return mergePassthroughOntoChild(child, passthrough, mergedRef, title);
  }

  const visibleChildren = Children.toArray(childProps.children);
  if (visibleChildren.length !== 1 || !isValidElement(visibleChildren[0])) {
    return mergePassthroughOntoChild(child, passthrough, mergedRef, title);
  }

  const inner = visibleChildren[0] as ReactElement;
  const mergedInner = mergePassthroughThroughWrappers(inner, passthrough, mergedRef, title);
  return cloneElement(child, {}, mergedInner);
}

/**
 * 纯文案 hover：注入原生 title，由系统绘制气泡（无 portal / align）。
 * 复杂 ReactNode 内容仍回退 Ant Tooltip。
 * 必须 forwardRef / 合并 trigger props，供 Dropdown、Popover 等 overlay 挂载。
 */
export const HoverHint = forwardRef<unknown, TooltipProps>(function HoverHint(
  { children, title, open, ...props },
  ref,
) {
  const passthrough = pickPassthroughProps(props);
  const childElement = isValidElement(children) ? (children as ReactElement) : null;
  const childRef = childElement ? getNodeRef(childElement) : null;
  const mergedRef = useComposeRef(ref, childRef);
  const suppressNativeTitle = open === false;
  const nativeTitle =
    !suppressNativeTitle && canUseNativeTitle(title) ? title : undefined;

  if (!childElement) {
    if (title == null || title === false || title === "") {
      return children as ReactNode;
    }
    return (
      <Tooltip destroyOnHidden {...props} open={open} title={title}>
        {children}
      </Tooltip>
    );
  }

  const mergedChild = mergePassthroughThroughWrappers(
    childElement,
    passthrough,
    mergedRef,
    nativeTitle,
  );

  if (title == null || title === false || title === "") {
    return mergedChild;
  }

  if (canUseNativeTitle(title) && !suppressNativeTitle) {
    return mergedChild;
  }

  return (
    <Tooltip destroyOnHidden {...props} open={open} title={title}>
      {mergedChild}
    </Tooltip>
  );
});

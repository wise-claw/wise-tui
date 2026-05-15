/**
 * Wise 嵌入：将 Radix Portal 挂到工作流壳内宿主节点。
 * 在 Provider 内且宿主尚未就绪时不得回退 document.body，否则蒙层会盖住整个 Wise。
 */
import * as React from "react";
import ReactDOM from "react-dom";
import { Primitive } from "@radix-ui/react-primitive";
import { useLayoutEffect } from "react";
import { useWiseWorkflowPortalContextValue } from "../WiseWorkflowPortalContext";

const PORTAL_NAME = "Portal";

const Portal = React.forwardRef<
  React.ElementRef<typeof Primitive.div>,
  React.ComponentPropsWithoutRef<typeof Primitive.div> & {
    container?: Element | DocumentFragment | null;
  }
>((props, forwardedRef) => {
  const { container: containerProp, ...portalProps } = props;
  const wiseCtx = useWiseWorkflowPortalContextValue();
  const [mounted, setMounted] = React.useState(false);
  useLayoutEffect(() => setMounted(true), []);

  const container: Element | DocumentFragment | null | undefined = (() => {
    if (containerProp != null) {
      return containerProp;
    }
    if (wiseCtx) {
      return wiseCtx.hostElement;
    }
    if (mounted && typeof document !== "undefined") {
      return document.body;
    }
    return undefined;
  })();

  if (container == null) {
    return null;
  }

  return ReactDOM.createPortal(<Primitive.div {...portalProps} ref={forwardedRef} />, container);
});

Portal.displayName = PORTAL_NAME;

const Root = Portal;

export { Portal, Root };

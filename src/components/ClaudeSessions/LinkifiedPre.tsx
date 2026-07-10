import { useEffect, useMemo, useRef } from "react";
import { attachExternalLinkDelegation } from "../../services/openExternal";
import { plainTextToLinkedHtml } from "../../utils/autolinkUrl";

/** 纯文本中的 http(s) 链接可点击，在系统默认浏览器中打开 */
export function LinkifiedPre({
  text,
  className,
  streaming,
}: {
  text: string;
  className?: string;
  /** 流式工具输出：跳过 HTML 链接化，避免每帧 regex + innerHTML */
  streaming?: boolean;
}) {
  const ref = useRef<HTMLPreElement>(null);
  const html = useMemo(() => plainTextToLinkedHtml(text), [text]);
  useEffect(() => {
    const el = ref.current;
    if (!el || streaming) return;
    return attachExternalLinkDelegation(el);
  }, [streaming]);
  if (streaming) {
    return <pre className={className}>{text}</pre>;
  }
  return <pre ref={ref} className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

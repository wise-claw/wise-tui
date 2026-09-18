import { lazy, Suspense, useState } from "react";
import { Button, Spin } from "antd";
import { MONACO_LARGE_FILE_CHAR_THRESHOLD } from "../utils/monacoLargeFile";

const ConversationCanvasModal = lazy(() => import("./ConversationCanvasModal"));

export function ConversationCanvasButton({ source }: { source: string }) {
  const [open, setOpen] = useState(false);
  if (!source.trim()) return null;
  const tooLarge = source.length >= MONACO_LARGE_FILE_CHAR_THRESHOLD;
  return <>
    <Button size="small" type="text" disabled={tooLarge} title={tooLarge ? "内容较大，请保存文件后查看" : "在画布中查看页面与产品方案"}
      onClick={(event) => { event.stopPropagation(); setOpen(true); }}>画布查看</Button>
    {open ? <Suspense fallback={<Spin size="small" />}><ConversationCanvasModal source={source} onClose={() => setOpen(false)} /></Suspense> : null}
  </>;
}

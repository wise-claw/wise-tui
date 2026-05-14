import type { ReactNode } from "react";
import { Popconfirm } from "antd";

interface DiscardFilePopconfirmProps {
  filePath: string;
  onConfirm: () => void | Promise<void>;
  children: ReactNode;
}

export function DiscardFilePopconfirm({
  filePath,
  onConfirm,
  children,
}: DiscardFilePopconfirmProps) {
  return (
    <Popconfirm
      title="确认放弃更改？"
      description={
        <>
          <div>未暂存的修改将被永久丢弃，且无法恢复。</div>
          <div
            style={{
              marginTop: 8,
              wordBreak: "break-all",
              fontFamily: "var(--ant-font-family-code, monospace)",
              fontSize: 12,
            }}
          >
            {filePath}
          </div>
        </>
      }
      okText="放弃更改"
      cancelText="取消"
      okButtonProps={{ danger: true }}
      placement="top"
      getPopupContainer={() => document.body}
      styles={{ container: { width: 300 } }}
      onConfirm={onConfirm}
    >
      {children}
    </Popconfirm>
  );
}

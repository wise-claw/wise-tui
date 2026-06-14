import { useEffect, useRef, useState } from "react";
import {
  resolveEffectiveAutoApproveMode,
  subscribeAutoApproveSettings,
} from "../services/autoApproveSettings";
import type { AutoApproveMode } from "../utils/autoApproveDecide";

/**
 * 订阅某仓库（或无仓库）有效自动批准模式。
 *
 * - 首次挂载时异步解析；解析完成前返回 `null`，渲染方应据此处理 loading（通常隐藏 UI）。
 * - `setGlobalAutoApproveMode` / `setRepoAutoApproveOverride` 写入后会触发重新解析。
 * - `repoPath` 变化（切会话）也会触发重新解析。
 *
 * 用 sequence number 守护 Promise 乱序：快速连续触发的 reload 可能 out-of-order resolve；
 * 仅最新一次 dispatch 的结果允许写入 state。
 */
export function useEffectiveAutoApproveMode(
  repoPath: string | null | undefined,
): AutoApproveMode | null {
  const [mode, setMode] = useState<AutoApproveMode | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const reload = () => {
      const mySeq = ++seqRef.current;
      void resolveEffectiveAutoApproveMode(repoPath).then((next) => {
        if (cancelled) return;
        if (seqRef.current !== mySeq) return;
        setMode(next);
      });
    };
    reload();
    const unsubscribe = subscribeAutoApproveSettings(reload);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [repoPath]);

  return mode;
}

/**
 * Composer 待发图片附件（按草稿桶 `draftBucketKey` 分桶的模块级 store）。
 *
 * 为什么不放组件本地 state：`ComposerRegion` 子树会因布局变化整棵卸载重建
 * （1 屏 ↔ 多屏切换会让第一屏重建），本地 state 随实例销毁，用户贴好的截图就没了。
 * 正文与 @ 上下文由 `PromptProvider` 落到 SQLite，图片则因为 `dataUrl` 是 base64
 * 只保留在内存：够覆盖切屏/切 tab，重启应用释放，不把几 MB 图片写进 app_settings。
 */
import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { ImageAttachmentPart } from "../types";

const EMPTY_IMAGES: readonly ImageAttachmentPart[] = Object.freeze([]);

const buckets = new Map<string, readonly ImageAttachmentPart[]>();
const listeners = new Map<string, Set<() => void>>();

export function getComposerImageDraft(
  bucketKey: string,
): readonly ImageAttachmentPart[] {
  return buckets.get(bucketKey) ?? EMPTY_IMAGES;
}

export function subscribeComposerImageDraft(
  bucketKey: string,
  listener: () => void,
): () => void {
  let bucket = listeners.get(bucketKey);
  if (!bucket) {
    bucket = new Set();
    listeners.set(bucketKey, bucket);
  }
  bucket.add(listener);
  return () => {
    const current = listeners.get(bucketKey);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) listeners.delete(bucketKey);
  };
}

export function setComposerImageDraft(
  bucketKey: string,
  images: readonly ImageAttachmentPart[],
): void {
  const prev = getComposerImageDraft(bucketKey);
  if (prev === images) return;
  if (images.length === 0) {
    if (prev.length === 0) return;
    buckets.delete(bucketKey);
  } else {
    buckets.set(bucketKey, images);
  }
  const bucket = listeners.get(bucketKey);
  if (!bucket) return;
  for (const listener of bucket) {
    try {
      listener();
    } catch {
      /* ignore subscriber errors */
    }
  }
}

export function clearComposerImageDraft(bucketKey: string): void {
  setComposerImageDraft(bucketKey, EMPTY_IMAGES);
}

/** 仅供测试重置模块级状态。 */
export function resetComposerImageDraftStoreForTests(): void {
  buckets.clear();
  listeners.clear();
}

/** 与 `useState<ImageAttachmentPart[]>` 同形，便于替换原本的本地 state。 */
export function useComposerImageDraft(
  bucketKey: string,
): [
  ImageAttachmentPart[],
  (next: ImageAttachmentPart[] | ((prev: ImageAttachmentPart[]) => ImageAttachmentPart[])) => void,
] {
  const subscribe = useCallback(
    (listener: () => void) => subscribeComposerImageDraft(bucketKey, listener),
    [bucketKey],
  );
  const getSnapshot = useCallback(
    () => getComposerImageDraft(bucketKey),
    [bucketKey],
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const images = useMemo(() => snapshot as ImageAttachmentPart[], [snapshot]);

  const setImages = useCallback(
    (
      next:
        | ImageAttachmentPart[]
        | ((prev: ImageAttachmentPart[]) => ImageAttachmentPart[]),
    ) => {
      const prev = getComposerImageDraft(bucketKey) as ImageAttachmentPart[];
      setComposerImageDraft(
        bucketKey,
        typeof next === "function" ? next(prev) : next,
      );
    },
    [bucketKey],
  );

  return [images, setImages];
}

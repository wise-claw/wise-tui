import { beforeEach, describe, expect, test } from "bun:test";
import type { ImageAttachmentPart } from "../types";
import {
  clearComposerImageDraft,
  getComposerImageDraft,
  resetComposerImageDraftStoreForTests,
  setComposerImageDraft,
  subscribeComposerImageDraft,
} from "./composerImageDraftStore";

function image(id: string): ImageAttachmentPart {
  return {
    type: "image",
    id,
    filename: `${id}.png`,
    mime: "image/png",
    dataUrl: `data:image/png;base64,${id}`,
  };
}

describe("composerImageDraftStore", () => {
  beforeEach(() => {
    resetComposerImageDraftStoreForTests();
  });

  test("getSnapshot returns stable identity when unchanged", () => {
    expect(getComposerImageDraft("session-a")).toBe(getComposerImageDraft("session-a"));
    const images = [image("a")];
    setComposerImageDraft("session-a", images);
    expect(getComposerImageDraft("session-a")).toBe(images);
  });

  test("attachments survive host unmount", () => {
    setComposerImageDraft("session-a", [image("a")]);
    // 布局重建只会卸载组件，store 不参与，草稿图片仍在。
    expect(getComposerImageDraft("session-a").map((img) => img.id)).toEqual(["a"]);
  });

  test("buckets are isolated per draft key", () => {
    setComposerImageDraft("session-a", [image("a")]);
    setComposerImageDraft("monitor-drawer:task-1", [image("b")]);
    expect(getComposerImageDraft("session-a").map((img) => img.id)).toEqual(["a"]);
    expect(getComposerImageDraft("monitor-drawer:task-1").map((img) => img.id)).toEqual(["b"]);
  });

  test("clearing releases the bucket", () => {
    setComposerImageDraft("session-a", [image("a")]);
    clearComposerImageDraft("session-a");
    expect(getComposerImageDraft("session-a")).toEqual([]);
    expect(getComposerImageDraft("session-a")).toBe(getComposerImageDraft("session-b"));
  });

  test("subscribers are notified per bucket and only on change", () => {
    let sessionA = 0;
    let sessionB = 0;
    const unsubscribe = subscribeComposerImageDraft("session-a", () => {
      sessionA += 1;
    });
    subscribeComposerImageDraft("session-b", () => {
      sessionB += 1;
    });

    setComposerImageDraft("session-a", [image("a")]);
    expect(sessionA).toBe(1);
    expect(sessionB).toBe(0);

    clearComposerImageDraft("session-a");
    expect(sessionA).toBe(2);
    // 已为空时再清一次不应通知。
    clearComposerImageDraft("session-a");
    expect(sessionA).toBe(2);

    unsubscribe();
    setComposerImageDraft("session-a", [image("c")]);
    expect(sessionA).toBe(2);
  });
});

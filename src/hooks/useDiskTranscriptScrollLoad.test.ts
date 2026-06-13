import { describe, expect, test } from "bun:test";
import { CHAT_MESSAGE_LIST_SCROLL_LOAD_PX } from "../constants/claudeMessageList";
import { shouldTriggerDiskTranscriptScrollLoad } from "./useDiskTranscriptScrollLoad";

describe("shouldTriggerDiskTranscriptScrollLoad", () => {
  test("triggers near top when partial and idle", () => {
    expect(
      shouldTriggerDiskTranscriptScrollLoad({
        scrollTop: CHAT_MESSAGE_LIST_SCROLL_LOAD_PX,
        diskTranscriptPartial: true,
        isLoading: false,
      }),
    ).toBe(true);
  });

  test("does not trigger when not partial", () => {
    expect(
      shouldTriggerDiskTranscriptScrollLoad({
        scrollTop: 0,
        diskTranscriptPartial: false,
        isLoading: false,
      }),
    ).toBe(false);
  });

  test("does not trigger while loading", () => {
    expect(
      shouldTriggerDiskTranscriptScrollLoad({
        scrollTop: 0,
        diskTranscriptPartial: true,
        isLoading: true,
      }),
    ).toBe(false);
  });

  test("does not trigger far from top", () => {
    expect(
      shouldTriggerDiskTranscriptScrollLoad({
        scrollTop: CHAT_MESSAGE_LIST_SCROLL_LOAD_PX + 1,
        diskTranscriptPartial: true,
        isLoading: false,
      }),
    ).toBe(false);
  });
});

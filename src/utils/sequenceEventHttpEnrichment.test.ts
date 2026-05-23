import { describe, expect, it } from "bun:test";
import type { SequenceEvent } from "./claudeSessionTrajectorySequence";
import { enrichSequenceEventsWithObservedHttp, fccTraceHttpDetail } from "./sequenceEventHttpEnrichment";

describe("sequenceEventHttpEnrichment", () => {
  it("fills api_request detail from FCC trace", () => {
    const events: SequenceEvent[] = [
      {
        id: "api-2",
        order: 2,
        timestamp: 1999,
        kind: "api_request",
        fromLane: "claude_code",
        toLane: "model",
        label: "REQUEST",
        messageId: 2,
        flags: {},
      },
    ];
    const { events: out } = enrichSequenceEventsWithObservedHttp(events, {
      fccTraces: [
        {
          id: "t1",
          timestampMs: 2000,
          method: "POST",
          path: "/v1/messages",
          requestPreview: '{"model":"claude"}',
          responsePreview: '{"role":"assistant"}',
        },
      ],
    });
    expect(out[0]!.flags.observedHttp).toBe(true);
    expect(out[0]!.detail).toContain("request:");
    expect(out[0]!.detail).toContain("response:");
    expect(fccTraceHttpDetail({
      id: "t1",
      timestampMs: 0,
      method: "POST",
      path: "/v1/messages",
      requestPreview: "req",
      responsePreview: "res",
    })).toContain("req");
  });
});

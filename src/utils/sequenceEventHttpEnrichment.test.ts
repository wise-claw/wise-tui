import { describe, expect, it } from "bun:test";
import type { SequenceEvent } from "./claudeSessionTrajectorySequence";
import {
  enrichSequenceEventsWithObservedHttp,
  fccTraceHttpDetail,
  opencodeGoProxyTraceHttpDetail,
} from "./sequenceEventHttpEnrichment";

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

  it("prefers OpenCode Go trace over FCC for api_request", () => {
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
      opencodeGoProxyTraces: [
        {
          id: "og1",
          timestampMs: 2000,
          method: "POST",
          path: "/v1/messages",
          claudeModel: "claude-sonnet-4",
          upstreamModel: "glm-4.7",
          upstreamUrl: "https://opencode.ai/zen/go/v1",
          durationMs: 1200,
          isStreaming: true,
          requestPreview: '{"model":"claude-sonnet-4"}',
          responsePreview: "event: message_start",
        },
      ],
      fccTraces: [
        {
          id: "t1",
          timestampMs: 2001,
          method: "POST",
          path: "/v1/messages",
          requestPreview: "fcc-req",
        },
      ],
    });
    expect(out[0]!.id).toBe("opencode-go-api-og1");
    expect(out[0]!.flags.observedHttp).toBe(true);
    expect(opencodeGoProxyTraceHttpDetail({
      id: "og1",
      timestampMs: 0,
      method: "POST",
      path: "/v1/messages",
      claudeModel: "claude",
      upstreamModel: "glm",
      upstreamUrl: "https://x",
      durationMs: 1,
      isStreaming: false,
      requestPreview: "req",
      responsePreview: "res",
    })).toContain("req");
  });
});

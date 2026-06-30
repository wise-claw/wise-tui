import { describe, expect, test } from "bun:test";
import { computePcmRmsLevel, encodeMonoPcm16ToWav, resampleFloat32Linear } from "./composerAudioCapture";

describe("encodeMonoPcm16ToWav", () => {
  test("writes RIFF header and 16-bit PCM payload", () => {
    const samples = new Float32Array([0, 0.5, -0.5]);
    const wav = encodeMonoPcm16ToWav(samples, 16_000);
    const view = new DataView(wav);
    expect(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))).toBe(
      "RIFF",
    );
    expect(String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11))).toBe(
      "WAVE",
    );
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBeGreaterThan(16_000);
    expect(view.getInt16(48, true)).toBeLessThan(-16_000);
  });
});

describe("resampleFloat32Linear", () => {
  test("halves length when downsampling 48kHz to 16kHz", () => {
    const input = new Float32Array(480);
    input.fill(0.5);
    const out = resampleFloat32Linear(input, 48_000, 16_000);
    expect(out.length).toBe(160);
  });

  test("returns same buffer when rates match", () => {
    const input = new Float32Array([0.1, 0.2]);
    expect(resampleFloat32Linear(input, 16_000, 16_000)).toBe(input);
  });
});

describe("computePcmRmsLevel", () => {
  test("静音返回 0", () => {
    const silent = new Float32Array(1024);
    expect(computePcmRmsLevel(silent)).toBe(0);
  });

  test("高电平映射到接近 1", () => {
    const loud = new Float32Array(1024);
    for (let i = 0; i < loud.length; i += 1) {
      loud[i] = i % 2 === 0 ? 0.9 : -0.9;
    }
    const level = computePcmRmsLevel(loud);
    expect(level).toBeGreaterThan(0.7);
    expect(level).toBeLessThanOrEqual(1);
  });

  test("人声区间落在 0.05~0.8", () => {
    const voice = new Float32Array(1024);
    for (let i = 0; i < voice.length; i += 1) {
      voice[i] = Math.sin(i * 0.1) * 0.15;
    }
    const level = computePcmRmsLevel(voice);
    expect(level).toBeGreaterThan(0.05);
    expect(level).toBeLessThan(0.8);
  });

  test("空 buffer 返回 0", () => {
    expect(computePcmRmsLevel(new Float32Array(0))).toBe(0);
  });
});

import { describe, expect, test } from "bun:test";
import { encodeMonoPcm16ToWav, resampleFloat32Linear } from "./composerAudioCapture";

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

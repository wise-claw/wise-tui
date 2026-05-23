/** 会话 composer 录音：采集单声道 PCM 并编码为 16-bit WAV。 */

const TARGET_SAMPLE_RATE = 16_000;

export interface ComposerRecordedWav {
  wavBase64: string;
  durationMs: number;
  sampleRate: number;
}

/** 将 [-1, 1] 浮点样本编码为 mono PCM16 WAV。 */
export function encodeMonoPcm16ToWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const numSamples = samples.length;
  const dataSize = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(offset, int16, true);
    offset += 2;
  }

  return buffer;
}

export function mergeFloat32Chunks(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export function float32ToBase64(samples: Float32Array): string {
  const bytes = samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength);
  return arrayBufferToBase64(bytes);
}

/** 线性插值重采样，将 WebView 实际采集率对齐到 Speech `nativeAudioFormat`。 */
export function resampleFloat32Linear(
  samples: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (samples.length === 0 || fromRate <= 0 || toRate <= 0 || fromRate === toRate) {
    return samples;
  }
  const ratio = toRate / fromRate;
  const outLen = Math.max(1, Math.round(samples.length * ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i += 1) {
    const srcPos = i / ratio;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(samples.length - 1, i0 + 1);
    const t = srcPos - i0;
    out[i] = (samples[i0] ?? 0) * (1 - t) + (samples[i1] ?? 0) * t;
  }
  return out;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

type ScriptProcessorNodeLike = AudioNode & {
  onaudioprocess: ((event: AudioProcessingEvent) => void) | null;
};

export interface ComposerStreamingRecorderOptions {
  /** 与 Speech `nativeAudioFormat` 一致，默认 16000。 */
  sampleRate?: number;
  onPcmChunk: (chunk: Float32Array, sampleRate: number) => void;
}

/** 在 WebView 内采集麦克风 PCM（支持流式回调或结束后导出 WAV）。 */
export class ComposerAudioRecorder {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNodeLike | null = null;
  private silentGain: GainNode | null = null;
  private chunks: Float32Array[] = [];
  private onPcmChunk: ((chunk: Float32Array, sampleRate: number) => void) | null = null;
  private startedAt = 0;

  get recording(): boolean {
    return this.stream != null;
  }

  getSampleRate(): number {
    return this.context?.sampleRate ?? TARGET_SAMPLE_RATE;
  }

  async startStreaming(options: ComposerStreamingRecorderOptions): Promise<void> {
    this.onPcmChunk = options.onPcmChunk;
    await this.start(options.sampleRate);
  }

  async start(preferredSampleRate?: number): Promise<void> {
    if (this.recording) return;
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.getUserMedia) {
      throw new Error("当前环境不支持麦克风访问。");
    }

    this.stream = await mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) {
      this.cleanup();
      throw new Error("当前环境不支持音频处理。");
    }

    // 不在此强制 sampleRate：WebView 常忽略构造参数（仍用 44.1/48kHz），由调用方重采样到 Speech 原生格式。
    void preferredSampleRate;
    this.context = new Ctx();
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
    this.source = this.context.createMediaStreamSource(this.stream);
    const processor = this.context.createScriptProcessor(4096, 1, 1) as ScriptProcessorNodeLike;
    this.processor = processor;
    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const chunk = new Float32Array(input);
      this.chunks.push(chunk);
      this.onPcmChunk?.(chunk, this.context?.sampleRate ?? TARGET_SAMPLE_RATE);
    };

    this.silentGain = this.context.createGain();
    this.silentGain.gain.value = 0;
    this.source.connect(processor);
    processor.connect(this.silentGain);
    this.silentGain.connect(this.context.destination);

    this.chunks = [];
    this.startedAt = Date.now();
  }

  stopStreaming(): void {
    this.onPcmChunk = null;
    this.cleanup();
  }

  async stop(): Promise<ComposerRecordedWav> {
    if (!this.recording || !this.context) {
      throw new Error("当前未在录音。");
    }

    const durationMs = Math.max(0, Date.now() - this.startedAt);
    const sampleRate = this.context.sampleRate;
    const merged = mergeFloat32Chunks(this.chunks);
    this.cleanup();

    if (merged.length === 0) {
      throw new Error("未采集到音频，请检查麦克风后重试。");
    }

    const wav = encodeMonoPcm16ToWav(merged, sampleRate);
    return {
      wavBase64: arrayBufferToBase64(wav),
      durationMs,
      sampleRate,
    };
  }

  cancel(): void {
    this.cleanup();
  }

  private cleanup(): void {
    if (this.processor) {
      this.processor.onaudioprocess = null;
      try {
        this.processor.disconnect();
      } catch {
        /* ignore */
      }
      this.processor = null;
    }
    if (this.source) {
      try {
        this.source.disconnect();
      } catch {
        /* ignore */
      }
      this.source = null;
    }
    if (this.silentGain) {
      try {
        this.silentGain.disconnect();
      } catch {
        /* ignore */
      }
      this.silentGain = null;
    }
    if (this.context) {
      void this.context.close().catch(() => undefined);
      this.context = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        try {
          track.stop();
        } catch {
          /* ignore */
        }
      }
      this.stream = null;
    }
    this.chunks = [];
    this.onPcmChunk = null;
    this.startedAt = 0;
  }
}

import { useEffect, useRef } from "react";

/**
 * 把 `useComposerSpeechDictation` 的电平订阅桥接成一个轻量的 ref。
 *
 * 设计要点：
 * 1. 语音听写时电平以 ~60fps 频率更新；如果走 React state 会触发整树重渲染，所以这里用 ref 暴露 `levelRef.current`。
 * 2. 调用方在自己的 rAF 循环里 `levelRef.current` 取最新值，再 setState 自己关心的最小字段（如柱高数组）。
 * 3. 当 sink 为 null 时，hook 不再订阅，recorder / Web AnalyserNode 也不再产生回调负担。
 */
export function useComposerSpeechLevelMeter(
  setAudioLevelSink: ((sink: ((level: number) => void) | null) => void) | null,
) {
  const levelRef = useRef(0);
  const sinkRef = useRef<((level: number) => void) | null>(null);

  useEffect(() => {
    if (!setAudioLevelSink) {
      sinkRef.current = null;
      levelRef.current = 0;
      return;
    }
    sinkRef.current = (level) => {
      levelRef.current = level;
    };
    setAudioLevelSink(sinkRef.current);
    return () => {
      setAudioLevelSink(null);
      sinkRef.current = null;
      levelRef.current = 0;
    };
  }, [setAudioLevelSink]);

  return levelRef;
}
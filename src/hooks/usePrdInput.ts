import { useCallback, useMemo, useState } from "react";
import type { PrdInputMeta } from "../types";
import { parsePrdInput } from "../services/prdSource";

export function usePrdInput(initialValue = "") {
  const [inputValue, setInputValue] = useState(initialValue);
  const [meta, setMeta] = useState<PrdInputMeta | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parse = useCallback(() => {
    try {
      const nextMeta = parsePrdInput(inputValue);
      setMeta(nextMeta);
      setError(null);
      return nextMeta;
    } catch (err) {
      const message = err instanceof Error ? err.message : "输入解析失败。";
      setError(message);
      return null;
    }
  }, [inputValue]);

  const canParse = useMemo(() => inputValue.trim().length > 0, [inputValue]);

  return {
    inputValue,
    setInputValue,
    meta,
    error,
    canParse,
    parse,
  };
}

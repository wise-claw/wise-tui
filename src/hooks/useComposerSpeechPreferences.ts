import { useCallback, useEffect, useState } from "react";
import type { ComposerSpeechPreferencesV1 } from "../constants/composerSpeechPreferences";
import { DEFAULT_COMPOSER_SPEECH_PREFERENCES } from "../constants/composerSpeechPreferences";
import {
  getComposerSpeechPreferencesSync,
  hydrateComposerSpeechPreferences,
  patchComposerSpeechPreferences,
} from "../services/composerSpeechPreferences";

export function useComposerSpeechPreferences() {
  const [prefs, setPrefs] = useState<ComposerSpeechPreferencesV1>(() => ({
    ...DEFAULT_COMPOSER_SPEECH_PREFERENCES,
    ...getComposerSpeechPreferencesSync(),
  }));

  useEffect(() => {
    let cancelled = false;
    void hydrateComposerSpeechPreferences().then((loaded) => {
      if (!cancelled) setPrefs(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback(async (patch: Partial<ComposerSpeechPreferencesV1>) => {
    const next = await patchComposerSpeechPreferences(patch);
    setPrefs(next);
    return next;
  }, []);

  return { prefs, update };
}

import { DEFAULT_OPEN_APP_TARGETS } from "../components/OpenAppMenu/constants";
import type { OpenAppTarget } from "../types";
import {
  detectedMacTerminalToOpenTarget,
  isTerminalOpenAppId,
  type DetectedMacTerminal,
} from "../services/macosTerminal";

/** macOS：从「打开方式」候选里去掉静态终端项，改由检测结果注入。 */
export function buildMacOpenAppTargets(detectedTerminals: readonly DetectedMacTerminal[]): OpenAppTarget[] {
  const nonTerminal = DEFAULT_OPEN_APP_TARGETS.filter((item) => !isTerminalOpenAppId(item.id));
  const terminals = detectedTerminals.map(detectedMacTerminalToOpenTarget);
  return [...nonTerminal, ...terminals];
}

export function mergeMacOpenAppTargets(
  detectedTerminals: readonly DetectedMacTerminal[],
  fallback: readonly OpenAppTarget[] = DEFAULT_OPEN_APP_TARGETS,
): OpenAppTarget[] {
  if (detectedTerminals.length === 0) return [...fallback];
  return buildMacOpenAppTargets(detectedTerminals);
}

import { useId } from "react";

/** Claude Code 块状吉祥物；颜色与尺寸跟随 `.app-topbar-btn`。 */
export function IconClaudeCodeMascot() {
  const maskId = useId().replace(/:/g, "");

  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <mask
        id={maskId}
        maskUnits="userSpaceOnUse"
        x="0"
        y="0"
        width="24"
        height="24"
      >
        <rect width="24" height="24" fill="white" />
        <rect x="8" y="10" width="2" height="3" fill="black" />
        <rect x="14" y="10" width="2" height="3" fill="black" />
      </mask>
      <g fill="currentColor" mask={`url(#${maskId})`}>
        <rect x="5" y="7" width="14" height="9" />
        <rect x="3" y="10" width="2" height="3" />
        <rect x="19" y="10" width="2" height="3" />
        <rect x="6" y="16" width="2" height="3" />
        <rect x="9" y="16" width="2" height="3" />
        <rect x="13" y="16" width="2" height="3" />
        <rect x="16" y="16" width="2" height="3" />
      </g>
    </svg>
  );
}

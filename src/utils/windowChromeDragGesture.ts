export const WINDOW_CHROME_DRAG_THRESHOLD_PX = 4;

export function shouldStartWindowChromeDrag(
  origin: { x: number; y: number },
  current: { x: number; y: number },
  alreadyStarted: boolean,
): boolean {
  if (alreadyStarted) return false;
  const dx = current.x - origin.x;
  const dy = current.y - origin.y;
  return dx * dx + dy * dy >= WINDOW_CHROME_DRAG_THRESHOLD_PX * WINDOW_CHROME_DRAG_THRESHOLD_PX;
}

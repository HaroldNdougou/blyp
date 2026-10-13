/** Dimensions bulle image (ratio préservé, style WhatsApp). */

const MAX_W = 280;
const MAX_H = 360;

export function imageBubbleSize(
  width: number,
  height: number,
  screenWidth: number,
): { width: number; height: number } {
  const maxW = Math.min(MAX_W, Math.max(200, screenWidth * 0.72));
  let srcW = width > 0 ? width : 4;
  let srcH = height > 0 ? height : 5;
  const ratio = srcW / srcH;

  let w = maxW;
  let h = w / ratio;
  if (h > MAX_H) {
    h = MAX_H;
    w = h * ratio;
  }
  return {
    width: Math.max(1, Math.round(w)),
    height: Math.max(1, Math.round(h)),
  };
}

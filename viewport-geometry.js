/* Screen-space pan limits, shared by fitted and magnified views. */
'use strict';
function limitMicrographPan(x, y, width, height, viewportWidth, viewportHeight) {
  const visibleWidth = Math.min(width, viewportWidth);
  const visibleHeight = Math.min(height, viewportHeight);
  // Base the limit on what fits at this zoom so a magnified image can still move past its edge.
  const minimumArea = visibleWidth * visibleHeight / 2;
  const halfX = (viewportWidth + width) / 2, halfY = (viewportHeight + height) / 2;
  const magnitudeX = Math.min(Math.abs(x), halfX - minimumArea / visibleHeight);
  const magnitudeY = Math.min(Math.abs(y), halfY - minimumArea / visibleWidth);
  const overlap = (dx, dy) => Math.min(visibleWidth, halfX - dx) * Math.min(visibleHeight, halfY - dy);
  if (overlap(magnitudeX, magnitudeY) >= minimumArea) {
    return { x: Math.sign(x) * magnitudeX, y: Math.sign(y) * magnitudeY };
  }
  // At a diagonal corner, approach the requested overshoot until half the area is visible.
  const startX = Math.min(magnitudeX, halfX - visibleWidth);
  const startY = Math.min(magnitudeY, halfY - visibleHeight);
  const extraX = magnitudeX - startX, extraY = magnitudeY - startY;
  let low = 0, high = 1;
  for (let i = 0; i < 30; i++) {
    const fraction = (low + high) / 2;
    if (overlap(startX + extraX * fraction, startY + extraY * fraction) < minimumArea) high = fraction;
    else low = fraction;
  }
  return { x: Math.sign(x) * (startX + extraX * low), y: Math.sign(y) * (startY + extraY * low) };
}
if (typeof module !== 'undefined' && module.exports) module.exports = limitMicrographPan;

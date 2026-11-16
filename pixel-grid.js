/* Project the visible part of the sensor pixel lattice, clipped to the displayed image. */
'use strict';
window.renderPixelGrid = function (viewport, frame, scale, panX, panY) {
  const grid = document.getElementById('pixel-grid');
  const visiblePixelScale=scale*Math.hypot(frame.matrix[0][0],frame.matrix[1][0]);
  grid.toggleAttribute('hidden', visiblePixelScale < 10);
  if (visiblePixelScale < 10) return;
  const left = (viewport.clientWidth - frame.width * scale) / 2 + panX;
  const top = (viewport.clientHeight - frame.height * scale) / 2 + panY;
  const x1 = Math.max(0, left), x2 = Math.min(viewport.clientWidth, left + frame.width * scale);
  const y1 = Math.max(0, top), y2 = Math.min(viewport.clientHeight, top + frame.height * scale);
  Object.assign(grid.style, { left: x1 + 'px', top: y1 + 'px',
    width: Math.max(0, x2 - x1) + 'px', height: Math.max(0, y2 - y1) + 'px' });
  if (x1 >= x2 || y1 >= y2) return;

  // Find the sensor rows and columns visible through this part of the crop.
  const corners = [];
  for (const x of [x1, x2]) for (const y of [y1, y2]) {
    corners.push(window.GratingGeometry.inverseTransform({ x: (x - left) / scale, y: (y - top) / scale }, frame.matrix));
  }
  const cols = corners.map(p => p.x), rows = corners.map(p => p.y);
  const colMin = Math.max(0, Math.floor(Math.min(...cols))), colMax = Math.min(frame.entry.width, Math.ceil(Math.max(...cols)));
  const rowMin = Math.max(0, Math.floor(Math.min(...rows))), rowMax = Math.min(frame.entry.height, Math.ceil(Math.max(...rows)));
  const lines = [];
  for (let x = Math.max(1, colMin); x <= colMax && x < frame.entry.width; x++) lines.push(`M${x} ${rowMin}V${rowMax}`);
  for (let y = Math.max(1, rowMin); y <= rowMax && y < frame.entry.height; y++) lines.push(`M${colMin} ${y}H${colMax}`);
  const [[a, c, tx], [b, d, ty]] = frame.matrix;
  const path = grid.firstElementChild;
  path.setAttribute('transform', `matrix(${a*scale} ${b*scale} ${c*scale} ${d*scale} ${left-x1+tx*scale} ${top-y1+ty*scale})`);
  path.setAttribute('d', lines.join(' '));
};

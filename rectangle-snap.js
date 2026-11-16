/* Fit four straight sides in native pixels. All views use the same Canny mask. */
'use strict';
(() => {
  const sampling = typeof module !== 'undefined' && module.exports ? require('./canny-midpoints.js') : window.CannySampling;

  function fitSide(side, fraction, width, height, black, mode) {
    const length = side.length * fraction;
    const required = Math.max(3, Math.ceil(length * .5));
    if (required > Math.hypot(width, height) + 2) return null;
    const cells = new Set();
    const visit = mode === 'midpoint' ? sampling.midpointCells : sampling.contourCells;
    visit(side, fraction, width, height, black, index => cells.add(index));

    // Each native-pixel interval along the edge gets one vote, even when a ray
    // contains several black cells. This keeps a thick or noisy patch from winning.
    const columns = new Map();
    for (const index of cells) {
      const x = index % width + .5 - side.x, y = Math.floor(index / width) + .5 - side.y;
      const t = x * side.ux + y * side.uy;
      const d = -x * side.uy + y * side.ux;
      const column = Math.floor(t + length / 2);
      if (!columns.has(column)) columns.set(column, []);
      columns.get(column).push({ t, d });
    }
    if (columns.size < required) return null;

    // Vote for a coherent line across the strip, including when two contours
    // run in parallel. A candidate needs broad, distributed support before its
    // distance to the user's outline is considered.
    const halfBins = 2 * sampling.radius; // half-pixel offset bins
    const votes = new Uint32Array(2 * halfBins + 1);
    const lastColumn = new Int32Array(votes.length);
    const firstT = new Float64Array(votes.length), lastT = new Float64Array(votes.length);
    let best = null;
    const maxRise = length < 6 ? 0 : 2 * sampling.radius;
    for (let rise = -maxRise; rise <= maxRise; rise++) {
      const slope = rise / length;
      votes.fill(0); lastColumn.fill(-1); firstT.fill(Infinity); lastT.fill(-Infinity);
      let serial = 0;
      for (const points of columns.values()) {
        for (const { t, d } of points) {
          const bin = Math.round(2 * (d - slope * t)) + halfBins;
          for (let j = Math.max(0, bin - 1); j <= Math.min(votes.length - 1, bin + 1); j++) {
            if (lastColumn[j] !== serial) { votes[j]++; lastColumn[j] = serial; }
            firstT[j] = Math.min(firstT[j], t); lastT[j] = Math.max(lastT[j], t);
          }
        }
        serial++;
      }
      for (let j = 0; j < votes.length; j++) {
        if (votes[j] < required || lastT[j] - firstT[j] < .55 * length) continue;
        const offset = (j - halfBins) / 2;
        const distance = Math.hypot(offset, rise / Math.sqrt(12));
        const score = .75 * votes[j] / columns.size - distance;
        if (!best || score > best.score) best = { slope, offset, score };
      }
    }
    if (!best) return null;

    // Refine the winning line using the closest inlier in each interval.
    let { slope, offset } = best, meanT, meanD, variance, inlierCount;
    for (let pass = 0; pass < 3; pass++) {
      const inliers = [];
      for (const points of columns.values()) {
        let chosen = null, residual = 1.1;
        for (const p of points) {
          const error = Math.abs(p.d - offset - slope * p.t);
          if (error < residual) { chosen = p; residual = error; }
        }
        if (chosen) inliers.push(chosen);
      }
      if (inliers.length < required) return null;
      inlierCount = inliers.length;
      meanT = inliers.reduce((sum, p) => sum + p.t, 0) / inliers.length;
      meanD = inliers.reduce((sum, p) => sum + p.d, 0) / inliers.length;
      variance = inliers.reduce((sum, p) => sum + (p.t - meanT) ** 2, 0);
      if (variance < 1) return null;
      slope = inliers.reduce((sum, p) => sum + (p.t - meanT) * (p.d - meanD), 0) / variance;
      offset = meanD - slope * meanT;
    }
    return { delta: Math.atan(slope), offset, weight: variance, count: inlierCount,
      x: side.x + side.ux * meanT - side.uy * meanD, y: side.y + side.uy * meanT + side.ux * meanD };
  }

  function fit(rect, mode, fraction, width, height, black) {
    if (!(fraction > 0 && fraction <= 1)) return null;
    const sides = sampling.sides(rect).filter(side => rect.shapeMode !== 'integral' || side.name === 'top' || side.name === 'bottom');
    const fits = sides.map(side => fitSide(side, fraction, width, height, black, mode));
    const supported = fits.filter(Boolean);
    if (!supported.length) return null;
    // Rotating would move an unsupported side. Keep its original line fixed and
    // let supported sides translate independently. With four sides fit a shared angle.
    let angle = rect.angle;
    if (supported.length === sides.length) {
      const weight = supported.reduce((sum, f) => sum + f.weight, 0);
      angle += supported.reduce((sum, f) => sum + f.delta * f.weight, 0) / weight;
    }
    const c = Math.cos(angle), s = Math.sin(angle);
    const bounds = { left: -rect.width/2, right: rect.width/2, top: -rect.height/2, bottom: rect.height/2 };
    sides.forEach(({ name }, i) => {
      if (!fits[i]) return;
      const x = fits[i].x - rect.cx, y = fits[i].y - rect.cy;
      bounds[name] = name === 'top' || name === 'bottom' ? -x*s + y*c : x*c + y*s;
    });
    const w = bounds.right - bounds.left, h = bounds.bottom - bounds.top;
    if (w < 1 || h < 1) return null;
    const dx = (bounds.right + bounds.left) / 2, dy = (bounds.bottom + bounds.top) / 2;
    return { ...rect, cx: rect.cx + c*dx - s*dy, cy: rect.cy + s*dx + c*dy,
      width: w, height: h, angle: Math.atan2(s, c) };
  }

  fit.side = fitSide;
  if (typeof module !== 'undefined' && module.exports) module.exports = fit;
  else window.fitRectangleToCanny = fit;
})();

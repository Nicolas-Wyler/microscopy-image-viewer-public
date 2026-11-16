/* Temporary edit guide. All geometry and pixel tests use the unrotated sensor raster. */
'use strict';
(() => {
  let radius = 10; const eps = 1e-9;
  // Walk the cells crossed by the orthogonal segment, including oblique normals.
  // Classify by pixel centre: a single black cell can never supply both hits.
  function midpoint(x, y, nx, ny, width, height, black) {
    const ax = x - nx * radius, ay = y - ny * radius;
    const sx = Math.sign(nx), sy = Math.sign(ny);
    let col = sx < 0 ? Math.ceil(ax) - 1 : Math.floor(ax), row = sy < 0 ? Math.ceil(ay) - 1 : Math.floor(ay);
    const dx = sx ? 1 / Math.abs(nx) : Infinity, dy = sy ? 1 / Math.abs(ny) : Infinity;
    let tx = sx ? ((sx > 0 ? col + 1 : col) - ax) / nx : Infinity;
    let ty = sy ? ((sy > 0 ? row + 1 : row) - ay) / ny : Infinity;
    let neg = -Infinity, pos = Infinity, before, after;
    for (;;) {
      if (col >= 0 && col < width && row >= 0 && row < height && black(col, row)) {
        const distance = (col + .5 - x) * nx + (row + .5 - y) * ny;
        if (distance >= -radius - eps && distance < -eps && distance > neg) {
          neg = distance; before = [col, row];
        } else if (distance <= radius + eps && distance > eps && distance < pos) {
          pos = distance; after = [col, row];
        }
      }
      const t = Math.min(tx, ty);
      if (t >= 2 * radius - eps) break;
      if (tx <= t + eps) { col += sx; tx += dx; }
      if (ty <= t + eps) { row += sy; ty += dy; }
    }
    if (!before || !after) return -1;
    // The mean of the two pixel centres, snapped to the containing native cell.
    return Math.floor((before[1] + after[1] + 1) / 2) * width + Math.floor((before[0] + after[0] + 1) / 2);
  }

  // Unit tangents and side centres in the original sensor frame.
  function sides(rect) {
    const c = Math.cos(rect.angle), s = Math.sin(rect.angle);
    return [
      { name: 'top', x: rect.cx + s*rect.height/2, y: rect.cy - c*rect.height/2, ux: c, uy: s, length: rect.width },
      { name: 'bottom', x: rect.cx - s*rect.height/2, y: rect.cy + c*rect.height/2, ux: c, uy: s, length: rect.width },
      { name: 'left', x: rect.cx - c*rect.width/2, y: rect.cy - s*rect.width/2, ux: -s, uy: c, length: rect.height },
      { name: 'right', x: rect.cx + c*rect.width/2, y: rect.cy + s*rect.width/2, ux: -s, uy: c, length: rect.height },
    ];
  }

  function midpointCells(side, fraction, width, height, black, visit) {
    const { x, y, ux, uy, length } = side;
    let lo = -length * fraction / 2, hi = -lo;
    for (const [p, u, size] of [[x, ux, width], [y, uy, height]]) {
      if (Math.abs(u) < eps) { if (p < -radius || p > size + radius) return; continue; }
      const a = (-radius - p) / u, b = (size + radius - p) / u;
      lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b));
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) return;
    const steps = Math.ceil(hi - lo);
    for (let i = 0; i <= steps; i++) {
      const t = lo + (steps ? i / steps * (hi - lo) : 0);
      const index = midpoint(x + t * ux, y + t * uy, -uy, ux, width, height, black);
      if (index >= 0) visit(index);
    }
  }

  // Visit every actual black cell in the oriented strip. Scan across its short
  // dimension so rotating a large rectangle never requires reading its interior.
  function contourCells(side, fraction, width, height, black, visit) {
    const half = side.length * fraction / 2;
    const byColumn = Math.abs(side.ux) >= Math.abs(side.uy);
    const along = byColumn ? side.ux : side.uy, across = byColumn ? side.uy : side.ux;
    const a = byColumn ? side.x : side.y, b = byColumn ? side.y : side.x;
    const reach = Math.abs(along) * half + Math.abs(across) * radius;
    const first = Math.max(0, Math.ceil(a - reach - .5 - eps));
    const last = Math.min((byColumn ? width : height) - 1, Math.floor(a + reach - .5 + eps));
    for (let i = first; i <= last; i++) {
      const offset = i + .5 - a;
      const middle = b + offset * across / along, span = radius / Math.abs(along);
      const low = Math.max(0, Math.ceil(middle - span - .5 - eps));
      const high = Math.min((byColumn ? height : width) - 1, Math.floor(middle + span - .5 + eps));
      for (let j = low; j <= high; j++) {
        const col = byColumn ? i : j, row = byColumn ? j : i;
        if (Math.abs(offset * along + (j + .5 - b) * across) <= half + eps && black(col, row)) {
          visit(row * width + col);
        }
      }
    }
  }
  function find(rect, width, height, black) {
    const pixels = new Set();
    for (const side of sides(rect)) midpointCells(side, 1, width, height, black, i => pixels.add(i));
    return pixels;
  }

  const sampling = { get radius() { return radius; }, setMidpointRadius(value) { if (Number.isFinite(value)) radius = Math.max(1,Math.min(100,Math.round(value))); }, sides, contourCells, midpointCells, find, midpoint };
  if (typeof module !== 'undefined' && module.exports) { module.exports = sampling; return; }
  window.CannySampling = sampling;
  sampling.raster = raster;

  // Each decoded Canny frame is read only if it is actually edited.
  const rasters = new WeakMap();
  function raster(image) {
    if (!rasters.has(image)) {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(image, 0, 0);
      const bytes = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const width = canvas.width;
      rasters.set(image, (x, y) => bytes[(y * width + x) * 4] === 0);
      canvas.width = canvas.height = 0;
    }
    return rasters.get(image);
  }

  window.createCannyMidpointGuide = function () {
    const layer = document.getElementById('canny-midpoints');
    const clip = layer.querySelector('svg');
    const contours = clip.querySelector('.canny-contours'), midpoints = clip.querySelector('.canny-centres');
    return function draw(rects, context, viewport) {
      const image = rects.length && context.ready ? context.getMidpointMask() : null;
      if (!image) { layer.setAttribute('hidden', ''); return; }
      const width = image.naturalWidth, height = image.naturalHeight, black = raster(image);
      const pixels = new Set(), edges = new Set();
      for (const rect of rects) {
        for (const side of rect.boundarySides || sides(rect)) {
          midpointCells(side, 1, width, height, black, i => pixels.add(i));
          if (context.filter !== 'canny') contourCells(side, 1, width, height, black, i => edges.add(i));
        }
      }
      layer.toggleAttribute('hidden', !pixels.size && !edges.size);
      if (!pixels.size && !edges.size) return;
      const scale = context.scale;
      clip.setAttribute('x', (viewport.clientWidth - context.width * scale) / 2 + context.panX);
      clip.setAttribute('y', (viewport.clientHeight - context.height * scale) / 2 + context.panY);
      clip.setAttribute('width', context.width * scale); clip.setAttribute('height', context.height * scale);
      const [[a, c, tx], [b, d, ty]] = window.GratingGeometry.viewMatrix(context.entry, context.view);
      clip.querySelector('g').setAttribute('transform', 'matrix(' + [a, b, c, d, tx, ty].map(v => v * scale).join(' ') + ')');
      const cellPath = cells => Array.from(cells, i => 'M' + i % width + ' ' + Math.floor(i / width) + 'h1v1h-1z').join('');
      contours.setAttribute('d', cellPath(edges));
      midpoints.setAttribute('d', cellPath(pixels));
    };
  };
})();

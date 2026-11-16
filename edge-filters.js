/* Native-size display filters. Pure function, shared by the worker and Node checks. */
'use strict';
(() => {
  function gaussianWeights(sigma) {
    if (sigma === 1) return [1/16,4/16,6/16,4/16,1/16];
    const base = [1,4,6,4,1];
    const values=base.map((v,i)=>v*Math.exp(((i-2)**2)*(1-1/(sigma*sigma))/2));
    const total=values.reduce((a,b)=>a+b,0); return values.map(v=>v/total);
  }
  function processEdges({ rgba, width, height, mode, settings = {} }) {
    if (!['scharr', 'canny'].includes(mode)) throw new Error('Unknown edge view.');
    const count = width * height;
    if (rgba.length !== count * 4) throw new Error('Image dimensions do not match pixels.');
    const gray = new Float32Array(count), temporary = new Float32Array(count);
    for (let i = 0; i < count; i++) gray[i] = .299 * rgba[i * 4] + .587 * rgba[i * 4 + 1] + .114 * rgba[i * 4 + 2];
    // Light separable Gaussian smoothing; clamp at the image border.
    const sigma=Number.isFinite(settings.sigma)?Math.max(.4,Math.min(2.5,settings.sigma)):1;
    const weights=gaussianWeights(sigma);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -2; k <= 2; k++) sum += weights[k + 2] * gray[y * width + Math.max(0, Math.min(width - 1, x + k))];
      temporary[y * width + x] = sum;
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -2; k <= 2; k++) sum += weights[k + 2] * temporary[Math.max(0, Math.min(height - 1, y + k)) * width + x];
      gray[y * width + x] = sum;
    }
    const magnitude = new Float32Array(count), direction = mode === 'canny' ? new Uint8Array(count) : null;
    const outer = mode === 'scharr' ? 3 : 1, inner = mode === 'scharr' ? 10 : 2, divisor = mode === 'scharr' ? 32 : 8;
    let maximum = 0;
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const gx = (outer * (gray[i - width + 1] + gray[i + width + 1] - gray[i - width - 1] - gray[i + width - 1]) + inner * (gray[i + 1] - gray[i - 1])) / divisor;
      const gy = (outer * (gray[i + width - 1] + gray[i + width + 1] - gray[i - width - 1] - gray[i - width + 1]) + inner * (gray[i + width] - gray[i - width])) / divisor;
      const m = Math.hypot(gx, gy); magnitude[i] = m; maximum = Math.max(maximum, m);
      if (direction) direction[i] = Math.abs(gy) <= .41421356 * Math.abs(gx) ? 0
        : Math.abs(gy) >= 2.41421356 * Math.abs(gx) ? 2 : gx * gy >= 0 ? 1 : 3;
    }
    function percentile(values, fraction) {
      const histogram = new Uint32Array(1024); let total = 0;
      for (let i = 0; i < count; i++) if (values[i] > 1e-6) {
        histogram[Math.min(1023, Math.floor(values[i] / maximum * 1023))]++; total++;
      }
      const target = Math.ceil(total * fraction); let cumulative = 0;
      for (let bin = 0; bin < histogram.length; bin++) {
        cumulative += histogram[bin];
        if (cumulative >= target) return bin / 1023 * maximum;
      }
      return maximum;
    }
    const result = new Uint8ClampedArray(count * 4);
    result.fill(255); // Display dark edges on a light background.
    if (maximum < 1e-6) return { rgba: result, width, height };
    if (mode === 'scharr') {
      const contrast = Math.max(percentile(magnitude, .995), maximum * .2);
      for (let i = 0; i < count; i++) {
        const value = 255 * (1 - Math.min(1, Math.pow(magnitude[i] * (settings.edgeGain ?? 1) / contrast, settings.edgeGamma ?? .65)));
        result[i * 4] = result[i * 4 + 1] = result[i * 4 + 2] = value;
      }
    } else {
      // Canny: non-maximum suppression, then two-threshold connected-edge tracing.
      temporary.fill(0);
      const offsets = [1, width + 1, width, width - 1];
      for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
        const i = y * width + x, offset = offsets[direction[i]], m = magnitude[i];
        if (m >= magnitude[i - offset] && m > magnitude[i + offset]) temporary[i] = m;
      }
      const high = Math.max(percentile(temporary, .9), maximum * .1) * (settings.cannyThreshold ?? 1), low = high * (settings.cannyLowRatio ?? .4);
      const marks = new Uint8Array(count), queue = new Int32Array(count); let head = 0, tail = 0;
      for (let i = 0; i < count; i++) {
        if (temporary[i] >= high) { marks[i] = 2; queue[tail++] = i; }
        else if (temporary[i] >= low) marks[i] = 1;
      }
      while (head < tail) {
        const i = queue[head++], x = i % width, y = Math.floor(i / width);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
          const next = i + dy * width + dx;
          if (marks[next] === 1) { marks[next] = 2; queue[tail++] = next; }
        }
      }
      for (let i = 0; i < count; i++) if (marks[i] === 2) result[i * 4] = result[i * 4 + 1] = result[i * 4 + 2] = 0;
    }
    return { rgba: result, width, height };
  }
  if (typeof module !== 'undefined' && module.exports) { module.exports = processEdges; module.exports.gaussianWeights = gaussianWeights; }
  else { window.processEdges = processEdges; window.gaussianWeights = gaussianWeights; }
})();

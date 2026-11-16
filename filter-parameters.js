/* Shared, persistent controls for the 50× image filters. */
'use strict';
(async () => {
  try { await window.OM13Storage.ready; } catch { return; }
  const defaults = Object.freeze({ sigma: 1, cannyThreshold: 1, cannyLowRatio: .4,
    edgeGain: 1, edgeGamma: .65, midpointRadius: 10 });
  const controls = [
    { key: 'sigma', id: 'filter-sigma', min: .4, max: 2.5 },
    { key: 'cannyThreshold', id: 'filter-canny-threshold', min: .5, max: 5 },
    { key: 'cannyLowRatio', id: 'filter-canny-low', min: .1, max: .9 },
    { key: 'edgeGain', id: 'filter-edge-gain', min: .25, max: 4 },
    { key: 'edgeGamma', id: 'filter-edge-gamma', min: .3, max: 2 },
    { key: 'midpointRadius', id: 'filter-midpoint-radius', min: 1, max: 100 }
  ].filter(control=>document.getElementById(control.id));
  const byId = id => document.getElementById(id);
  const saved = window.OM10Session.get('filterParameters', {});
  const settings = {...defaults};
  for (const control of controls) {
    const value = saved?.[control.key];
    settings[control.key] = Number.isFinite(value) && value >= control.min && value <= control.max
      ? (control.key === 'midpointRadius' ? Math.round(value) : value) : defaults[control.key];
  }
  window.CannySampling.setMidpointRadius(settings.midpointRadius);
  const toggle = byId('filter-parameters-toggle'), panel = byId('filter-parameters');
  const kernels = byId('filter-kernels'), tables = byId('filter-kernel-tables');
  let pixelSizeUm = null, timer = null;
  const listeners = new Set(), pending = new Set();
  function output(control) {
    const value = settings[control.key];
    if (control.key === 'sigma') return value.toFixed(2) + ' px';
    if (control.key === 'cannyThreshold' || control.key === 'edgeGain') return value.toFixed(2) + '×';
    if (control.key === 'cannyLowRatio') return Math.round(value * 100) + '%';
    if (control.key === 'edgeGamma') return value.toFixed(2);
    return value + ' px' + (Number.isFinite(pixelSizeUm) ? ' · ±' + (value * pixelSizeUm).toFixed(2) + ' µm' : ' per side');
  }
  function updateUI() {
    for (const control of controls) {
      byId(control.id).value = String(settings[control.key]);
      byId(control.id + '-value').textContent = output(control);
    }
    if (kernels.open) renderKernels();
  }
  function table(title, values, parent = tables) {
    const heading = document.createElement('p'); heading.className = 'filter-kernel-title'; heading.textContent = title;
    const node = document.createElement('table'); node.className = 'filter-kernel'; node.setAttribute('aria-label', title);
    const body = document.createElement('tbody');
    for (const row of values) {
      const tr = document.createElement('tr');
      for (const value of row) { const td = document.createElement('td'); td.textContent = (value * 100).toFixed(2); tr.append(td); }
      body.append(tr);
    }
    node.append(body); parent.append(heading, node);
  }
  function renderKernels() {
    tables.replaceChildren();
    const weights = window.gaussianWeights(settings.sigma);
    table('Shared smoothing · 5 × 5', weights.map(y => weights.map(x => x * y)));
    function pair(leftTitle, left, rightTitle, right, divisor) {
      const container = document.createElement('div'); container.className = 'filter-kernel-pair';
      const x = document.createElement('div'), y = document.createElement('div');
      table(leftTitle, left.map(row => row.map(v => v / divisor)), x);
      table(rightTitle, right.map(row => row.map(v => v / divisor)), y);
      container.append(x, y); tables.append(container);
    }
    pair('Canny Sobel X · 3 × 3', [[-1,0,1],[-2,0,2],[-1,0,1]],
      'Canny Sobel Y · 3 × 3', [[-1,-2,-1],[0,0,0],[1,2,1]], 8);
    if(byId('filter-scharr'))pair('Scharr X · 3 × 3', [[-3,0,3],[-10,0,10],[-3,0,3]],
      'Scharr Y · 3 × 3', [[-3,-10,-3],[0,0,0],[3,10,3]], 32);
  }
  function broadcast() {
    if (!pending.size) return;
    const changed = new Set(pending); pending.clear();
    for (const listener of listeners) listener({ ...settings }, changed);
  }
  function changed(keys) {
    window.CannySampling.setMidpointRadius(settings.midpointRadius);
    window.OM10Session.set('filterParameters', { ...settings });
    updateUI();
    keys.forEach(key => pending.add(key));
    // Emit immediately, then at most every 120 ms while a slider is moving.
    if (!timer) {
      broadcast();
      const tick = () => {
        timer = null;
        if (pending.size) { broadcast(); timer = setTimeout(tick, 120); }
      };
      timer = setTimeout(tick, 120);
    }
  }
  for (const control of controls) {
    byId(control.id).addEventListener('input', event => {
      let value = Number(event.target.value);
      if (!Number.isFinite(value)) return;
      value = Math.max(control.min, Math.min(control.max, value));
      if (control.key === 'midpointRadius') value = Math.round(value);
      if (settings[control.key] === value) return;
      settings[control.key] = value; changed([control.key]);
    });
  }
  kernels.addEventListener('toggle', () => { if (kernels.open) renderKernels(); });
  byId('filter-parameters-reset').addEventListener('click', () => {
    const keys = controls.map(control => control.key).filter(key => settings[key] !== defaults[key]);
    if (!keys.length) return;
    Object.assign(settings, defaults); changed(keys);
  });
  function positionPanel() {
    if (panel.hidden) return;
    if (window.OM11PopupDrag?.restore(panel)) return;
    const anchor = toggle.getBoundingClientRect(), width = panel.getBoundingClientRect().width;
    panel.style.left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8)) + 'px';
    panel.style.top = Math.max(8, Math.min(anchor.bottom + 7, window.innerHeight - 100)) + 'px';
    panel.style.maxHeight = Math.max(90, window.innerHeight - parseFloat(panel.style.top) - 8) + 'px';
  }
  function close() { panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); }
  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden; toggle.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) positionPanel();
  });
  byId('filter-parameters-close').addEventListener('click', () => { close(); toggle.focus(); });
  document.addEventListener('pointerdown', event => {
    if (!panel.hidden && !panel.contains(event.target) && !toggle.contains(event.target)) close();
  }, true);
  document.addEventListener('keydown', event => {
    if (!panel.hidden && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); toggle.focus(); }
  }, true);
  window.addEventListener('resize', positionPanel);
  window.OM10Filters = {
    get: () => ({ ...settings }),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setPixelSize(value) { pixelSizeUm = value; updateUI(); }
  };
  updateUI();
})();

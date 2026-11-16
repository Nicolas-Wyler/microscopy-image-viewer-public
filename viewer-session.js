/* Local UI preferences are stored separately from the existing per-TIFF rectangle files. */
'use strict';
(() => {
  const data = window.OM10_DATA;
  if (!data) return;
  const project = document.getElementById('project-csv');
  let scope = '';
  if (project) {
    // The bare notebook link starts a copy. Its working URL survives reload and reopen.
    const match = /^#work=([0-9a-f-]{36})$/.exec(location.hash);
    const id = match ? match[1] : crypto.randomUUID();
    const fragment = '#work=' + id;
    if (!match) history.replaceState(null, '', fragment);
    window.addEventListener('hashchange', () => {
      if (location.hash !== fragment) location.reload();
    });
    scope = 'om10-copy:' + project.dataset.project + ':' + id + ':';
  }
  const defaults = new Map(Object.entries(window.OM11SessionSnapshot?.preferences ?? {}));
  const prefix = scope + 'om10-viewer:session:v1:' + data.exposure + ':' + data.mask + ':';
  const cache = new Map();
  let warned = false;
  function scopedName(name) {
    if (name === 'view') name = 'view-om13-aligned-v1';
    const sideScoped = name.startsWith('comparisons:') || name === 'rectangleHistory' || name === 'pitchCards';
    return sideScoped && get('pictureSide', 'top') === 'bottom' ? 'picture-bottom:' + name : name;
  }
  function get(name, fallback) {
    name = scopedName(name);
    if (!cache.has(name)) {
      try {
        const raw = window.OM13Storage.getItem(prefix + name);
        if (raw !== null) cache.set(name, JSON.parse(raw));
      } catch { /* Use defaults if this preference is unavailable. */ }
    }
    return cache.get(name) ?? defaults.get(name) ?? fallback;
  }
  function set(name, value) {
    name = scopedName(name);
    cache.set(name, value);
    try { window.OM13Storage.setItem(prefix + name, JSON.stringify(value)); }
    catch (error) {
      if (!warned) {
        warned = true;
        console.warn('Viewer session changes could not be saved for reopening.', error);
      }
    }
  }
  window.addEventListener('storage', event => {
    if (event.key === null) cache.clear();
    else if (event.key.startsWith(prefix)) cache.delete(event.key.slice(prefix.length));
  });
  function keyForSide(name, side) {
    if (!['top', 'bottom'].includes(side)) throw new Error('Unknown picture side.');
    return side === 'bottom' ? 'picture-bottom:' + name : name;
  }
  function getForSide(name, side, fallback) {
    const key = keyForSide(name, side);
    if (!cache.has(key)) {
      try { const raw = window.OM13Storage.getItem(prefix + key); if (raw !== null) cache.set(key, JSON.parse(raw)); }
      catch { /* Use defaults when unavailable. */ }
    }
    return cache.get(key) ?? defaults.get(key) ?? fallback;
  }
  function setForSide(name, side, value) {
    const key = keyForSide(name, side);
    window.OM13Storage.setItem(prefix + key, JSON.stringify(value));
    cache.set(key, value);
  }
  function removeForSide(name, side) {
    const key = keyForSide(name, side);
    window.OM13Storage.removeItem(prefix + key);
    cache.delete(key);
  }
  window.OM10Session = { get, set, getForSide, setForSide, removeForSide, scope, defaults };


  // Restore after the first image has populated both panels. Hidden panels regain
  // their scroll position the next time the user opens them.
  window.restoreViewerPanels = function () {
    for (const selector of ['#left-sidebar-content', '#position-panel .rectangle-scroll', '#analysis-panel .rectangle-scroll', 'html']) {
      const panel = document.querySelector(selector), key = 'scroll:' + selector;
      const target = panel === document.documentElement ? document : panel;
      let visible = false;
      function restoreScroll() {
        const shown = panel.clientHeight > 0;
        if (shown && !visible) panel.scrollTop = Number(get(key, 0)) || 0;
        visible = shown;
      }
      restoreScroll();
      new ResizeObserver(restoreScroll).observe(panel);
      target.addEventListener('scroll', () => {
        if (panel.clientHeight) set(key, panel.scrollTop);
      }, { passive: true });
    }

    const saved = get('focus', {});
    let control = saved.id ? document.getElementById(saved.id) : null;
    if (saved.rectangle) {
      const card = document.querySelector('[data-rectangle-id="' + CSS.escape(saved.rectangle) + '"]');
      control = saved.field ? card?.querySelector('input[name="' + CSS.escape(saved.field) + '"]') : card?.querySelector('.position-spot');
    } else if (saved.pitch) {
      control = document.querySelector('[data-pitch="' + CSS.escape(saved.pitch) + '"] summary');
    }
    if (control?.getClientRects().length) control.focus({ preventScroll: true });
    function saveFocus() {
      const current = document.activeElement;
      const card = current?.closest('[data-rectangle-id], [data-pitch]');
      set('focus', { id: current?.id, rectangle: card?.dataset.rectangleId, field: current?.name, pitch: card?.dataset.pitch });
    }
    document.addEventListener('focusin', saveFocus);
    window.addEventListener('pagehide', saveFocus);
  };
})();

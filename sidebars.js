'use strict';
window.setupViewerSidebars = function (setCompareActive) {
  const tabs = [...document.querySelectorAll('#right-sidebar-tabs [role="tab"]')];
  function showTab(active) {
    for (const tab of tabs) {
      const shown = tab === active;
      tab.setAttribute('aria-selected', String(shown));
      tab.tabIndex = shown ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')).hidden = !shown;
    }
    if (document.getElementById('legacy-rectangle-import')) document.getElementById('legacy-rectangle-import').hidden = active.id !== 'position-tab';
    setCompareActive?.(active.id === 'compare-tab');
    window.OM10Session.set('sidebarTab', active.id);
  }
  const savedTab = tabs.find(tab => tab.id === window.OM10Session.get('sidebarTab'));
  if (savedTab) showTab(savedTab);
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener('click', () => showTab(tab));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      const step = event.key === 'ArrowLeft' ? -1 : 1;
      let next = tabs[(index + step + tabs.length) % tabs.length];
      if (event.key === 'Home') next = tabs[0];
      if (event.key === 'End') next = tabs.at(-1);
      showTab(next);
      next.focus();
    });
  }
  const storageKey = window.OM10Session.scope + 'om10-viewer:sidebar-layout:v1';
  let preferences = {};
  try {
    const saved = JSON.parse(window.OM13Storage.getItem(storageKey));
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) preferences = saved;
  } catch (_) { /* Optional layout preference. */ }
  const sides = ['left', 'right'];
  const minimum = 220, maximum = { left: 420, right: Infinity }, collapsedWidth = 18;
  const panels = Object.fromEntries(sides.map(side => [side, document.getElementById(`${side}-sidebar`)]));
  const dividers = Object.fromEntries(sides.map(side => [side, document.getElementById(`resize-${side}-sidebar`)]));
  let drag = null;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  for (const side of sides) {
    preferences[side] = preferences[side] === true;
    const saved = preferences[side + 'Width'];
    preferences[side + 'Width'] = Number.isFinite(saved) ? clamp(saved, minimum, maximum[side]) : side === 'left' ? 280 : 366;
  }
  const desktop = () => window.innerWidth > 700;
  const mainMinimum = () => Math.min(320, window.innerWidth - 2 * minimum);
  function limit(side) {
    const other = side === 'left' ? 'right' : 'left';
    return Math.max(minimum, Math.min(maximum[side], window.innerWidth - panels[other].getBoundingClientRect().width - mainMinimum()));
  }
  function save() {
    try { window.OM13Storage.setItem(storageKey, JSON.stringify(preferences)); } catch (_) { /* Layout still works. */ }
  }
  function render() {
    const widths = Object.fromEntries(sides.map(side => [side, preferences[side] ? collapsedWidth : preferences[side + 'Width']]));
    // Fit saved preferences to a narrower window without losing their preferred widths.
    const excess = Math.max(0, widths.left + widths.right + mainMinimum() - window.innerWidth);
    const capacity = sides.reduce((sum, side) => sum + (preferences[side] ? 0 : widths[side] - minimum), 0);
    if (desktop() && excess && capacity) for (const side of sides) {
      if (!preferences[side]) widths[side] -= Math.min(1, excess / capacity) * (widths[side] - minimum);
    }
    for (const side of sides) {
      const collapsed = preferences[side] === true;
      const button = document.getElementById(`toggle-${side}-sidebar`);
      document.body.classList.toggle(`${side}-collapsed`, collapsed);
      document.body.style.setProperty(`--${side}-sidebar-expanded-width`, `${widths[side]}px`);
      button.setAttribute('aria-expanded', String(!collapsed));
      button.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${side} sidebar`);
      button.title = button.getAttribute('aria-label');
      button.textContent = desktop() ? ((side === 'left') !== collapsed ? '‹' : '›')
        : ((side === 'left') !== collapsed ? '⌃' : '⌄');
    }
    for (const side of sides) {
      const collapsed = preferences[side];
      dividers[side].setAttribute('aria-valuemin', String(collapsed ? collapsedWidth : minimum));
      dividers[side].setAttribute('aria-valuemax', String(limit(side)));
      dividers[side].setAttribute('aria-valuenow', String(Math.round(widths[side])));
      dividers[side].setAttribute('aria-valuetext', collapsed ? 'Collapsed' : `${Math.round(widths[side])} pixels`);
    }
  }
  function captureWidths() {
    for (const side of sides) if (!preferences[side]) preferences[side + 'Width'] = clamp(panels[side].getBoundingClientRect().width, minimum, maximum[side]);
  }
  function resize(side, width) {
    preferences[side] = false;
    preferences[side + 'Width'] = clamp(width, minimum, limit(side));
    render();
  }
  function finish(cancel = false) {
    if (!drag) return;
    const previous = drag; drag = null;
    if (cancel) preferences = previous.preferences;
    document.body.classList.remove('resizing-sidebar');
    if (dividers[previous.side].hasPointerCapture(previous.id)) dividers[previous.side].releasePointerCapture(previous.id);
    render(); save();
  }
  for (const side of ['left', 'right']) {
    const button = document.getElementById(`toggle-${side}-sidebar`);
    button.addEventListener('click', () => {
      finish(); preferences[side] = !preferences[side]; render(); save();
    });
    const divider = dividers[side];
    divider.addEventListener('pointerdown', event => {
      if (!desktop() || event.button !== 0 || drag) return;
      event.preventDefault(); event.stopPropagation();
      drag = { side, id: event.pointerId, x: event.clientX, width: panels[side].getBoundingClientRect().width, preferences: { ...preferences } };
      captureWidths(); divider.focus({ preventScroll: true }); divider.setPointerCapture(event.pointerId);
      document.body.classList.add('resizing-sidebar');
    });
    divider.addEventListener('pointermove', event => {
      if (!drag || drag.side !== side || drag.id !== event.pointerId) return;
      const delta = event.clientX - drag.x;
      if (!drag.moved && Math.abs(delta) < 3) return;
      drag.moved = true;
      event.preventDefault(); resize(side, drag.width + (side === 'left' ? delta : -delta));
    });
    divider.addEventListener('pointerup', event => { if (drag?.id === event.pointerId) finish(); });
    divider.addEventListener('pointercancel', event => { if (drag?.id === event.pointerId) finish(true); });
    divider.addEventListener('lostpointercapture', () => finish());
    divider.addEventListener('keydown', event => {
      if (!desktop() || !['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'Escape') { finish(true); return; }
      captureWidths();
      const step = event.shiftKey ? 50 : 10;
      const change = (event.key === 'ArrowRight' ? 1 : -1) * (side === 'left' ? 1 : -1) * step;
      resize(side, event.key === 'Home' ? minimum : event.key === 'End' ? limit(side) : panels[side].getBoundingClientRect().width + change);
      save();
    });
  }
  window.addEventListener('resize', () => { finish(); render(); });
  window.addEventListener('blur', () => finish());
  window.addEventListener('pagehide', () => finish());
  render();
};

window.rectangleSpotDefinitions = () => window.OM10_MASK.rows.flatMap((row, rowIndex) => [
  ...['left', 'right'].flatMap(side =>
    [['m1', '−1'], ['zero', '0'], ['p1', '+1']].map(([order, label], index) => ({
      id: `spot-${row.id}-${side}-${order}`, row: row.id, rowIndex,
      side, order: index - 1, pitch: row.pitchNm, maskPitchNm: row.maskPitchNm, variant: row.variant, electronDose: row.electronDose,
      title: `${side} · ${row.variant} · ${row.pitchNm} nm · ${label}`,
    }))),
  { id: `spot-${row.id}-both-inner_pair`, row: row.id, rowIndex,
    side: 'both', order: 'inner_pair', pitch: row.pitchNm, maskPitchNm: row.maskPitchNm,
    variant: row.variant, electronDose: row.electronDose,
    title: `inner ±1 pair · ${row.variant} · ${row.pitchNm} nm` },
]);

window.createRectangleList = function ({ ordered, onSelect, onEdit, onPreview, getRectangles, getComparisons, prepareProfiles, getExportSettings, onImport, onImportLegacy }) {
  const list = document.getElementById('rectangle-list');
  const cards = new Map();
  const expanded = new Map(window.OM10Session.get('positionPitchCards', []));
  let signature = null, current, edit = null;
  const parameters = { x: 'Centre X · µm', y: 'Centre Y · µm', width: 'Width · µm', height: 'Height · µm',
    rotation: 'Rotation · ° clockwise' };
  const element = (tag, className, text) => {
    const node = document.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  function finishEdit(cancel = false) {
    if (!edit) return;
    const { input, initial, id, filename, view } = edit;
    edit = null;
    if (!cancel && input.validity.valid && input.value !== initial) {
      onEdit(id, input.name, input.valueAsNumber, filename, view);
    }
    input.value = input.defaultValue;
    onPreview();
  }
  list.addEventListener('focusin', event => {
    const input = event.target;
    if (!input.matches('.rectangle-input')) return;
    const id = input.closest('[data-rectangle-id]').dataset.rectangleId;
    input.value = input.dataset.precise;
    edit = { input, initial: input.value, id, filename: current.entry.filename, view: current.view };
    onSelect(id);
    input.select();
  });
  list.addEventListener('focusout', event => {
    if (edit?.input === event.target) finishEdit();
  });
  list.addEventListener('input', event => { if (event.target === edit?.input) onPreview(); });
  list.addEventListener('keydown', event => {
    if (!edit || !['Escape', 'Enter'].includes(event.key)) return;
    event.preventDefault();
    const input = edit.input;
    if (event.key === 'Enter' && !input.reportValidity()) return;
    finishEdit(event.key === 'Escape');
    input.blur();
  });
  window.addEventListener('pagehide', () => finishEdit());
  const exportStatus = document.getElementById('rectangle-export-status');
  const importButton = document.getElementById('import-rectangles');
  const fileInput = document.getElementById('rectangle-csv-file');
  importButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    importButton.disabled = true;
    try {
      const text=await file.text();
      if(window.OM10_DATA.importedProject && window.ViewerLegacyImport.recognizes(text)){
        const parsed=await window.ViewerLegacyImport.prepare(text,window.OM10_DATA,(n,total)=>{exportStatus.textContent=`Checking TIFF checksums ${n} / ${total}…`;});
        const result=onImportLegacy(parsed.groups),parts=[`Imported ${result.imported} rectangles for ${parsed.matched} verified images.`];
        if(result.conflicts)parts.push(`${result.conflicts} existing rectangles kept.`);
        if(parsed.missing.length)parts.push(`${parsed.missing.length} source images not loaded.`);
        if(parsed.mismatch.length)parts.push(`${parsed.mismatch.length} image checksums did not match.`);
        if(parsed.ambiguous.length)parts.push(`${parsed.ambiguous.length} filenames are ambiguous.`);
        if(parsed.unmatchedSpots)parts.push(`${parsed.unmatchedSpots} spots did not match the mask; check SADP and geometry.`);
        exportStatus.textContent=parts.join(' ');return;
      }
      const parsed = window.readRectangleCsv(text, window.OM10_DATA, ordered);
      if (parsed.emptyProject) {
        exportStatus.textContent = 'The imported project contains no rectangles or comparisons.';
        return;
      }
      onImport(parsed);
      const groups = [...parsed.groupsBySide.values()];
      const count = groups.reduce((sum, sideGroups) => sum + [...sideGroups.values()].reduce((n, items) => n + items.size, 0), 0);
      const slots = groups.reduce((sum, sideGroups) => sum + sideGroups.size, 0);
      const comparisons = [...parsed.comparisonsBySide.values()].reduce((sum, rows) => sum + rows.length, 0);
      exportStatus.textContent = `Imported ${count} rectangle${count === 1 ? '' : 's'}${comparisons ? ' and '+comparisons+' comparison'+(comparisons === 1 ? '' : 's') : ''} for ${slots} picture slot${slots === 1 ? '' : 's'}.`;
    } catch (error) {
      exportStatus.textContent = `Import failed. ${error.message}`;
    } finally {
      fileInput.value = ''; importButton.disabled = false;
    }
  });
  for (const [buttonId, all] of [['export-dose', false], ['export-all', true]]) {
    const button = document.getElementById(buttonId);
    button.addEventListener('click', async () => {
      finishEdit(); button.disabled = true;
      const entries = all ? window.OM10_DATA.images : [current.entry];
      try {
        const result = all
          ? await window.downloadFullRectangleCsv(entries, ordered, getRectangles, getComparisons, prepareProfiles,
              getExportSettings(), message => { exportStatus.textContent = message; })
          : window.downloadRectangleCsv(entries, ordered, getRectangles, false, getComparisons);
        const {rectangles: count, comparisons, unavailableProfiles = 0} = result;
        exportStatus.textContent = count ? `Exported ${count} rectangle${count === 1 ? '' : 's'}${all && comparisons ? ' and '+comparisons+' comparison'+(comparisons === 1 ? '' : 's') : ''}.` :
          all ? 'Exported an empty project with all Top and Bottom picture slots.' : 'No rectangles in this picture.';
        if (unavailableProfiles) exportStatus.textContent += ` ${unavailableProfiles} integral center(s) unavailable; see CSV.`;
      } catch (error) { exportStatus.textContent = `Export failed. ${error.message}`; }
      finally { button.disabled = false; }
    });
  }
  return { fieldEdit() {
    if (!edit || edit.filename !== current.entry.filename || edit.view !== current.view) return null;
    const { input, initial, id } = edit;
    return { id, name: input.name, value: input.value !== initial && input.validity.valid ? input.valueAsNumber : null };
  }, update(snapshot) {
    if (current?.entry !== snapshot.entry || current?.view !== snapshot.view) exportStatus.textContent = '';
    current = snapshot;
    const active = new Map(snapshot.active.map(rect => [rect.id, rect]));
    const present = ordered.filter(spot => active.has(spot.id)).sort((a,b) =>
      a.pitch - b.pitch || a.side.localeCompare(b.side) || b.variant.localeCompare(a.variant) || a.order - b.order);
    const generic = window.OM10_DATA.importedProject;
    const doseLevels = new Map();
    if (generic) for (const item of window.OM10_DATA.maskDesign?.spots?.values() || []) {
      const pitch = item.grating.effectivePitch ?? item.grating.pitch, dose = item.grating.dose;
      if (!Number.isFinite(pitch) || !Number.isFinite(dose)) continue;
      if (!doseLevels.has(pitch)) doseLevels.set(pitch, new Set());
      doseLevels.get(pitch).add(dose);
    }
    function compactSpotLabel(spot, order) {
      if (!generic) return spot.shortLabel || (spot.side === 'both' ? 'Pair' : [spot.side === 'left' ? 'L' : 'R', spot.variant, order].join('·'));
      const side = ({left:'L', right:'R', both:'L/R', unknown:'?'})[spot.side] || '?';
      const variants = [...new Set((spot.group?.spots || []).map(item => {
        const levels = [...(doseLevels.get(item.grating.effectivePitch ?? item.grating.pitch) || [])].sort((a,b) => a-b);
        if (levels.length < 2) return '';
        const index = levels.indexOf(item.grating.dose); return index < 0 ? 'e?' : `e${index}`;
      }).filter(Boolean))];
      return [side, variants.join('/'), order].filter(Boolean).join(' ');
    }
    const doseKey = snapshot.entry.filename + '|';
    const nextSignature = doseKey + present.map(spot => spot.id).join('|');
    document.getElementById('rectangle-count').textContent = present.length;
    const selectedCount = snapshot.active.filter(rect => rect.selected).length;
    document.getElementById('rectangle-selection-count').textContent = selectedCount ? selectedCount + ' selected' : '';
    document.getElementById('rectangle-empty').hidden = present.length > 0;
    document.getElementById('rectangle-coordinate-note').textContent = window.OM10_DATA.previewEmpty ? 'No image loaded.' : snapshot.entry.hasCalibration===false ? 'Calibration unavailable.' : `${snapshot.entry.name || snapshot.entry.sourceFilename || snapshot.entry.filename.replace('.tif', '')} · ${snapshot.view === 'cropped' ? 'crop' : 'original'} coordinates. Origin at bottom-left; X right, Y up. Lengths in µm; θ clockwise.`;
    if (signature !== nextSignature) {
      signature = nextSignature; cards.clear(); list.replaceChildren();
      if (present.length) {
        const header = element('div', 'position-columns position-header');
        for (const text of ['Spot', 'X', 'Y', 'W', 'H', 'Δ%', 'θ°']) {
          const label=element('span', '', text);
          if (text === 'Δ%') label.title='(height / width − 1) × 100';
          header.append(label);
        }
        list.append(header);
      }
      let group;
      for (const spot of present) {
        if (group?.dataset.positionPitch !== String(spot.pitch)) {
          const pitchCard = element('details', 'position-pitch');
          pitchCard.dataset.positionPitch = spot.pitch;
          const expansionKey = doseKey + spot.pitch;
          pitchCard.open = expanded.get(expansionKey) !== false;
          const summary = element('summary', '', spot.pitch == null ? 'Pitch unknown' : spot.pitch + ' nm');
          summary.id = 'position-pitch-' + spot.pitch;
          pitchCard.append(summary);
          pitchCard.addEventListener('toggle', () => {
            if (!pitchCard.isConnected || (expanded.get(expansionKey) !== false) === pitchCard.open) return;
            expanded.set(expansionKey, pitchCard.open);
            window.OM10Session.set('positionPitchCards', [...expanded]);
          });
          group = pitchCard; list.append(group);
        }
        const card = element('div', 'position-columns position-row');
        card.dataset.rectangleId = spot.id;
        const order = spot.order === 'inner_pair' ? '±1' : ['−1', '0', '+1'][spot.order + 1];
        const button = element('button', 'position-spot', compactSpotLabel(spot, order));
        const label = generic ? compactSpotLabel(spot, order) + ' · ' + (spot.pitch == null ? 'pitch unknown' : spot.pitch + ' nm') : spot.title;
        button.title = label + ' · ⌘-click to add or remove from selection';
        button.setAttribute('aria-label', label);
        button.addEventListener('click', event => {
          if (current.ready) onSelect(spot.id, event.metaKey ? 'toggle' : 'only');
        });
        card.append(button);
        const inputs = {};
        let deviation;
        for (const [name, caption] of Object.entries(parameters)) {
          if (name === 'rotation') {
            deviation=element('span', 'position-square-deviation');
            card.append(deviation);
          }
          const input = element('input', 'rectangle-input');
          input.setAttribute('aria-label', label + ' · ' + caption);
          input.name = name; input.type = 'number'; input.step = 'any'; input.required = true;
          if (name === 'width' || name === 'height') input.min = String(snapshot.entry.pixelSizeUm);
          card.append(input); inputs[name] = input;
        }
        cards.set(spot.id, { card, inputs, deviation }); group.append(card);
      }
    }
    for (const { id } of present) {
      const rect = active.get(id), { card, inputs, deviation } = cards.get(id);
      card.style.setProperty('--rectangle-color', rect.color);
      card.classList.toggle('selected-rectangle', rect.selected);
      const values = window.GratingGeometry.measurements(rect, snapshot.entry, snapshot.view);
      const percent = (values.height / values.width - 1) * 100;
      const rounded = Number(percent.toFixed(1));
      const displayDeviation = (rounded > 0 ? '+' : '') + rounded.toFixed(1);
      deviation.textContent = displayDeviation;
      deviation.title = '(height / width − 1) × 100 = ' + percent.toFixed(3);
      deviation.setAttribute('aria-label', 'Height relative to width: ' + displayDeviation + ' percent');
      for (const [name, input] of Object.entries(inputs)) {
        const display = String(Number(values[name].toFixed(4)));
        input.dataset.precise = display;
        input.title = display + (name === "rotation" ? "°" : " µm");
        input.defaultValue = String(Number(values[name].toFixed(1)));
        if (input !== edit?.input) input.value = input.defaultValue;
        input.disabled = !snapshot.ready;
      }
    }
  } };
};

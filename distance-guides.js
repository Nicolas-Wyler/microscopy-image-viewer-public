/* Screen-space rulers; centres also carry their calibrated displayed-image X in µm. */
'use strict';
window.createDistanceMeasurements = function (mask) {
  const specs = mask.rows.flatMap(row => ['left', 'right'].flatMap(side =>
    [-1, 1].map(order => {
      const prefix = `spot-${row.id}-${side}-`;
      return { pitch: row.pitchNm, maskPitchNm: row.maskPitchNm, side, variant: row.variant, order,
        zeroId: prefix + 'zero', firstId: prefix + (order < 0 ? 'm1' : 'p1'),
        name: `${side} · ${row.variant} · ${order < 0 ? '−1' : '+1'}` };
    })));
  specs.sort((a, b) => a.pitch - b.pitch || a.side.localeCompare(b.side)
    || b.variant.localeCompare(a.variant) || a.order - b.order);
  return function measure(centres) {
    const pairs = [];
    for (const spec of specs) {
      const zero = centres.get(spec.zeroId), first = centres.get(spec.firstId);
      if (!zero || !first) continue;
      const distanceUm = Math.abs(first.xUm - zero.xUm);
      pairs.push({ ...spec, zero, first, distanceUm, formatted: distanceUm.toFixed(1) });
    }
    return pairs;
  };
};
window.createDistanceGuides = function (layer) {
  const svg = tag => document.createElementNS(layer.namespaceURI, tag);
  function strokes(group, className) {
    const halo = svg('path'), ink = svg('path');
    halo.setAttribute('class', 'guide-halo ' + className);
    ink.setAttribute('class', className);
    group.append(halo, ink);
    return d => { halo.setAttribute('d', d); ink.setAttribute('d', d); };
  }
  const guides = new Map();
  function guideFor(zeroId, firstId) {
    const key=zeroId+'|'+firstId;
    if (guides.has(key)) return guides.get(key);
    const group = svg('g'), label = svg('text');
    group.dataset.zeroId = zeroId; group.dataset.firstId = firstId;
    group.setAttribute('role', 'img');
    const leader = strokes(group, 'guide-vertical'), arrow = strokes(group, 'guide-arrow');
    group.append(label); layer.append(group);
    const guide = { group, leader, arrow, label };
    guides.set(key, guide);
    return guide;
  }
  return function draw(pairs, editingId, pinned) {
    const visible = new Set(), labels = [];
    for (const { firstId, zeroId, first, zero, formatted: distance, axis } of pairs) {
      if (!pinned && editingId !== zeroId && editingId !== firstId) continue;
      visible.add(zeroId+'|'+firstId);
      const { group, leader, arrow, label } = guideFor(zeroId, firstId);
      group.style.setProperty('--guide-color', first.color);
      const dx = first.x - zero.x, dy = first.y - zero.y;
      const tip = Math.sign(dx) * Math.min(4, Math.abs(dx) / 3), wing = .55 * Math.abs(tip);
      group.setAttribute('transform', `translate(${zero.x} ${zero.y})`);
      if(axis==='y') {const vtip=Math.sign(dy)*Math.min(4,Math.abs(dy)/3),vwing=.55*Math.abs(vtip);leader(dx?`M0 ${dy}h${dx}`:'');arrow(`M0 0V${dy} M${-vwing} ${vtip}L0 0l${vwing} ${vtip} M${-vwing} ${dy-vtip}L0 ${dy}l${vwing} ${-vtip}`);} else {leader(dy ? `M${dx} 0v${dy}` : '');arrow(`M0 0H${dx} M${tip} ${-wing}L0 0l${tip} ${wing} M${dx-tip} ${-wing}L${dx} 0l${-tip} ${wing}`);}
      label.textContent = distance;
      label.setAttribute('x', axis==='y' ? 5 : dx / 2);
      const halfWidth = distance.length * 3.8;
      const labelX = zero.x + dx / 2;
      let offset = -5;
      for (let lane = 0; lane < labels.length; lane++) {
        if (!labels.some(other => Math.abs(other.x - labelX) < halfWidth + other.halfWidth + 3 && Math.abs(other.y - (zero.y + offset)) < 14)) break;
        offset -= 15;
      }
      label.setAttribute('y', axis==='y' ? dy/2 : offset);
      labels.push({ x: labelX, y: zero.y + offset, halfWidth });
      group.setAttribute('aria-label', `${first.label}, ${axis==='y'?'vertical':'horizontal'} distance from order 0: ${distance}`);
    }
    for (const [id, guide] of guides) if (!visible.has(id)) { guide.group.remove(); guides.delete(id); }
    layer.toggleAttribute('hidden', !visible.size);
  };
};

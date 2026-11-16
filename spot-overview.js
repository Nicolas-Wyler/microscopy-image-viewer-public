/* Spot controls for the available mask rows. */
'use strict';
window.createSpotOverview = function ({ onToggle }) {
  const mask = window.OM10_MASK;
  const diagram = document.getElementById('spot-diagram');
  const visibleRows = side => mask.visiblePitchesBySide?.[side] ? new Set(mask.visiblePitchesBySide[side]) : null;
  const orderLabel = order => order < 0 ? '−1' : order > 0 ? '+1' : '0';
  let active = new Map(), ready = false;
  if (!mask?.rows?.length) {
    document.getElementById('spot-caption').textContent = 'Mask layout unavailable.';
    return { spots: [], exists: () => false, update() {}, refreshSide() {} };
  }
  const allSpots = [];
  for (const [rowIndex, row] of mask.rows.entries()) {
    for (const [side, orders] of [['left',[-1,0]],['right',[0,1]]]) {
      for (const order of orders) {
        const id = `spot-${row.id}-${side}-${order < 0 ? 'm1' : order > 0 ? 'p1' : 'zero'}`;
        const label = `${row.maskPitchNm} nm mask grating, ${row.variant}, ${side} grating, order ${orderLabel(order)}`;
        allSpots.push({ id, rowIndex, side, order, color: window.OM10SpotColors.forSpot(id), label });
      }
    }
    const id = `spot-${row.id}-both-inner_pair`;
    allSpots.push({ id, rowIndex, side:'both', order:'inner_pair', color:window.OM10SpotColors.forSpot(id), label:`${row.maskPitchNm} nm mask grating, ${row.variant}, inner interfering ±1 pair` });
  }
  function currentSide() { return window.OM10Session.get('pictureSide','top') === 'bottom' ? 'bottom' : 'top'; }
  function visible(spot) { const pitches=visibleRows(currentSide());return !pitches||pitches.has(mask.rows[spot.rowIndex].maskPitchNm); }
  function render() {
    diagram.replaceChildren();
    const cell = (text, kind) => {
      const span = document.createElement('span');
      span.className = kind; span.textContent = text; diagram.append(span); return span;
    };
    cell('', ''); cell('Left grating', 'spot-side').style.gridColumn = '2 / span 2'; cell('Pair', 'spot-center'); cell('Right grating', 'spot-side').style.gridColumn = '5 / span 2';
    for (const [rowIndex, row] of mask.rows.entries()) {
      const pitches=visibleRows(currentSide());if (pitches&&!pitches.has(row.maskPitchNm)) continue;
      cell(row.pitchNm + ' ' + row.variant, 'spot-pitch');
      const rowSpots=allSpots.filter(s => s.rowIndex === rowIndex).sort((a,b) => (a.side === 'left' ? 0 : a.side === 'both' ? 1 : 2) - (b.side === 'left' ? 0 : b.side === 'both' ? 1 : 2));
      for (const spot of rowSpots) {
        const [x,y] = spot.side === 'both' ? [(row.leftCentreUm[0]+row.rightCentreUm[0])/2, (row.leftCentreUm[1]+row.rightCentreUm[1])/2] : row[spot.side + 'CentreUm'];
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'expected-spot'; button.id = spot.id;
        button.dataset.row = row.id; button.dataset.grating = spot.side; button.dataset.order = spot.order;
        button.dataset.xUm = x + (spot.side === 'both' ? 0 : spot.order * row.nominalDisplacementUm); button.dataset.yUm = y;
        button.style.gridColumn = spot.side === 'both' ? 4 : spot.side === 'left' ? (spot.order === -1 ? 2 : 3) : (spot.order === 0 ? 5 : 6);
        button.dataset.nominalColor = spot.color; button.dataset.description = spot.label;
        const orderText = document.createElement('span'); orderText.className = 'spot-order'; orderText.textContent = spot.side === 'both' ? '±1' : orderLabel(spot.order);
        const removeText = document.createElement('span'); removeText.className = 'spot-remove'; removeText.textContent = '×'; removeText.setAttribute('aria-hidden', 'true');
        button.append(orderText, removeText); button.addEventListener('click', () => onToggle(spot)); diagram.append(button);
      }
    }
    updateButtons();
  }
  function updateButtons() {
    for (const button of diagram.querySelectorAll('.expected-spot')) {
      const exists = active.has(button.id);
      button.style.setProperty('--spot-color', active.get(button.id) || button.dataset.nominalColor);
      button.classList.toggle('active-spot', exists); button.setAttribute('aria-pressed', String(exists)); button.disabled = !ready;
      const label = `${exists ? 'Remove' : 'Add'} ${button.dataset.description}`;
      button.setAttribute('aria-label', label); button.title = label;
    }
  }
  render();
  return {
    get spots() { return allSpots.filter(visible); },
    exists: id => active.has(id),
    refreshSide() { active = new Map(); ready = false; render(); },
    update(snapshot) { ready = snapshot.ready; active = new Map(snapshot.active.map(item => [item.id, item.color])); updateButtons(); }
  };
};

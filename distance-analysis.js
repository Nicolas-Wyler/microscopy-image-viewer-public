/* Pitch cards share the calibrated pairs used to draw the on-image rulers. */
'use strict';
window.createDistanceAnalysis = function (mask) {
  const list = document.getElementById('analysis-distances');
  const pitches = [...new Set(mask.rows.map(row => row.pitchNm))].sort((a, b) => a - b);
  const saved = window.OM10Session.get('pitchCards', {});
  const cards = pitches.map(pitch => {
    const card = document.createElement('details');
    card.dataset.pitch = pitch;
    card.open = saved[pitch] === true;
    card.addEventListener('toggle', () => {
      saved[pitch] = card.open;
      window.OM10Session.set('pitchCards', saved);
    });
    card.className = 'rectangle-card pitch-card';
    const title = document.createElement('summary');
    title.className = 'rectangle-card-title';
    const count = document.createElement('span');
    count.className = 'pitch-count';
    title.append(`${pitch} nm wafer`, count);
    const rows = document.createElement('dl');
    rows.className = 'analysis-rows';
    card.append(title, rows); list.append(card);
    return { pitch, card, count, rows, signature: null };
  });
  return function update(pairs, context) {
    document.getElementById('analysis-count').textContent = pairs.length;
    document.getElementById('analysis-context').textContent =
      `${context.entry.filename} · ${context.view === 'cropped' ? 'crop' : 'original'} · distances in µm`;
    document.getElementById('analysis-empty').hidden = pairs.length !== 0;
    for (const item of cards) {
      const matches = pairs.filter(pair => pair.pitch === item.pitch);
      const signature = matches.map(pair => pair.firstId + '=' + pair.formatted).join('|');
      if (signature === item.signature) continue;
      // Expand on first use. Subsequent edits and dose switches preserve the user's choice.
      if (matches.length && !item.wasPopulated) {
        if (saved[item.pitch] === undefined) item.card.open = true;
        item.wasPopulated = true;
      }
      item.signature = signature;
      item.count.textContent = String(matches.length);
      item.rows.replaceChildren();
      for (const pair of matches) {
        const row = document.createElement('div');
        row.dataset.firstId = pair.firstId;
        row.style.setProperty('--group-color', pair.first.color);
        const label = document.createElement('dt'), value = document.createElement('dd');
        label.textContent = pair.name; value.textContent = pair.formatted;
        row.append(label, value); item.rows.append(row);
      }
      if (!matches.length) {
        item.rows.insertAdjacentHTML('afterbegin', '<div><dt>No matching pair</dt><dd>—</dd></div>');
      }
    }
  };
};

/* One colour per mask row and side, independent of order or EUV dose.
 * Selected offline to separate the closest pair in OKLab, using colours readable
 * on the dark sidebar. The table is fixed so annotations never change colour
 * when another rectangle is added. Columns are left, right.
 */
'use strict';
(() => {
  const rows = {
    'p88-e0':['#ffa578','#c34bff'], 'p72-e0':['#ffe1ff','#00ffe1'],
    'p64-e0':['#a5c32d','#ff96ff'], 'p68-e0':['#78c3ff','#ff6b43'],
    'p80-e0':['#ffe080','#72dbff'], 'p100-e0':['#b7ffac','#ff89bc'],
  };
  const colors = new Map();
  for (const [row, pair] of Object.entries(rows)) {
    for (const [index, side] of ['left', 'right'].entries()) {
      for (const order of ['m1', 'zero', 'p1']) colors.set(`spot-${row}-${side}-${order}`, pair[index]);
    }
  }
  for (const row of Object.keys(rows)) colors.set(`spot-${row}-both-inner_pair`, '#f3f1cf');
  const forSpot = id => colors.get(id);
  function apply(items) {
    return new Map(Array.from(items, ([id, rect]) => [id, { ...rect, color: forSpot(id) || rect.color }]));
  }
  const api = { forSpot, apply };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.OM10SpotColors = api;
})();

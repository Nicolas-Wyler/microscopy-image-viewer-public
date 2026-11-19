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
  let current = new Map(), currentMask = null;
  function groupKey(spots) {
    const ids = [...new Set(spots.map(s => String(s.grating.id)))].sort();
    return ids.length === 1 ? `grating:${ids[0]}` : `combined:${ids.join('\u0000')}`;
  }
  // Greedy farthest-point palette in OKLab. Recomputed for the available
  // grating pairs, never for only the currently placed rectangles.
  function palette(count) {
    const candidates=[];
    for (const l of [.62,.70,.78,.86]) for (const c of [.10,.15,.20]) for(let h=0;h<360;h+=10) {
      const a=c*Math.cos(h*Math.PI/180), b=c*Math.sin(h*Math.PI/180);
      const ll=(l+.3963377774*a+.2158037573*b)**3, mm=(l-.1055613458*a-.0638541728*b)**3, ss=(l-.0894841775*a-1.291485548*b)**3;
      const rgb=[4.0767416621*ll-3.3077115913*mm+.2309699292*ss,-1.2684380046*ll+2.6097574011*mm-.3413193965*ss,-.0041960863*ll-.7034186147*mm+1.707614701*ss];
      if(rgb.some(v=>v<0||v>1))continue;
      const hex='#'+rgb.map(v=>Math.round(255*(v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055)).toString(16).padStart(2,'0')).join('');
      candidates.push({l,a,b,hex});
    }
    const chosen=[]; if(candidates.length)chosen.push(candidates.reduce((best,v)=>v.a>best.a?v:best));
    while(chosen.length<count && chosen.length<candidates.length){let best=null,score=-1;for(const v of candidates){if(chosen.includes(v))continue;const d=Math.min(...chosen.map(p=>(v.l-p.l)**2+(v.a-p.a)**2+(v.b-p.b)**2));if(d>score){best=v;score=d;}}chosen.push(best);}
    return chosen.map(v=>v.hex);
  }
  function configure(mask, entry) {
    currentMask=mask;current=new Map();
    if(!mask || typeof window==='undefined' || !window.ViewerMask)return;
    const groups=window.ViewerMask.forImage(mask,entry).groups;
    const keys=[...new Set(groups.filter(g=>g.spots.length).map(g=>groupKey(g.spots)))].sort();
    const values=palette(keys.length); keys.forEach((key,i)=>current.set(key,values[i]));
  }
  function forSpot(id) {
    if(colors.has(id))return colors.get(id);
    if(!currentMask || typeof window==='undefined' || !window.ViewerSpotPlacement)return undefined;
    const members=window.ViewerSpotPlacement.members(id), spots=members.map(key=>currentMask.spots.get(key));
    if(!spots.length||spots.some(s=>!s))return undefined;
    return current.get(groupKey(spots));
  }
  function apply(items) {
    return new Map(Array.from(items, ([id, rect]) => [id, { ...rect, color: forSpot(id) || rect.color }]));
  }
  const api = { forSpot, apply, configure, palette, groupKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.OM10SpotColors = api;
})();

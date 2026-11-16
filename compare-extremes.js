/* Outward-order comparisons within one image and side, including e-dose combinations. */
'use strict';
(() => {
  function selectExtremePairs(pairs) {
    const bySide=new Map();
    for(const pair of pairs) {
      if(!((pair.side==='left' && pair.order===-1) || (pair.side==='right' && pair.order===1)) ||
         !pair.zero || !pair.first || !Number.isFinite(pair.pitch) || typeof pair.variant!=='string') continue;
      if(!bySide.has(pair.side)) bySide.set(pair.side,[]);
      bySide.get(pair.side).push(pair);
    }
    const selected=[];
    for(const entries of bySide.values()) {
      entries.sort((a,b)=>a.pitch-b.pitch || String(a.firstId).localeCompare(String(b.firstId)));
      const combinations=new Map();
      for(const small of entries) for(const large of entries) {
        if(!(small.pitch<large.pitch)) continue;
        // Ordered variants: e0/e1 and e1/e0 are distinct cross-dose comparisons.
        const key=JSON.stringify([small.variant,large.variant]), previous=combinations.get(key);
        if(!previous || small.pitch<previous[0].pitch ||
           (small.pitch===previous[0].pitch && large.pitch>previous[1].pitch)) combinations.set(key,[small,large]);
      }
      selected.push(...combinations.values());
    }
    return selected;
  }
  if(typeof module!=='undefined' && module.exports) module.exports=selectExtremePairs;
  else window.selectExtremeComparisonPairs=selectExtremePairs;
})();

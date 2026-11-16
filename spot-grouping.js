/* Keep physical order IDs while grouping inward-facing orders of adjacent gratings. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SpotGrouping=api;})(globalThis,function(){
  'use strict';
  function innerPairs(gratings){
    const pairs=[];
    for(const orientation of ['vertical','horizontal']){
      const vertical=orientation==='vertical',items=gratings.filter(g=>g.orientation===orientation&&g.width>0&&g.height>0&&Number.isFinite(g.x)&&Number.isFinite(g.y)&&g.minusId&&g.plusId);
      const axis=g=>vertical?g.x:g.y,cross=g=>vertical?g.y:g.x,crossSize=g=>vertical?g.height:g.width;
      const candidates=(g,direction)=>items.filter(h=>h!==g&&(axis(h)-axis(g))*direction>1e-8&&Math.abs(cross(h)-cross(g))<(crossSize(h)+crossSize(g))/2-1e-8)
        .map(h=>({h,along:Math.abs(axis(h)-axis(g)),across:Math.abs(cross(h)-cross(g))})).sort((a,b)=>a.along-b.along||a.across-b.across);
      function nearest(g,dir){const a=candidates(g,dir);if(!a.length)return null;if(a[1]&&Math.abs(a[0].along-a[1].along)<1e-8&&Math.abs(a[0].across-a[1].across)<1e-8)return null;return a[0].h;}
      for(const left of items){const right=nearest(left,1);if(right&&nearest(right,-1)===left)pairs.push([left.plusId,right.minusId]);}
    }
    return pairs;
  }
  function overlaps(a,b){return Boolean(a&&b&&Math.abs(a.x-b.x)<(a.width+b.width)/2&&Math.abs(a.y-b.y)<(a.height+b.height)/2);}
  function groups(ids,pairs,combined){const selected=new Set(ids),used=new Set(),result=[];if(combined)for(const pair of pairs)if(pair.every(id=>selected.has(id))){result.push([...pair]);for(const id of pair)used.add(id);}for(const id of ids)if(!used.has(id))result.push([id]);return result;}
  return {innerPairs,groups,overlaps};
});

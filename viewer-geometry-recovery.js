/* Recover missing dimensions from a matching saved calibration, never a preset. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ViewerGeometryRecovery=api;})(globalThis,function(){
  'use strict';
  function restore(data,side,signature){
    let previous;try{previous=JSON.parse(signature);}catch(_){return false;}
    const mask=data.maskDesign;if(!mask||previous?.version!==1||previous.side!==side||previous.mask!==mask.id||previous.fingerprint!==mask.fingerprint||!Array.isArray(previous.spots))return false;
    const saved=new Map(previous.spots.map(spot=>[spot[0],spot])),proposal=new Map();let changed=false;
    const spots=[];
    for(const spot of mask.spots.values()){
      const old=saved.get(spot.id),g=spot.grating;if(!old)return false;
      const width=g.width??old[4],height=g.height??old[5];
      if((g.width==null&&!(Number.isFinite(width)&&width>0))||(g.height==null&&!(Number.isFinite(height)&&height>0)))return false;
      const prior=proposal.get(g);if(prior&&(prior.width!==width||prior.height!==height))return false;
      proposal.set(g,{width,height});if(g.width==null||g.height==null)changed=true;
      spots.push([spot.id,spot.x,spot.y,spot.kind,width,height]);
    }
    const current={version:1,side,mask:mask.id,fingerprint:mask.fingerprint,spots,zones:mask.zones,images:data.images.map(e=>[e.id,e.width,e.height,e.basePixelSizeUm,e.zoneId])};
    if(!changed||JSON.stringify(current)!==JSON.stringify(previous))return false;
    for(const [g,value] of proposal){if(g.width==null)g.width=value.width;if(g.height==null)g.height=value.height;}
    return true;
  }
  return {restore};
});

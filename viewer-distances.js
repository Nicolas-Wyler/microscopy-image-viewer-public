/* Map placed rectangles to the zero and first orders of the same grating. */
'use strict';
window.ViewerDistances={
  measure(mask,centres,entry){
    if(!mask||!entry?.hasCalibration||!entry.alignment)return [];
    const definitions=mask.spots,byGrating=new Map();
    for(const [id,centre] of centres){
      const members=window.ViewerSpotPlacement.members(id);for(const member of members){const spot=definitions.get(member);if(!spot)continue;let slots=byGrating.get(spot.grating.id);if(!slots){slots={grating:spot.grating,zeros:[],firsts:[]};byGrating.set(spot.grating.id,slots);}const record={id,centre,spot,groupSize:members.length};if(spot.kind==='zero')slots.zeros.push(record);else if(spot.kind==='minus'||spot.kind==='plus')slots.firsts.push(record);}
    }
    const matrix=window.GratingGeometry.viewMatrix(entry,'cropped'),pairs=[];
    for(const {grating,zeros,firsts} of byGrating.values()){
      if(!['vertical','horizontal'].includes(grating.orientation)||!zeros.length)continue;zeros.sort((a,b)=>a.groupSize-b.groupSize);const zero=zeros[0];
      for(const first of firsts){const zr=zero.centre.measurementRaw,fr=first.centre.measurementRaw;if(!zr||!fr)continue;const z=window.GratingGeometry.transform(zr,matrix),f=window.GratingGeometry.transform(fr,matrix),axis=grating.orientation==='vertical'?'x':'y',distanceUm=Math.abs(f[axis]-z[axis])*(entry.alignment.alignedPixelUm??entry.pixelSizeUm);
        if(!Number.isFinite(distanceUm))continue;const order=first.spot.kind==='minus'?-1:1,side=window.ViewerSpotPlacement.side(mask,grating)||'unknown',pitch=grating.effectivePitch??grating.pitch;
        pairs.push({pitch,maskPitchNm:pitch,electronDose:grating.dose??null,side,variant:'',order,axis,zeroId:zero.id,firstId:first.id,zero:zero.centre,first:first.centre,distanceUm,formatted:distanceUm.toFixed(1),name:`${side} · ${first.spot.label}`});
      }
    }
    return pairs;
  }
};

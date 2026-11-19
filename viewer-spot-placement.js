/* Translate design footprints into the original TIFF's pixel coordinates. */
'use strict';
window.ViewerSpotPlacement=(()=>{
  const idFor=group=>'vspot-'+btoa(unescape(encodeURIComponent(JSON.stringify([...group.members].sort())))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  function side(mask,g){
    if(!mask||!g)return null;const horizontal=g.orientation==='horizontal',cross=horizontal?'x':'y',size=horizontal?'width':'height',axis=horizontal?'y':'x';
    const all=new Map();for(const spot of mask.spots.values())all.set(spot.grating.id,spot.grating);
    const peers=[...all.values()].filter(o=>o.windowIndex===g.windowIndex&&Number.isFinite(o[cross])&&Number.isFinite(o[axis])&&Math.abs(o[cross]-g[cross])<=Math.min(5,(g[size]||50)*.1));
    const values=[...new Set(peers.map(o=>horizontal?-o[axis]:o[axis]))].sort((a,b)=>a-b);if(values.length!==2)return null;
    const position=horizontal?-g[axis]:g[axis];return Math.abs(position-values[0])<=Math.abs(position-values[1])?'left':'right';
  }
  function definition(group){
    const spots=group.spots,first=spots[0],g=first.grating,paired=spots.length>1,order=paired?'inner_pair':first.kind==='minus'?-1:first.kind==='plus'?1:0;
    const title=spots.map(s=>`${s.grating.name||'Grating'} · ${s.label}`).join(' / '),pitch=Number.isFinite(g.effectivePitch)?g.effectivePitch:(Number.isFinite(g.pitch)?g.pitch:null);
    let hash=0;for(const c of String(g.id))hash=(hash*31+c.charCodeAt(0))>>>0;
    return {id:idFor(group),members:[...group.members],group,pitch,side:paired?'both':(side(window.OM10_DATA?.maskDesign,g)||'unknown'),variant:'',order,title,label:title,shortLabel:paired?'±1':`${g.name||'Grating'} · ${first.label}`,color:window.OM10SpotColors?.forSpot(idFor(group)) || (paired?'#f3f1cf':`hsl(${hash%360} 80% 72%)`)};
  }
  function definitions(data){const all=new Map(),mask=data.maskDesign;if(!mask)return [];const add=group=>{const spot=definition(group);all.set(spot.id,spot);};for(const spot of mask.spots.values())add({members:[spot.id],spots:[spot]});for(const ids of mask.pairs){const spots=ids.map(id=>mask.spots.get(id));if(spots.every(Boolean))add({members:ids,spots});}for(const zone of mask.zones){if(zone.cjobId===mask.id)for(const group of window.ViewerMask.forImage(mask,{zoneId:zone.id}).groups)add(group);}for(const entry of data.images)for(const group of window.ViewerMask.forImage(mask,entry).groups)add(group);return [...all.values()];}
  // When geometry or calibration is missing, place a movable rectangle rather
  // than blocking annotation. Existing zero-order centers give a rough estimate.
  function manualPlacement(entry,group,active){
    const mask=window.OM10_DATA?.maskDesign,first=group.spots[0],peers=active.filter(r=>Number.isFinite(r.width)&&r.width>0&&Number.isFinite(r.height)&&r.height>0);
    const closest=peers.find(r=>members(r.id).some(id=>mask?.spots.get(id)?.grating.id===first?.grating.id))||peers[0];
    const fallback=Math.max(2,Math.min(entry.width,entry.height)*0.06);
    let width=closest?.width??fallback,height=closest?.height??fallback,angle=closest?.angle??0;
    const anchors=[];for(const r of peers){const ids=members(r.id),s=ids.length===1?mask?.spots.get(ids[0]):null;if(s?.kind==='zero'&&r.shapeMode!=='integral'&&[r.cx,r.cy,s.x,s.y].every(Number.isFinite))anchors.push({raw:{x:r.cx,y:r.cy},mask:{x:s.x,y:-s.y}});}
    const available=group.spots.every(s=>Number.isFinite(s.x)&&Number.isFinite(s.y)&&(s.kind==='zero'||Number.isFinite(s.displacement)));
    const fit=available&&anchors.length>=2?window.ViewerRecalibration?.fit([{pixelSizeUm:1,points:anchors}]):null;
    if(fit){
      const x=group.spots.reduce((n,s)=>n+s.x,0)/group.spots.length,y=-group.spots.reduce((n,s)=>n+s.y,0)/group.spots.length;
      const mx=anchors.reduce((n,p)=>n+p.mask.x,0)/anchors.length,my=anchors.reduce((n,p)=>n+p.mask.y,0)/anchors.length;
      const ax=anchors.reduce((n,p)=>n+p.raw.x,0)/anchors.length,ay=anchors.reduce((n,p)=>n+p.raw.y,0)/anchors.length;
      const c=Math.cos(fit.rotation),s=Math.sin(fit.rotation),dx=(x-mx)/fit.factor,dy=(y-my)/fit.factor;
      const cx=ax+c*dx+s*dy,cy=ay-s*dx+c*dy;
      if(!closest&&first.grating.width>0&&first.grating.height>0){width=first.grating.width/fit.factor;height=first.grating.height/fit.factor;}
      if(cx>=0&&cx<=entry.width&&cy>=0&&cy<=entry.height&&width>=1&&height>=1)return {rect:{cx,cy,width,height,angle:-fit.rotation},anchored:true};
    }
    // Use a known rectangle as a starting point where possible; it remains draggable.
    const cx=closest?.cx??entry.width/2,cy=closest?.cy??entry.height/2;
    return {rect:{cx,cy,width,height,angle},manual:true};
  }
  function placement(entry,group,active=[]){
    if(!entry||!(entry.width>0&&entry.height>0))return {error:'No image is loaded.'};
    if(!entry.hasCalibration||!(entry.pixelSizeUm>0))return manualPlacement(entry,group,active);
    if(group.spots.some(s=>!Number.isFinite(s.grating.width)||!(s.grating.width>0)||!Number.isFinite(s.grating.height)||!(s.grating.height>0)))return manualPlacement(entry,group,active);
    if(group.spots.some(s=>s.kind!=='zero'&&(!Number.isFinite(s.displacement)||!['horizontal','vertical'].includes(s.grating.orientation))))return manualPlacement(entry,group,active);
    const xs=group.spots.flatMap(s=>[s.x-s.grating.width/2,s.x+s.grating.width/2]),ys=group.spots.flatMap(s=>[s.y-s.grating.height/2,s.y+s.grating.height/2]);
    const left=Math.min(...xs),right=Math.max(...xs),bottom=Math.min(...ys),top=Math.max(...ys);
    if(!entry.alignment||entry.alignment.translationSource==='centered'){
      // An unaligned image can still be annotated. Existing zero-order square
      // centers provide a local translation and, with two centers, a rotation.
      const mask=window.OM10_DATA?.maskDesign, anchors=[];
      for(const rect of active){
        const ids=members(rect.id),spot=ids.length===1?mask?.spots.get(ids[0]):null;
        if(spot?.kind==='zero'&&rect.shapeMode!=='integral'&&[rect.cx,rect.cy,spot.x,spot.y].every(Number.isFinite))anchors.push({x:rect.cx,y:rect.cy,mx:spot.x,my:-spot.y});
      }
      let rotation=entry.alignment?.translationSource==='centered'&&entry.alignment.rotationKnown!==false&&Number.isFinite(entry.alignment.angle)?-entry.alignment.angle:null;
      if(rotation===null&&anchors.length>=2){
        const mean=k=>anchors.reduce((sum,p)=>sum+p[k],0)/anchors.length,ax=mean('x'),ay=mean('y'),mx=mean('mx'),my=mean('my');let dot=0,cross=0;
        for(const p of anchors){const x=p.x-ax,y=p.y-ay,u=p.mx-mx,v=p.my-my;dot+=x*u+y*v;cross+=x*v-y*u;}
        if(Math.hypot(dot,cross)>1e-9)rotation=Math.atan2(cross,dot);
      }
      if(rotation===null&&anchors.length){
        const saved=window.OM10Session?.get('recalibration-v1',null);
        try{const signature=JSON.parse(saved?.signature||'null');if(signature?.mask===mask?.id&&signature?.fingerprint===mask?.fingerprint&&signature.images?.some(item=>item[0]===entry.id)&&Number.isFinite(saved?.fit?.rotation))rotation=saved.fit.rotation;}catch(_){}
      }
      const width=(right-left)/entry.pixelSizeUm,height=(top-bottom)/entry.pixelSizeUm;
      if(!(width>=1&&height>=1))return manualPlacement(entry,group,active);
      if(rotation!==null){
        const cos=Math.cos(rotation),sin=Math.sin(rotation),mx=(left+right)/2,my=-(bottom+top)/2;
        const positions=anchors.map(p=>{const dx=(mx-p.mx)/entry.pixelSizeUm,dy=(my-p.my)/entry.pixelSizeUm;return {x:p.x+cos*dx+sin*dy,y:p.y-sin*dx+cos*dy};});
        const centre={x:positions.reduce((n,p)=>n+p.x,0)/positions.length,y:positions.reduce((n,p)=>n+p.y,0)/positions.length};
        const halfX=(Math.abs(cos)*width+Math.abs(sin)*height)/2,halfY=(Math.abs(sin)*width+Math.abs(cos)*height)/2;
        if(centre.x+halfX>=0&&centre.x-halfX<=entry.width&&centre.y+halfY>=0&&centre.y-halfY<=entry.height)return {rect:{cx:centre.x,cy:centre.y,width,height,angle:-rotation},anchored:true};
      }
      // This is explicitly a starting point, not a detected spot.
      return {rect:{cx:entry.width/2,cy:entry.height/2,width,height,angle:0},manual:true};
    }
    const scale=entry.alignment.alignedPixelUm??entry.pixelSizeUm,matrix=window.GratingGeometry.viewMatrix(entry,'cropped');
    const centre=window.GratingGeometry.inverseTransform({x:entry.cropWidth/2+(left+right)/2/scale,y:(entry.alignment.originCropY??entry.cropHeight/2)-(bottom+top)/2/scale},matrix);
    const width=(right-left)/entry.pixelSizeUm,height=(top-bottom)/entry.pixelSizeUm,angle=-Math.atan2(matrix[1][0],matrix[0][0]);
    if(!(width>=1&&height>=1))return manualPlacement(entry,group,active);
    const halfX=(Math.abs(Math.cos(angle))*width+Math.abs(Math.sin(angle))*height)/2,halfY=(Math.abs(Math.sin(angle))*width+Math.abs(Math.cos(angle))*height)/2;
    if(centre.x+halfX<0||centre.x-halfX>entry.width||centre.y+halfY<0||centre.y-halfY>entry.height)return manualPlacement(entry,group,active);
    return {rect:{cx:centre.x,cy:centre.y,width,height,angle}};
  }
  function members(id){try{if(!id.startsWith('vspot-'))return [];const encoded=id.slice(6).replace(/-/g,'+').replace(/_/g,'/'),decoded=decodeURIComponent(escape(atob(encoded)));const value=JSON.parse(decoded);return Array.isArray(value)&&value.every(x=>typeof x==='string')?value:[];}catch{return [];}}
  return {definition,definitions,placement,members,side};
})();

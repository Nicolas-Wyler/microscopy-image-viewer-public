/* Estimate one common rotation and per-image translations from zone zero orders. */
'use strict';
window.ViewerAlignment={
  async cache(data,write){
    try{
      const signature=JSON.stringify({version:4,images:data.images.map(e=>[e.id,e.width,e.height,e.pixelSizeUm,e.hasCalibration,e.zoneId]),spots:[...data.maskDesign.spots.values()].map(p=>[p.id,p.kind,p.x,p.y,p.displacement,p.grating.width,p.grating.height,p.grating.windowIndex]),zones:data.maskDesign.zones.map(z=>[z.id,z.cjobId,z.spotIds,z.spotGroups])});
      const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(signature)),key=[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');
      const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('MicroscopyViewerAlignment',1);q.onupgradeneeded=()=>q.result.createObjectStore('alignments');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
      const value=await new Promise((resolve,reject)=>{const tx=db.transaction('alignments',write?'readwrite':'readonly'),store=tx.objectStore('alignments'),req=write?store.put(write,key):store.get(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});db.close();return value;
    }catch(_){return null;}
  },
  async run(data,onProgress){
    const results=[], images=data.images, report=(n)=>onProgress?.(n,images.length);
    const cached=await this.cache(data);if(cached?.frames?.length===images.length){for(let i=0;i<images.length;i++){const item=cached.frames[i],entry=images[i];entry.alignmentError=item.error;entry.roughMatches=item.roughMatches||[];for(const frame of [entry.top,entry.bottom]){frame.alignment=item.alignment;frame.rawToCrop=item.matrix;frame.cropWidth=item.width;frame.cropHeight=item.height;}}report(images.length);return cached.summary;}
    for(let i=0;i<images.length;i++){
      const entry=images[i];
      try{
        if(!entry.hasCalibration)throw new Error('No usable sidecar pixel size');
        const selection=window.ViewerMask.forImage(data.maskDesign,entry), byWindow=new Map();
        for(const group of selection.groups)for(const spot of group.spots){const g=spot.grating;if(!(g.width>0&&g.height>0))continue;if(!byWindow.has(g.windowIndex))byWindow.set(g.windowIndex,new Map());byWindow.get(g.windowIndex).set(g.id,g);}
        const groups=[...byWindow.values()].map(v=>[...v.values()]).filter(v=>v.length>=3);if(!groups.length)throw new Error('Zone needs at least three gratings with known dimensions');
        const decoded=await window.TiffImage.decode(entry.file),factor=Math.max(1,decoded.width/768),w=Math.round(decoded.width/factor),h=Math.round(decoded.height/factor),actualFactor=decoded.width/w;
        const source=document.createElement('canvas');source.width=decoded.width;source.height=decoded.height;source.getContext('2d').putImageData(new ImageData(decoded.rgba,decoded.width,decoded.height),0,0);
        const small=document.createElement('canvas');small.width=w;small.height=h;const ctx=small.getContext('2d',{willReadFrequently:true});ctx.drawImage(source,0,0,w,h);source.width=1;source.height=1;const rgba=ctx.getImageData(0,0,w,h).data,pixels=new Uint8Array(w*h);for(let j=0;j<pixels.length;j++)pixels[j]=Math.round(.299*rgba[4*j]+.587*rgba[4*j+1]+.114*rgba[4*j+2]);
        let best=null;for(const gratings of groups){const model=gratings.map(g=>({id:g.id,x:g.x/(entry.pixelSizeUm*actualFactor),y:-g.y/(entry.pixelSizeUm*actualFactor),width:g.width/(entry.pixelSizeUm*actualFactor),height:g.height/(entry.pixelSizeUm*actualFactor)}));const candidates=window.ViewerRegistration.detect(pixels,w,h,model),fit=window.ViewerRegistration.fit(model,candidates);if(fit&&(!best||fit.matches.length>best.matches.length))best=fit;}
        if(!best)throw new Error('Could not match zero-order spots');entry.roughMatches=best.matches.map(m=>({id:m.model.id,x:m.candidate.x*actualFactor,y:m.candidate.y*actualFactor}));results.push({entry,fit:best,factor:actualFactor});
      }catch(error){entry.alignmentError=error.message||'Alignment failed';}
      report(i+1);await new Promise(resolve=>setTimeout(resolve,0));
    }
    if(!results.length)return {aligned:0,total:images.length};
    const median=a=>{a=[...a].sort((x,y)=>x-y);return a[Math.floor(a.length/2)];};
    const angles=results.map(r=>r.fit.angle),anchor=angles.reduce((best,a)=>angles.reduce((sum,b)=>sum+Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b))),0)<best.score?{angle:a,score:angles.reduce((sum,b)=>sum+Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b))),0)}:best,{angle:angles[0],score:Infinity}).angle;
    const common=anchor+median(angles.map(a=>Math.atan2(Math.sin(a-anchor),Math.cos(a-anchor)))),referenceScale=median(results.map(r=>r.entry.pixelSizeUm)),c=Math.cos(common),s=Math.sin(common);let aligned=0;
    // Use one physical vertical window for all successfully matched zones.
    // Include the parent zero-order grating of each selected diffraction spot.
    const footprints=[];
    for(const {entry} of results)for(const group of window.ViewerMask.forImage(data.maskDesign,entry).groups)for(const spot of group.spots){
      const g=spot.grating;if(!(Number.isFinite(g.y)&&Number.isFinite(g.height)&&g.height>0))continue;
      footprints.push({y:g.y,height:g.height});
      if(spot.kind==='zero'||(Number.isFinite(spot.displacement)&&['vertical','horizontal'].includes(g.orientation)))if(Number.isFinite(spot.y))footprints.push({y:spot.y,height:g.height});
    }
    const bottom=Math.min(...footprints.map(p=>p.y-p.height/2)),top=Math.max(...footprints.map(p=>p.y+p.height/2));
    const margin=Math.max(...footprints.map(p=>p.height))/2,physicalHeight=top-bottom+2*margin,physicalCentre=(top+bottom)/2;
    for(const {entry,fit,factor} of results){
      if(Math.abs(Math.atan2(Math.sin(fit.angle-common),Math.cos(fit.angle-common)))>Math.PI/45){entry.alignmentError='Spot rotation differs from the common rotation';continue;}
      if(Math.abs(entry.pixelSizeUm/referenceScale-1)>.005){entry.alignmentError='Pixel scale differs from the other aligned images';continue;}
      const tx=median(fit.matches.map(m=>m.candidate.x-c*m.model.x+s*m.model.y))*factor,ty=median(fit.matches.map(m=>m.candidate.y-s*m.model.x-c*m.model.y))*factor;
      const validSpots=[...data.maskDesign.spots.values()].filter(p=>p.kind==='zero'||p.displacement!==null),maxX=Math.max(0,...validSpots.map(p=>(Math.abs(p.x)+(p.grating.width||0)/2)/entry.pixelSizeUm));
      const cropWidth=Math.max(entry.width,Math.ceil(maxX*2+100)),cropHeight=Math.min(entry.height,Math.max(1,Math.ceil(physicalHeight/entry.pixelSizeUm)));
      const originCropY=cropHeight/2+physicalCentre/entry.pixelSizeUm;
      const matrix=[[c,s,cropWidth/2-c*tx-s*ty],[-s,c,originCropY+s*tx-c*ty],[0,0,1]];
      for(const frame of [entry.top,entry.bottom]){frame.rawToCrop=matrix;frame.cropWidth=cropWidth;frame.cropHeight=cropHeight;frame.alignment={angle:common,originCropY,individualAngle:fit.angle,matches:fit.matches.map(m=>({id:m.model.id,x:m.candidate.x*factor,y:m.candidate.y*factor})),pixelSizeUm:entry.pixelSizeUm};}
      entry.alignmentError='';aligned++;
    }
    const summary={aligned,total:images.length,angle:common};
    await this.cache(data,{summary,frames:images.map(e=>({error:e.alignmentError||'',roughMatches:e.roughMatches||[],alignment:e.alignment,matrix:e.rawToCrop,width:e.cropWidth,height:e.cropHeight}))});
    return summary;
  }
};

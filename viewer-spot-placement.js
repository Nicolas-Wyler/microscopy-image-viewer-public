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
    return {id:idFor(group),members:[...group.members],group,pitch,side:paired?'both':(side(window.OM10_DATA?.maskDesign,g)||'unknown'),variant:'',order,title,label:title,shortLabel:paired?'±1':`${g.name||'Grating'} · ${first.label}`,color:paired?'#f3f1cf':`hsl(${hash%360} 80% 72%)`};
  }
  function definitions(data){const all=new Map(),mask=data.maskDesign;if(!mask)return [];const add=group=>{const spot=definition(group);all.set(spot.id,spot);};for(const spot of mask.spots.values())add({members:[spot.id],spots:[spot]});for(const ids of mask.pairs){const spots=ids.map(id=>mask.spots.get(id));if(spots.every(Boolean))add({members:ids,spots});}for(const zone of mask.zones){if(zone.cjobId===mask.id)for(const group of window.ViewerMask.forImage(mask,{zoneId:zone.id}).groups)add(group);}for(const entry of data.images)for(const group of window.ViewerMask.forImage(mask,entry).groups)add(group);return [...all.values()];}
  function placement(entry,group){
    if(!entry?.hasCalibration||!(entry.pixelSizeUm>0))return {error:'A sidecar pixel size is needed.'};
    if(!entry.alignment)return {error:entry.alignmentError||'Wait for rough image alignment.'};
    if(group.spots.some(s=>!Number.isFinite(s.grating.width)||!(s.grating.width>0)||!Number.isFinite(s.grating.height)||!(s.grating.height>0)))return {error:'Enter the grating dimensions in Mask Design.'};
    if(group.spots.some(s=>s.kind!=='zero'&&(!Number.isFinite(s.displacement)||!['horizontal','vertical'].includes(s.grating.orientation))))return {error:'Set wavelength, gap, pitch and grating orientation for first-order spots.'};
    const scale=entry.alignment.alignedPixelUm??entry.pixelSizeUm, xs=group.spots.flatMap(s=>[s.x-s.grating.width/2,s.x+s.grating.width/2]),ys=group.spots.flatMap(s=>[s.y-s.grating.height/2,s.y+s.grating.height/2]);
    const left=Math.min(...xs),right=Math.max(...xs),bottom=Math.min(...ys),top=Math.max(...ys),matrix=window.GratingGeometry.viewMatrix(entry,'cropped');
    const centre=window.GratingGeometry.inverseTransform({x:entry.cropWidth/2+(left+right)/2/scale,y:(entry.alignment.originCropY??entry.cropHeight/2)-(bottom+top)/2/scale},matrix);
    const width=(right-left)/entry.pixelSizeUm,height=(top-bottom)/entry.pixelSizeUm,angle=-Math.atan2(matrix[1][0],matrix[0][0]);
    if(!(width>=1&&height>=1))return {error:'The expected footprint is smaller than one pixel.'};
    const halfX=(Math.abs(Math.cos(angle))*width+Math.abs(Math.sin(angle))*height)/2,halfY=(Math.abs(Math.sin(angle))*width+Math.abs(Math.cos(angle))*height)/2;
    if(centre.x+halfX<0||centre.x-halfX>entry.width||centre.y+halfY<0||centre.y-halfY>entry.height)return {error:'This expected spot lies outside the image.'};
    return {rect:{cx:centre.x,cy:centre.y,width,height,angle}};
  }
  function members(id){try{if(!id.startsWith('vspot-'))return [];const encoded=id.slice(6).replace(/-/g,'+').replace(/_/g,'/'),decoded=decodeURIComponent(escape(atob(encoded)));const value=JSON.parse(decoded);return Array.isArray(value)&&value.every(x=>typeof x==='string')?value:[];}catch{return [];}}
  return {definition,definitions,placement,members,side};
})();

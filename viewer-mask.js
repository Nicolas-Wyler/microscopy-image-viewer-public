/* Resolve mask spots and saved zone membership without assuming image calibration. */
'use strict';
(() => {
  const known={};
  async function fingerprint(text){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');}
  async function load(saved){
    const project=saved.project;let design=project.manualDesign;
    if(project.cjob){const file=saved.assets.get(project.cjob.assetKey);if(!file)throw new Error('Saved CJOB file is unavailable.');const text=await file.text();design={...project.cjob,model:window.CjobModel.parse(text),fingerprint:await fingerprint(text)};}
    if(!design?.model)return null;
    const rotated=Boolean(project.cjob&&project.designRotationByDesign?.[design.fingerprint]);
    const mirrored=project.mirrorYByDesign?.[design.fingerprint]??true;
    const windows=design.model.windows||[],groups=new Map();
    for(const mask of windows){const key=JSON.stringify(mask.gratings.map(g=>[g.name,g.x.toFixed(6),g.y.toFixed(6),g.width,g.height,g.effectivePitch,g.orientation,g.dose]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));if(!groups.has(key))groups.set(key,mask);}
    const spots=new Map(),pairs=[];let overlap=false;const lambda=window.CjobModel.quantity(project.wavelength||'','wavelength'),gap=window.CjobModel.quantity(project.gap||'','gap');
    for(const mask of groups.values()){
      const gratings=[];
      for(const [index,raw] of mask.gratings.entries()){
        const base=raw.spotBaseId||`w${windows.indexOf(mask)}:g${index}`,savedGeometry=project.cjobGeometry?.[design.fingerprint]?.[raw.name]||{},documented=known[design.fingerprint];
        const pitch=raw.pitch??savedGeometry.pitch??null,sadp=project.sadpByDesign?.[design.fingerprint]??Boolean(design.model.sadpDocumented);
        const effective=pitch?pitch*(sadp ? 0.5 : 1):(savedGeometry.effectivePitch??null),orientation=raw.orientation??savedGeometry.orientation??null;
        const oriented={...raw,x:rotated?-raw.x:raw.x,y:rotated?-raw.y:raw.y};
        const g={...(mirrored?window.CjobModel.predictedGrating(oriented):oriented),id:base,windowIndex:windows.indexOf(mask),pitch,effectivePitch:effective,orientation,width:raw.width??documented?.width??savedGeometry.width??null,height:raw.height??documented?.height??savedGeometry.height??null,dose:raw.dose??project.cjobDoseOverrides?.[design.fingerprint]?.[base]??null};
        const displacement=lambda&&gap&&effective?window.CjobModel.displacement(lambda,gap,effective):null;
        for(const [kind,label,sign] of [['zero','0',0],['minus','−1',-1],['plus','+1',1]]){const id=`${base}:${kind}`;spots.set(id,{id,kind,label,grating:g,displacement,x:g.x+(orientation==='vertical'&&displacement!==null?sign*displacement:0),y:g.y+(orientation==='horizontal'&&displacement!==null?sign*displacement:0)});}
        gratings.push({x:g.x,y:g.y,width:g.width,height:g.height,orientation,plusId:`${base}:plus`,minusId:`${base}:minus`});
      }
      const next=window.SpotGrouping.innerPairs(gratings);pairs.push(...next);
      for(const [a,b] of next){const left=spots.get(a),right=spots.get(b);if(left.displacement!==null&&right.displacement!==null&&window.SpotGrouping.overlaps({x:left.x,y:left.y,width:left.grating.width,height:left.grating.height},{x:right.x,y:right.y,width:right.grating.width,height:right.grating.height}))overlap=true;}
    }
    const together=project.innerTogetherByDesign?.[design.fingerprint]??overlap;
    return {id:design.id,fingerprint:design.fingerprint,rotated,mirrored,name:design.name||'Mask design',spots,pairs,together,togetherExplicit:project.innerTogetherByDesign?.[design.fingerprint],zones:project.zones||[]};
  }
  function refreshGeometry(mask){
    const windows=new Map();for(const spot of mask.spots.values())if(spot.kind==='zero'){const g=spot.grating;if(!windows.has(g.windowIndex))windows.set(g.windowIndex,[]);windows.get(g.windowIndex).push({x:g.x,y:g.y,width:g.width,height:g.height,orientation:g.orientation,plusId:g.id+':plus',minusId:g.id+':minus'});}
    mask.pairs=[...windows.values()].flatMap(window.SpotGrouping.innerPairs);let overlap=false;
    for(const [a,b] of mask.pairs){const left=mask.spots.get(a),right=mask.spots.get(b);if(left&&right&&left.displacement!==null&&right.displacement!==null&&window.SpotGrouping.overlaps({x:left.x,y:left.y,width:left.grating.width,height:left.grating.height},{x:right.x,y:right.y,width:right.grating.width,height:right.grating.height}))overlap=true;}
    mask.together=mask.togetherExplicit??overlap;
  }
  function forImage(mask,entry){
    if(!mask)return {groups:[],message:'No mask design loaded.'};
    const zone=entry.zoneId?mask.zones.find(z=>z.id===entry.zoneId):null;
    if(entry.zoneId&&(!zone||zone.cjobId!==mask.id))return {groups:[],message:'This image’s zone belongs to a different mask design.'};
    const ids=zone?zone.spotIds:[...mask.spots.keys()];let rawGroups=window.SpotGrouping.groups(ids,mask.pairs,zone?Boolean(zone.innerSpotsTogether):mask.together);
    const represented=new Set(rawGroups.flat());for(const id of ids)if(!represented.has(id))rawGroups.push([id]);
    const groups=[],unknown=[];for(const members of rawGroups){const values=members.map(id=>mask.spots.get(id));if(values.every(Boolean))groups.push({members:[...members],spots:values});else unknown.push(...members.filter(id=>!mask.spots.has(id)));}
    return {groups,missing:unknown,zoneName:zone?.name||'Everything',message:unknown.length?'Some zone spots are not present in this mask design.':''};
  }
  window.ViewerMask={load,forImage,refreshGeometry};
})();

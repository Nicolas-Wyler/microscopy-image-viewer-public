/* Verified OM11 rectangle transfer in original TIFF sensor coordinates. */
'use strict';
window.ViewerLegacyImport={
  recognizes(text){return text.slice(0,400).includes('legacy_mask_y_down_um');},
  async prepare(text,data,progress){
    const [header,...lines]=window.rectangleCsvRows(text),required=['source_image','source_sha256','mask_source_sha256','mask_pitch_nm','mask_electron_dose','side','diffraction_order','mask_x_um','legacy_mask_y_down_um','source_offset_x','source_offset_y','rectangle_json'];
    if(!header||required.some(k=>!header.includes(k)))throw new Error('This is not a supported verified rectangle file.');
    if(new Set(header).size!==header.length)throw new Error('Duplicate CSV columns.');
    if(!data.maskDesign?.fingerprint)throw new Error('Load the original CJOB in Mask Design before importing.');
    const imagesByName=new Map();for(const image of data.images){const name=image.sourceFilename;if(!imagesByName.has(name))imagesByName.set(name,[]);imagesByName.get(name).push(image);}
    const records=[],checks=new Map();for(let i=0;i<lines.length;i++){
      const cells=lines[i];if(cells.length===1&&!cells[0])continue;if(cells.length!==header.length)throw new Error(`Invalid CSV row ${i+2}.`);
      const row=Object.fromEntries(header.map((name,j)=>[name,cells[j]]));
      if(row.mask_source_sha256.toLowerCase()!==data.maskDesign.fingerprint.toLowerCase())throw new Error('The saved rectangles use a different mask CJOB.');
      if(!/^[a-f0-9]{64}$/i.test(row.source_sha256))throw new Error(`Invalid source checksum on row ${i+2}.`);
      if(checks.has(row.source_image)&&checks.get(row.source_image)!==row.source_sha256.toLowerCase())throw new Error(`Conflicting checksums for ${row.source_image}.`);
      checks.set(row.source_image,row.source_sha256.toLowerCase());records.push(row);
    }
    const matched=new Map(),missing=[],mismatch=[],ambiguous=[];let done=0;
    for(const [name,expected] of checks){
      const options=imagesByName.get(name)||[];if(!options.length)missing.push(name);else if(options.length!==1)ambiguous.push(name);else{
        const image=options[0],hash=await crypto.subtle.digest('SHA-256',await image.file.arrayBuffer()),actual=[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');
        if(actual!==expected)mismatch.push(name);else matched.set(name,image);
      }
      progress?.(++done,checks.size);
    }
    if(!matched.size)throw new Error('None of the source images match the TIFF checksums in this evaluation.');
    const groups=new Map(),matches=[...data.maskDesign.spots.values()];let unmatchedSpots=0;
    const value=(text,row,name)=>{if(text===''||!Number.isFinite(Number(text)))throw new Error(`Invalid ${name} for ${row.source_image}.`);return Number(text);};
    for(const row of records){
      const image=matched.get(row.source_image);if(!image)continue;
      const pitch=value(row.mask_pitch_nm,row,'pitch'),dose=value(row.mask_electron_dose,row,'electron dose'),mx=value(row.mask_x_um,row,'mask X'),my=value(row.legacy_mask_y_down_um,row,'mask Y'),order=value(row.diffraction_order,row,'order');
      const kind=order===0?'zero':order===-1?'minus':order===1?'plus':null;if(!kind||!['left','right'].includes(row.side))throw new Error(`Invalid spot identity for ${row.source_image}.`);
      const candidates=matches.filter(s=>s.kind===kind&&Math.abs((s.grating.effectivePitch??NaN)-pitch)<1e-6&&Math.abs((s.grating.dose??NaN)-dose)<1e-6&&Math.abs(s.grating.x-mx)<.01&&Math.abs(s.grating.y+my)<.01);
      if(candidates.length!==1){unmatchedSpots++;continue;}
      let raw;try{raw=JSON.parse(row.rectangle_json);}catch{throw new Error(`Invalid rectangle in ${row.source_image}.`);}
      const ox=value(row.source_offset_x,row,'source offset X'),oy=value(row.source_offset_y,row,'source offset Y');
      if(!raw||!['cx','cy','width','height','angle'].every(k=>Number.isFinite(raw[k]))||raw.width<1||raw.height<1||typeof raw.color!=='string'||!CSS.supports('color',raw.color)||typeof raw.label!=='string'||raw.label.length>200)throw new Error(`Invalid rectangle geometry in ${row.source_image}.`);
      const rect={cx:raw.cx-ox,cy:raw.cy-oy,width:raw.width,height:raw.height,angle:raw.angle,color:raw.color,label:raw.label};
      if(['canny','midpoint'].includes(raw.snapMode))rect.snapMode=raw.snapMode;
      if(['integral','square'].includes(raw.shapeMode))rect.shapeMode=raw.shapeMode;
      if(['maximum','inflection'].includes(raw.positionMethod))rect.positionMethod=raw.positionMethod;
      if(Number.isFinite(raw.smoothingSigma)&&raw.smoothingSigma>=0)rect.smoothingSigma=raw.smoothingSigma;
      if(Number.isFinite(raw.signalRange)&&raw.signalRange>=0&&raw.signalRange<=100)rect.signalRange=raw.signalRange;
      const spot=candidates[0],id=window.ViewerSpotPlacement.definition({members:[spot.id],spots:[spot]}).id;
      if(!groups.has(image.filename))groups.set(image.filename,new Map());const dest=groups.get(image.filename);if(dest.has(id))throw new Error(`Duplicate spot in ${row.source_image}.`);dest.set(id,rect);
    }
    if(!groups.size)throw new Error('No spots match the current mask geometry. Check that SADP is enabled.');
    return {groups,matched:matched.size,missing,mismatch,ambiguous,unmatchedSpots};
  }
};

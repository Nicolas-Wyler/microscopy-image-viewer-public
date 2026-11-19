/* Read the saved import project; never write to its IndexedDB records. */
'use strict';
(() => {
  const cache=new Map(),pending=new Map();
  function quantity(value,kind){return window.CjobModel.quantity(value||'',kind);}
  async function makeData(saved){
    const project=saved.project,zones=new Map((project.zones||[]).map(z=>[z.id,z])),design=project.cjob||project.manualDesign,sources=new Map((project.sources||[]).map(source=>[source.id,source])),backgrounds=new Map((project.backgrounds||[]).map(bg=>[bg.id,bg]));
    const basename=path=>String(path||'').split('/').pop().replace(/\.(?:tiff?|xlif)$/i,'').toLocaleLowerCase();
    const entries=await Promise.all(project.images.map(async (item,index)=>{
      const file=saved.assets.get(item.assetKey);if(!file)throw new Error('A saved image is unavailable.');
      const sidecars=(sources.get(item.sourceId)?.sidecars||[]).filter(sidecar=>basename(sidecar.path)===basename(item.path||file.name));const sidecarFile=sidecars.length===1?saved.assets.get(sidecars[0].assetKey):null;let scale=null,objective=null;if(sidecarFile)try{const xml=await sidecarFile.text();scale=window.SidecarScale.read(xml,item.width,item.height);const doc=new DOMParser().parseFromString(xml,'application/xml');const values=[...new Set([...doc.querySelectorAll('ATLCameraSettingDefinition[Magnification]')].map(n=>Number(n.getAttribute('Magnification'))).filter(v=>Number.isFinite(v)&&v>0))];if(values.length===1)objective=values[0];}catch(_){}
      const background=backgrounds.get(item.backgroundId);
      const dose=item.exposureDose==null||String(item.exposureDose).trim()===''?null:Number(item.exposureDose),zone=zones.get(item.zoneId);
      const frame={file,originalSrc:'',croppedSrc:'',sourceFilename:file.name,sourceSha256:'',sidecarSrc:'',sidecarSha256:'',sidecarFile,sidecarFilename:sidecarFile?.name||'',width:item.width,height:item.height,cropWidth:item.width,cropHeight:item.height,pixelSizeUm:scale??1,basePixelSizeUm:scale,sidecarPixelSizeUm:scale,objectiveMagnification:objective??(Number(item.magnification)>0?Number(item.magnification):null),rawToCrop:[[1,0,0],[0,1,0],[0,0,1]],alignment:null,halfTurn:false,placeholder:false,hasCalibration:scale!==null,calibrationSource:scale!==null?'Leica sidecar':null};
      const entry={id:item.id,number:index+1,filename:item.id,name:item.name??file.name.replace(/\.tiff?$/i,''),dose:Number.isFinite(dose)?dose:null,backgroundId:item.backgroundId||'',backgroundName:background?.name||'',backgroundFile:background?saved.assets.get(background.assetKey):null,zoneId:item.zoneId||'',zoneName:zone?zone.name+(zone.cjobId!==design?.id?' (other CJOB)':''):'Everything',exposureField:null,filterOnDemand:true,top:{...frame},bottom:{...frame}};
      for(const name of Object.keys(frame))Object.defineProperty(entry,name,{enumerable:true,get(){return entry[window.OM10Session?.get('pictureSide','top')==='bottom'?'bottom':'top'][name];}});
      return entry;
    }));
    // All images belong to the same microscopy session. Sidecars provide an
    // initial estimate, averaged over those available, including missing sidecars.
    const known=entries.map(entry=>entry.basePixelSizeUm).filter(value=>Number.isFinite(value)&&value>0);
    if(known.length){const average=known.reduce((sum,value)=>sum+value,0)/known.length;
      for(const entry of entries)for(const frame of [entry.top,entry.bottom]){
        frame.pixelSizeUm=average;frame.basePixelSizeUm=average;frame.hasCalibration=true;frame.calibrationSource='Average Leica sidecar pixel size';
      }
    }
    const used=new Set(project.images.map(item=>item.zoneId).filter(Boolean));
    const availableZones=[{id:'',name:'Everything'},...(project.zones||[]).filter(zone=>zone.cjobId===design?.id||used.has(zone.id)).map(zone=>({id:zone.id,name:zone.name+(zone.cjobId!==design?.id?' (other CJOB)':'')}))];
    return {exposure:'',mask:project.mask||'',negative:Boolean(project.negative),sourceDirectory:'',availableZones,projectRevision:project.revision||0,projectTitle:project.projectTitle||'New Project 1',nominalGapUm:quantity(project.gap,'gap'),nominalWavelengthNm:quantity(project.wavelength,'wavelength'),importedProject:true,previewEmpty:false,images:entries};
  }
  const ready=(async()=>{try{const saved=await window.TableProjectStore.open();window.TiffImage.setNegative(Boolean(saved?.project?.negative));if(saved?.project?.images?.length){const data=await makeData(saved);try{data.maskDesign=await window.ViewerMask.load(saved);}catch(error){data.maskError=error.message||'Could not load the mask design.';}window.OM10_DATA=data;}else if(saved?.project){window.OM10_DATA.projectTitle=saved.project.projectTitle||'New Project 1';window.OM10_DATA.projectRevision=saved.project.revision||0;}}catch(error){window.viewerProjectError=error.message||'Could not restore the saved project.';}})();
  async function imageUrl(entry){
    const id=entry.id;if(cache.has(id)){const url=cache.get(id);cache.delete(id);cache.set(id,url);return url;}if(pending.has(id))return pending.get(id);
    const task=(async()=>{const data=await window.TiffImage.decode(entry.file),canvas=document.createElement('canvas');canvas.width=data.width;canvas.height=data.height;
      let grayscale=true;for(let i=0;i<data.rgba.length;i+=4)if(data.rgba[i]!==data.rgba[i+1]||data.rgba[i]!==data.rgba[i+2]){grayscale=false;break;}entry.isGrayscale=grayscale;
      canvas.getContext('2d').putImageData(new ImageData(data.rgba,data.width,data.height),0,0);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));canvas.width=1;canvas.height=1;if(!blob)throw new Error('Could not render TIFF image.');
      const url=URL.createObjectURL(blob);cache.set(id,url);while(cache.size>6){const oldest=cache.keys().next().value;URL.revokeObjectURL(cache.get(oldest));cache.delete(oldest);}return url;
    })().finally(()=>pending.delete(id));pending.set(id,task);return task;
  }
  window.addEventListener('pagehide',()=>{for(const url of cache.values())URL.revokeObjectURL(url);cache.clear();});
  window.ViewerProject={ready,imageUrl};
})();

/* Image selection stays in this browser tab; source files are never changed. */
'use strict';
(() => {
  const shell=document.getElementById('folder-loader');
  for (const element of document.body.children) if (element !== shell) element.inert = true;
  shell.addEventListener('keydown',event=>event.stopPropagation());
  const select=document.getElementById('select-folder'),input=document.getElementById('folder-input');
  const imageInput=document.getElementById('image-input'),selectImages=document.getElementById('select-images');
  const drop=document.getElementById('folder-drop'),menu=document.getElementById('add-images-menu');
  const error=document.getElementById('loader-error'),progress=document.getElementById('loader-progress'),warning=document.getElementById('loader-warning');
  let generation=0,busy=true,storageReady=false,savePending=null,saving=false,saveFailed=false;
  const saveStatus=document.getElementById('project-save-status');
  select.disabled=true;selectImages.disabled=true;document.getElementById('project-title').disabled=true;
  const selection={projectTitle:'New Project 1',mask:'',wavelength:'',gap:'',resist:'',description:'',negative:false,bulkDose:'',doseSeriesMultiplier:'1.0',cjob:null,manualDesign:null,manualDraft:null,cjobGeometry:{},cjobDoseOverrides:{},cjobDrafts:{},designRotationByDesign:{},mirrorYByDesign:{},sadpByDesign:{},innerTogetherByDesign:{},zones:[],selectedZoneId:'',backgrounds:[],selectedBackgroundId:'',images:[],sources:[],summary:{count:0,width:null,height:null}};
  const negativeInput=document.getElementById('project-negative');
  negativeInput.addEventListener('change',()=>{window.ImageTable.mutateProject(()=>{selection.negative=negativeInput.checked;window.TiffImage.setNegative(selection.negative);});window.ImageTable.refreshThumbnails();});
  const titleInput=document.getElementById('project-title');let titleEdited=false,titleFromFolder=false;
  titleInput.value=selection.projectTitle;
  const projectFields={mask:document.getElementById('project-mask'),wavelength:document.getElementById('project-wavelength'),gap:document.getElementById('project-gap'),resist:document.getElementById('project-resist'),bulkDose:document.getElementById('project-dose'),doseSeriesMultiplier:document.getElementById('dose-series-multiplier'),description:document.getElementById('project-description')};
  function resizeDescription(){const field=projectFields.description;field.style.height='auto';field.style.height=`${field.scrollHeight+field.offsetHeight-field.clientHeight}px`;}
  for(const [name,field] of Object.entries(projectFields)) {
    field.disabled=true;
    field.addEventListener('input',()=>{selection[name]=field.value;if(name==='description')resizeDescription();if(name==='bulkDose'||name==='doseSeriesMultiplier')updateDoseUi();scheduleSave();});
  }
  titleInput.addEventListener('input',event=>{titleEdited=true;selection.projectTitle=event.target.value;scheduleSave();});
  window.microscopyFolderLoader={getSelection:()=>selection};
  const activeDesign=()=>selection.cjob || selection.manualDesign;
  window.CjobView.configure({getProject:()=>({...selection,cjob:activeDesign()}),onChange:job=>{
    if(activeDesign()?.id!==job.id)selection.selectedZoneId='';selection.cjob=job;updateZoneUi();window.ImageTable.refresh();scheduleSave();
  },onSetGeometry:geometry=>{window.ImageTable.mutateProject(()=>{const key=selection.cjob.fingerprint,prior=selection.cjobGeometry[key]||{};selection.cjobGeometry={...selection.cjobGeometry,[key]:Object.fromEntries(Object.entries(geometry).map(([name,value])=>[name,{...prior[name],...value}]))};});
  },onSetDefaultInner:(value)=>window.ImageTable.mutateProject(()=>{const active=activeDesign();if(active)selection.innerTogetherByDesign[active.fingerprint]=value;}),onUpdateZone:(id,innerSpotsTogether,spotIds,spotGroups)=>window.ImageTable.mutateProject(()=>{const zone=selection.zones.find(item=>item.id===id);if(zone){zone.innerSpotsTogether=innerSpotsTogether;zone.spotIds=spotIds;zone.spotGroups=spotGroups;}}),onCreateZone:(name,spotIds,innerSpotsTogether,spotGroups)=>{
    const active=activeDesign();const zone={id:'zone-'+crypto.randomUUID(),cjobId:active.id,cjobFingerprint:active.fingerprint,name,spotIds:[...spotIds],innerSpotsTogether,spotGroups:structuredClone(spotGroups)};
    window.ImageTable.mutateProject(()=>{selection.zones.push(zone);selection.selectedZoneId=zone.id;updateZoneUi();});
  }});
  function syncSelection(images){
    selection.images=images;selection.summary.count=images.length;
    selection.summary.width=images[0]?.width ?? null;selection.summary.height=images[0]?.height ?? null;
    warning.hidden=!images.some(image=>image.sidecarMissing);
    warning.textContent='Some images were added without a sidecar folder. Missing metadata may make later analysis less convenient.';
    scheduleSave();
  }
  const doseApply=document.getElementById('dose-apply'),seriesError=document.getElementById('dose-series-error');
  function updateDoseUi(){const field=projectFields.bulkDose,multiplier=projectFields.doseSeriesMultiplier;doseApply.disabled=!storageReady||!window.ImageTable.getSelectedIds().length||!field.value.trim()||!field.validity.valid||!Number.isFinite(Number(field.value))||!multiplier.value.trim()||!multiplier.validity.valid||!Number.isFinite(Number(multiplier.value));seriesError.textContent='';}
  doseApply.addEventListener('click',()=>{if(doseApply.disabled)return;try{const ids=window.ImageTable.getSelectedIds(),factor=Number(projectFields.doseSeriesMultiplier.value);if(factor===1)window.ImageTable.assignDose(ids,projectFields.bulkDose.value);else window.ImageTable.assignDoseSeries(ids,Number(projectFields.bulkDose.value),factor);seriesError.textContent='';}catch(error){seriesError.textContent=error.message||'Could not apply dose series.';}});
  const bgSelect=document.getElementById('background-selector'),bgInput=document.getElementById('background-input'),bgName=document.getElementById('background-rename-input'),bgStatus=document.getElementById('background-status');
  const bgView=document.getElementById('background-view'),bgApply=document.getElementById('background-apply'),bgRename=document.getElementById('background-rename'),bgRemove=document.getElementById('background-remove');
  function updateBackgroundUi() {
    bgSelect.replaceChildren(new Option('None',''));
    for(const background of selection.backgrounds)bgSelect.add(new Option(background.name,background.id));
    bgSelect.add(new Option('Load…','__load__'));
    bgSelect.value=selection.selectedBackgroundId;
    const hasBackground=selection.backgrounds.some(background=>background.id===selection.selectedBackgroundId);
    bgSelect.disabled=!storageReady;bgView.disabled=!storageReady||!hasBackground;bgRename.disabled=!storageReady||!hasBackground;bgRemove.disabled=!storageReady||!hasBackground;
    bgApply.disabled=!storageReady || !window.ImageTable.getSelectedIds().length;
  }
  const zoneSelect=document.getElementById('cjob-zone'),zoneApply=document.getElementById('cjob-zone-apply'),zoneRemove=document.getElementById('cjob-zone-remove'),zoneRename=document.getElementById('cjob-zone-rename'),zoneName=document.getElementById('cjob-zone-rename-input'),zoneRenameError=document.getElementById('cjob-zone-rename-error');
  let renamingZoneId=null;
  function updateZoneUi(){
    zoneSelect.replaceChildren(new Option('Everything',''));
    for(const zone of selection.zones)if(zone.cjobId===activeDesign()?.id)zoneSelect.add(new Option(zone.name,zone.id));
    if(selection.selectedZoneId && !selection.zones.some(zone=>zone.id===selection.selectedZoneId && zone.cjobId===activeDesign()?.id))selection.selectedZoneId='';
    zoneSelect.value=selection.selectedZoneId;zoneSelect.disabled=!storageReady;
    zoneApply.disabled=!storageReady || !window.ImageTable.getSelectedIds().length;zoneRemove.disabled=!storageReady || !selection.selectedZoneId;zoneRename.disabled=!storageReady || !selection.selectedZoneId;
  }
  zoneSelect.addEventListener('change',()=>{cancelZoneRename();selection.selectedZoneId=zoneSelect.value;zoneRenameError.textContent='';updateZoneUi();scheduleSave();});
  function cancelZoneRename(){renamingZoneId=null;zoneName.hidden=true;zoneRenameError.textContent='';}
  zoneRename.addEventListener('click',()=>{const zone=selection.zones.find(item=>item.id===selection.selectedZoneId&&item.cjobId===activeDesign()?.id);if(!zone)return;renamingZoneId=zone.id;zoneName.value=zone.name;zoneName.hidden=false;zoneRenameError.textContent='';zoneName.focus();zoneName.select();});
  function finishZoneRename(){
    if(!renamingZoneId)return;const zone=selection.zones.find(item=>item.id===renamingZoneId),name=zoneName.value.trim();
    if(!zone){cancelZoneRename();return;}
    if(!name){zoneRenameError.textContent='Enter a zone name.';return;}
    if(name.toLocaleLowerCase()==='everything'||selection.zones.some(other=>other.id!==zone.id&&other.cjobId===zone.cjobId&&other.name.toLocaleLowerCase()===name.toLocaleLowerCase())){zoneRenameError.textContent='Choose a different zone name.';return;}
    cancelZoneRename();if(name!==zone.name)window.ImageTable.mutateProject(()=>{zone.name=name;updateZoneUi();});
  }
  zoneName.addEventListener('input',()=>{zoneRenameError.textContent='';});
  zoneName.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();finishZoneRename();}else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();cancelZoneRename();zoneRename.focus();}});
  zoneName.addEventListener('blur',finishZoneRename);
  zoneApply.addEventListener('click',()=>window.ImageTable.assignZone(window.ImageTable.getSelectedIds(),selection.selectedZoneId));
  zoneRemove.addEventListener('click',()=>{
    const id=selection.selectedZoneId;if(!id)return;
    window.ImageTable.mutateProject(state=>{selection.zones=selection.zones.filter(zone=>zone.id!==id);selection.selectedZoneId='';for(const item of state.items())if(item.zoneId===id)state.setZone(item.id,'');updateZoneUi();});
  });
  const tableOptions={onUpdate:syncSelection,getBackgrounds:()=>selection.backgrounds,getZones:()=>selection.zones,getCurrentCjob:()=>activeDesign()?.id ?? null,
    getExtras:()=>({negative:selection.negative,backgrounds:selection.backgrounds.map(background=>({...background})),selectedBackgroundId:selection.selectedBackgroundId,zones:selection.zones.map(zone=>({...zone,spotIds:[...zone.spotIds],spotGroups:zone.spotGroups?.map(group=>[...group])})),selectedZoneId:selection.selectedZoneId,cjobGeometry:structuredClone(selection.cjobGeometry),cjobDoseOverrides:structuredClone(selection.cjobDoseOverrides),cjobDrafts:structuredClone(selection.cjobDrafts),designRotationByDesign:structuredClone(selection.designRotationByDesign),mirrorYByDesign:structuredClone(selection.mirrorYByDesign),sadpByDesign:structuredClone(selection.sadpByDesign),innerTogetherByDesign:structuredClone(selection.innerTogetherByDesign),cjob:selection.cjob,manualDesign:selection.manualDesign,manualDraft:structuredClone(selection.manualDraft)}),
    restoreExtras:extra=>{if(!extra)return;const negative=Boolean(extra.negative);if(negative!==selection.negative)window.ImageTable.clearThumbnails();selection.negative=negative;negativeInput.checked=negative;window.TiffImage.setNegative(negative);selection.backgrounds=extra.backgrounds.map(background=>({...background}));selection.selectedBackgroundId=extra.selectedBackgroundId;selection.zones=(extra.zones||[]).map(zone=>({...zone,spotIds:[...zone.spotIds],spotGroups:zone.spotGroups?.map(group=>[...group])}));selection.selectedZoneId=extra.selectedZoneId||'';selection.cjobGeometry=structuredClone(extra.cjobGeometry||{});selection.cjobDoseOverrides=structuredClone(extra.cjobDoseOverrides||{});selection.cjobDrafts=structuredClone(extra.cjobDrafts||{});selection.designRotationByDesign=structuredClone(extra.designRotationByDesign||{});selection.mirrorYByDesign=structuredClone(extra.mirrorYByDesign||{});selection.sadpByDesign=structuredClone(extra.sadpByDesign||{});selection.innerTogetherByDesign=structuredClone(extra.innerTogetherByDesign||{});selection.cjob=extra.cjob||null;selection.manualDesign=extra.manualDesign||null;selection.manualDraft=structuredClone(extra.manualDraft||null);updateBackgroundUi();updateZoneUi();window.CjobView.refreshUi();},
    onSelectionChange:()=>{updateBackgroundUi();updateZoneUi();updateDoseUi();}};
  window.ImageTable.start([],tableOptions);
  window.MaskDesignEditor?.configure({
    getImported:()=>selection.cjob,
    getDraft:()=>selection.manualDraft,
    getManual:()=>selection.manualDesign,
    getImportedRows:()=>window.CjobView.editableRows(),
    getImportedDraft:()=>selection.cjobDrafts[selection.cjob?.fingerprint],
    onImportedDraft:draft=>{selection.cjobDrafts[selection.cjob.fingerprint]=draft;scheduleSave();},
    prepareGeometry:()=>window.CjobView.prepareGeometry(),
    getRotation:()=>Boolean(selection.cjob&&selection.designRotationByDesign[selection.cjob.fingerprint]),
    setRotation:value=>{if(selection.cjob)window.ImageTable.mutateProject(()=>{selection.designRotationByDesign[selection.cjob.fingerprint]=value;window.CjobView.refreshUi();});},
    getMirrorY:()=>{const design=activeDesign();return design ? (selection.mirrorYByDesign[design.fingerprint] ?? true) : true;},
    setMirrorY:value=>{const design=activeDesign();if(design)window.ImageTable.mutateProject(()=>{selection.mirrorYByDesign[design.fingerprint]=value;window.CjobView.refreshUi();});},
    getSadp:()=>{const design=activeDesign();return design?(selection.sadpByDesign[design.fingerprint] ?? Boolean(design.model?.sadpDocumented)):false;},
    setSadp:value=>{const design=activeDesign();if(design)window.ImageTable.mutateProject(()=>{selection.sadpByDesign[design.fingerprint]=value;window.CjobView.refreshUi();});},
    onSaveImported:rows=>window.ImageTable.mutateProject(()=>{const key=selection.cjob.fingerprint,geometry=structuredClone(selection.cjobGeometry[key]||{}),doses={...(selection.cjobDoseOverrides[key]||{})};for(const row of rows){for(const field of row.editableFields){const value=String(row[field]??'').trim(),number=value===''?null:Number(value);if(field==='dose'){if(number===null)delete doses[row.id];else doses[row.id]=number;}else{geometry[row.pattern]??={};geometry[row.pattern][field]=number;}}}selection.cjobGeometry[key]=geometry;selection.cjobDoseOverrides[key]=doses;delete selection.cjobDrafts[key];window.CjobView.refreshUi();}),
    onDraft:draft=>{selection.manualDraft=draft;scheduleSave();},
    onRemoveCjob:()=>window.ImageTable.mutateProject(()=>{selection.cjob=null;selection.selectedZoneId='';updateZoneUi();window.CjobView.refreshUi();}),
    onSave:(name,rows,sadp,mirrorY)=>window.ImageTable.mutateProject(state=>{
      const old=selection.manualDesign,id=old?.id||'manual-'+crypto.randomUUID(),fingerprint=old?.fingerprint||'manual:'+crypto.randomUUID();
      const gratings=rows.map(row=>({name:'manual-'+row.id,pitch:Number(row.pitch),effectivePitch:Number(row.pitch),orientation:'vertical',x:Number(row.x),y:Number(row.y),width:Number(row.width),height:Number(row.height),dose:row.dose===''?null:Number(row.dose),spotBaseId:row.id}));
      selection.manualDesign={id,fingerprint,name,manual:true,model:{windows:[{name:'Mask',x:0,y:0,gratings}],warnings:[]}};
      selection.manualDraft=null;selection.sadpByDesign[fingerprint]=sadp;selection.mirrorYByDesign[fingerprint]=mirrorY;
      const available=new Set(gratings.map(g=>g.spotBaseId));
      for(const zone of selection.zones)if(zone.cjobId===id){zone.spotIds=zone.spotIds.filter(spot=>available.has(spot.slice(0,spot.lastIndexOf(':'))));const retained=new Set(zone.spotIds);if(zone.spotGroups)zone.spotGroups=zone.spotGroups.map(group=>group.filter(spot=>retained.has(spot))).filter(group=>group.length);}
      updateZoneUi();window.CjobView.refreshUi();
    })
  });
  bgSelect.addEventListener('change',()=>{
    if(bgSelect.value==='__load__'){bgSelect.value=selection.selectedBackgroundId;bgInput.value='';bgInput.click();return;}
    selection.selectedBackgroundId=bgSelect.value;updateBackgroundUi();scheduleSave();
  });
  bgInput.addEventListener('change',async()=>{
    const file=bgInput.files[0];if(!file)return;
    bgStatus.textContent='Checking background…';bgSelect.disabled=true;
    try {
      await window.MicroscopyFolderValidator.validateFolder({files:[{path:'Selected images/'+file.name,file}],directories:['Selected images'],selectionKind:'files'});
      const background={id:'background-'+crypto.randomUUID(),name:file.name.replace(/\.tiff?$/i,''),file};
      window.ImageTable.mutateProject(()=>{selection.backgrounds.push(background);selection.selectedBackgroundId=background.id;});
      updateBackgroundUi();bgStatus.textContent='';
    } catch(error) {bgStatus.textContent=error.message||'Could not read background image.';updateBackgroundUi();}
  });
  bgView.addEventListener('click',()=>{const background=selection.backgrounds.find(item=>item.id===selection.selectedBackgroundId);if(background)window.ImageTable.inspectBackground(background,bgView);});
  bgApply.addEventListener('click',()=>{window.ImageTable.assignBackground(window.ImageTable.getSelectedIds(),selection.selectedBackgroundId);});
  let renameOriginal=null;
  bgRename.addEventListener('click',()=>{const bg=selection.backgrounds.find(item=>item.id===selection.selectedBackgroundId);if(!bg)return;renameOriginal=bg.name;bgName.value=bg.name;bgName.hidden=false;bgName.focus();bgName.select();});
  function finishRename(save){
    if(bgName.hidden)return;
    const background=selection.backgrounds.find(item=>item.id===selection.selectedBackgroundId),name=bgName.value.trim();bgName.hidden=true;
    if(save && background && name && name!==renameOriginal)window.ImageTable.mutateProject(()=>{background.name=name;});
    renameOriginal=null;updateBackgroundUi();
  }
  bgName.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();finishRename(true);}else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();finishRename(false);}});
  bgName.addEventListener('blur',()=>finishRename(true));
  bgRemove.addEventListener('click',()=>{
    const id=selection.selectedBackgroundId;if(!id)return;
    window.ImageTable.mutateProject(state=>{selection.backgrounds=selection.backgrounds.filter(background=>background.id!==id);selection.selectedBackgroundId='';for(const item of state.items())if(item.backgroundId===id)state.setBackground(item.id,'');});
    updateBackgroundUi();
  });
  const clean=p=>p.replace(/\\/g,'/').replace(/^\/+|\/+$/g,'');
  function selectedImages(source) {
    const root=clean(source.directories[0] || '');
    return source.files.filter(({path})=>{const bits=clean(path).split('/');return bits.length===2 && bits[0]===root && !bits[1].startsWith('._') && /\.tiff?$/i.test(bits[1]);});
  }
  function sidecarFiles(source) {
    const root=clean(source.directories[0] || '');
    return source.files.filter(({path})=>{const parts=clean(path).split('/');return parts.length===3 && parts[0]===root && /^(?:leicametadata|metadata|sidecars?)$/i.test(parts[1]) && /\.xlif$/i.test(parts[2]);});
  }
  function setSaveStatus(state,text){saveStatus.dataset.state=state;saveStatus.textContent=text;}
  function savedSnapshot() {
    const assets=new Map();
    const sources=selection.sources.map(source=>{
      if(!source.storageId)source.storageId=crypto.randomUUID();
      const sidecars=sidecarFiles(source).map((entry,index)=>{
        const assetKey='sidecar:'+source.storageId+':'+index;assets.set(assetKey,entry.file);return {path:entry.path,assetKey};
      });
      return {id:source.storageId,directories:source.directories,selectionKind:source.selectionKind || 'folder',directoryVisibility:source.directoryVisibility,sidecars};
    });
    const images=selection.images.map(item=>{
      const assetKey='image:'+item.id;assets.set(assetKey,item.file);
      return {id:item.id,path:item.path,name:item.name,exposureDose:item.exposureDose ?? '',magnification:item.magnification ?? '',backgroundId:item.backgroundId || '',zoneId:item.zoneId || '',width:item.width,height:item.height,sidecarMissing:item.sidecarMissing,sourceId:item.source.storageId,assetKey};
    });
    const backgrounds=selection.backgrounds.map(bg=>{const assetKey='background:'+bg.id;assets.set(assetKey,bg.file);return {id:bg.id,name:bg.name,assetKey};});
    const cjob=selection.cjob ? {id:selection.cjob.id,name:selection.cjob.name,assetKey:'cjob:'+selection.cjob.id} : null;
    if(cjob)assets.set(cjob.assetKey,selection.cjob.file);
    return {project:{cjob,projectTitle:selection.projectTitle,mask:selection.mask,wavelength:selection.wavelength,gap:selection.gap,resist:selection.resist,description:selection.description,negative:selection.negative,bulkDose:selection.bulkDose,doseSeriesMultiplier:selection.doseSeriesMultiplier,titleEdited,titleFromFolder,images,sources,backgrounds,selectedBackgroundId:selection.selectedBackgroundId,zones:selection.zones,selectedZoneId:selection.selectedZoneId,cjobGeometry:selection.cjobGeometry,cjobDoseOverrides:selection.cjobDoseOverrides,cjobDrafts:selection.cjobDrafts,designRotationByDesign:selection.designRotationByDesign,mirrorYByDesign:selection.mirrorYByDesign,sadpByDesign:selection.sadpByDesign,innerTogetherByDesign:selection.innerTogetherByDesign,manualDesign:selection.manualDesign,manualDraft:selection.manualDraft},assets};
  }
  async function drainSaves() {
    if(saving || !storageReady)return;
    saving=true;
    while(savePending){
      const pending=savePending;savePending=null;
      try {await window.TableProjectStore.save(pending.project,pending.assets);saveFailed=false;}
      catch(err){saveFailed=true;savePending=null;setSaveStatus('error',`Could not save project: ${err.message}. Keep this tab open.`);break;}
    }
    saving=false;if(!saveFailed)setSaveStatus('saved','Saved locally');
  }
  function scheduleSave(){
    if(!storageReady)return;
    try {savePending=savedSnapshot();setSaveStatus('saving','Saving locally…');void drainSaves();}
    catch(err){saveFailed=true;setSaveStatus('error',`Could not save project: ${err.message}. Keep this tab open.`);}
  }
  window.addEventListener('beforeunload',event=>{if(saving || savePending || saveFailed){event.preventDefault();event.returnValue='';}});
  async function restoreProject(){
    try {
      const saved=await window.TableProjectStore.open();
      if(saved){
        const {project,assets}=saved;
        selection.projectTitle=project.projectTitle;titleInput.value=selection.projectTitle;selection.negative=Boolean(project.negative);negativeInput.checked=selection.negative;window.TiffImage.setNegative(selection.negative);
        for(const [name,field] of Object.entries(projectFields)){selection[name]=project[name] ?? (name==='doseSeriesMultiplier'?'1.0':'');field.value=selection[name];}
        titleEdited=Boolean(project.titleEdited);titleFromFolder=Boolean(project.titleFromFolder);
        selection.backgrounds=(project.backgrounds||[]).map(bg=>({id:bg.id,name:bg.name,file:assets.get(bg.assetKey)}));
        selection.selectedBackgroundId=project.selectedBackgroundId || '';
        selection.zones=project.zones||[];selection.selectedZoneId=project.selectedZoneId||'';selection.cjobGeometry=project.cjobGeometry||{};selection.cjobDoseOverrides=project.cjobDoseOverrides||{};selection.cjobDrafts=project.cjobDrafts||{};selection.designRotationByDesign=project.designRotationByDesign||{};selection.mirrorYByDesign=project.mirrorYByDesign||{};selection.sadpByDesign=project.sadpByDesign||{};selection.innerTogetherByDesign=project.innerTogetherByDesign||{};selection.manualDesign=project.manualDesign||null;selection.manualDraft=project.manualDraft||null;
        if(project.cjob){const file=assets.get(project.cjob.assetKey);selection.cjob=await window.CjobView.restore(project.cjob,file);}
        const sourceById=new Map();
        for(const source of project.sources){
          const restored={storageId:source.id,directories:source.directories,selectionKind:source.selectionKind,directoryVisibility:source.directoryVisibility,files:source.sidecars.map(entry=>({path:entry.path,file:assets.get(entry.assetKey)}))};
          sourceById.set(source.id,restored);selection.sources.push(restored);
        }
        const images=project.images.map(record=>{
          const source=sourceById.get(record.sourceId);
          if(!source)throw new Error('A saved image source is missing.');
          const file=assets.get(record.assetKey);source.files.push({path:record.path,file});
          const {assetKey,sourceId,...item}=record;
          return {...item,file,source};
        });
        window.ImageTable.start(images,{...tableOptions,preserveOrder:true});
      }
      resizeDescription();storageReady=true;busy=false;select.disabled=false;selectImages.disabled=false;titleInput.disabled=false;negativeInput.disabled=false;for(const field of Object.values(projectFields))field.disabled=false;updateBackgroundUi();updateZoneUi();updateDoseUi();window.CjobView.setReady(true);window.MaskDesignEditor?.setReady(true);setSaveStatus('saved','Saved locally');
    } catch(err) {
      saveFailed=true;setSaveStatus('error',`Could not restore project: ${err.message}. Your saved data has not been changed.`);
    }
  }
  const newProjectButton=document.getElementById('new-project'),previousProjectButton=document.getElementById('previous-project');
  const emptyProject=()=>({projectTitle:'New Project 1',mask:'',wavelength:'',gap:'',resist:'',description:'',negative:false,bulkDose:'',doseSeriesMultiplier:'1.0',titleEdited:false,titleFromFolder:false,cjob:null,manualDesign:null,manualDraft:null,cjobGeometry:{},cjobDoseOverrides:{},cjobDrafts:{},designRotationByDesign:{},mirrorYByDesign:{},sadpByDesign:{},innerTogetherByDesign:{},zones:[],selectedZoneId:'',backgrounds:[],selectedBackgroundId:'',images:[],sources:[]});
  async function updateProjectSwitchUi(){previousProjectButton.hidden=!(await window.TableProjectStore.hasPrevious());newProjectButton.disabled=!storageReady;previousProjectButton.disabled=!storageReady;}
  async function switchProject(previous){
    if(!storageReady||busy)return;busy=true;newProjectButton.disabled=true;previousProjectButton.disabled=true;
    try {
      while(saving||savePending)await new Promise(resolve=>setTimeout(resolve,20));
      if(saveFailed)throw new Error('Save the current project before switching.');
      await window.OM13Storage.ready;await window.OM13Storage.flush();
      const key='om13-standalone-viewer-hash',currentHash=sessionStorage.getItem(key)||'',savedHash=await window.TableProjectStore.switchProject(emptyProject(),currentHash,previous);
      const nextHash=/^#work=[0-9a-f-]{36}$/i.test(savedHash)?savedHash:'#work='+crypto.randomUUID();sessionStorage.setItem(key,nextHash);history.replaceState(null,'',nextHash);location.reload();
    } catch(err){busy=false;setSaveStatus('error',`Could not switch project: ${err.message}`);newProjectButton.disabled=false;previousProjectButton.disabled=false;}
  }
  newProjectButton.addEventListener('click',()=>void switchProject(false));previousProjectButton.addEventListener('click',()=>void switchProject(true));
  void restoreProject().then(()=>storageReady&&updateProjectSwitchUi());
  async function processSources(promise) {
    if(busy)return;
    const token=++generation;busy=true;error.hidden=true;error.textContent='';progress.textContent='Reading selection…';select.disabled=true;selectImages.disabled=true;menu.open=false;
    try {
      const sources=await promise, results=[];
      for(let i=0;i<sources.length;i++) {
        const source=sources[i];
        const result=await window.MicroscopyFolderValidator.validateFolder(source,(n,total,read,size)=>{
          if(token===generation)progress.textContent=`Checking TIFF ${n} of ${total}${size ? ` · ${Math.round(read/size*100)}%` : ''}…`;
        },()=>token!==generation);
        if(token!==generation)return;
        const expected=results[0] || (selection.images.length ? selection.summary : null);
        if(expected && (result.width!==expected.width || result.height!==expected.height))throw new Error(`TIFF resolution mismatch: the selection is ${result.width} × ${result.height} pixels; existing images are ${expected.width} × ${expected.height}.`);
        results.push(result);
      }
      if(token!==generation)return;
      const items=[];
      for(let i=0;i<sources.length;i++) {
        const source=sources[i],result=results[i],entries=selectedImages(source);
        const magnifications=await window.SidecarMagnification.findMagnifications(entries,sidecarFiles(source));
        if(token!==generation)return;
        entries.forEach((entry,j)=>items.push({...entry,id:`image-${crypto.randomUUID()}`,width:result.width,height:result.height,magnification:magnifications[j],sidecarMissing:!result.sidecarFolder,source}));
      }
      const folder=sources.find(source=>source.selectionKind!=='files');
      if(folder && !titleEdited && !titleFromFolder) {
        const folderName=clean(folder.directories[0]||'');
        if(folderName){selection.projectTitle=folderName;titleInput.value=folderName;titleFromFolder=true;}
      }
      selection.sources.push(...sources);
      window.ImageTable.add(items);
      progress.textContent='';
    } catch(e) {
      if(token!==generation)return;
      progress.textContent='';error.textContent=e.message || 'Could not read this selection. Please try again.';error.hidden=false;
    } finally {if(token===generation){busy=false;select.disabled=false;selectImages.disabled=false;}}
  }
  select.addEventListener('click',async()=>{
    if(typeof window.showDirectoryPicker!=='function'){input.value='';input.click();return;}
    try {const directory=await window.showDirectoryPicker({mode:'read'});processSources(Promise.all([fromHandle(directory)]));}
    catch(e){if(e.name==='AbortError')return;if(e.name==='SecurityError'||e.name==='TypeError'||e.name==='NotAllowedError'){input.value='';input.click();}else{error.textContent=e.message||'Could not open folder picker.';error.hidden=false;}}
  });
  const fromFiles=files=>({files:files.map(file=>({path:'Selected images/'+file.name,file})),directories:['Selected images'],directoryVisibility:false,selectionKind:'files'});
  selectImages.addEventListener('click',()=>{imageInput.value='';imageInput.click();});
  imageInput.addEventListener('change',()=>{const files=Array.from(imageInput.files);if(files.length)processSources(Promise.resolve([fromFiles(files)]));});
  input.addEventListener('change',()=>{const files=Array.from(input.files);if(!files.length)return;const mapped=files.map(file=>({path:file.webkitRelativePath||file.name,file}));const root=mapped[0].path.split('/')[0];processSources(Promise.resolve([{files:mapped,directories:[root],directoryVisibility:false}]));});
  async function fromHandle(root) {
    const files=[],directories=[root.name];
    for await(const [name,entry] of root.entries()) {
      if(entry.kind==='directory') {
        directories.push(root.name+'/'+name);
        if(/^(?:leicametadata|metadata|sidecars?)$/i.test(name)) {
          try { for await(const [childName,child] of entry.entries()) if(child.kind==='file' && /\.xlif$/i.test(childName)) {
            try {files.push({path:root.name+'/'+name+'/'+childName,file:await child.getFile()});} catch { /* Unknown metadata remains blank. */ }
          }} catch { /* Unknown metadata remains blank. */ }
        }
      } else if(entry.kind==='file' && /\.tiff?$/i.test(name) && !name.startsWith('._'))files.push({path:root.name+'/'+name,file:await entry.getFile()});
    }
    return {files,directories,directoryVisibility:true,directoryHandle:root};
  }
  const readEntries=reader=>new Promise((resolve,reject)=>reader.readEntries(resolve,reject));
  const readFile=entry=>new Promise((resolve,reject)=>entry.file(resolve,reject));
  async function fromDrop(entry) {
    const directories=[entry.name],files=[],reader=entry.createReader();
    for(;;){const entries=await readEntries(reader);if(!entries.length)break;for(const child of entries){const path=entry.name+'/'+child.name;
      if(child.isDirectory){directories.push(path);if(/^(?:leicametadata|metadata|sidecars?)$/i.test(child.name)){
        try {const sideReader=child.createReader();for(;;){const sideEntries=await readEntries(sideReader);if(!sideEntries.length)break;for(const sidecar of sideEntries)if(sidecar.isFile && /\.xlif$/i.test(sidecar.name))try{files.push({path:path+'/'+sidecar.name,file:await readFile(sidecar)});}catch{}}}catch{}
      }} else if(child.isFile && /\.tiff?$/i.test(child.name) && !child.name.startsWith('._'))files.push({path,file:await readFile(child)});
    }}
    return {files,directories,directoryVisibility:true,directoryEntry:entry};
  }
  const hasFiles=e=>Array.from(e.dataTransfer?.types || []).includes('Files');
  for(const type of ['dragenter','dragover']) drop.addEventListener(type,event=>{if(!hasFiles(event))return;event.preventDefault();drop.classList.add('is-dragging');event.dataTransfer.dropEffect='copy';});
  drop.addEventListener('dragleave',event=>{if(!drop.contains(event.relatedTarget))drop.classList.remove('is-dragging');});
  drop.addEventListener('drop',event=>{
    if(!hasFiles(event))return;
    event.preventDefault();drop.classList.remove('is-dragging');
    const items=Array.from(event.dataTransfer?.items || []).filter(item=>item.kind==='file');
    const entries=items.map(item=>item.webkitGetAsEntry?.());
    const files=items.map((item,i)=>entries[i]?.isDirectory ? null : item.getAsFile());
    if(!items.length || files.some((file,i)=>!file && !entries[i]?.isDirectory)){error.textContent='Drop folders or TIFF files.';error.hidden=false;return;}
    // Chrome cannot enumerate legacy directory entries on file:// pages. Capture
    // the modern handle promises synchronously during the drop, then fall back
    // to legacy entries where the modern API is unavailable.
    const directories=entries.map((entry,i)=>{
      if(!entry?.isDirectory)return null;
      let handle;
      try { handle=items[i].getAsFileSystemHandle?.(); } catch { /* Use the legacy entry. */ }
      if(!handle)return fromDrop(entry);
      return Promise.resolve(handle).then(value=>value?.kind==='directory' ? fromHandle(value) : fromDrop(entry),()=>fromDrop(entry));
    }).filter(Boolean);
    const loose=files.filter(Boolean);if(loose.length)directories.push(Promise.resolve(fromFiles(loose)));
    processSources(Promise.all(directories));
  });
  window.addEventListener('dragover',event=>{if(!shell.hidden && hasFiles(event))event.preventDefault();});
  window.addEventListener('drop',event=>{if(!shell.hidden && hasFiles(event))event.preventDefault();});
})();

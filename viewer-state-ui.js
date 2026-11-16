/* Save and restore an image-free portable project snapshot. */
'use strict';
window.setupViewerState=function({data,beforeSave,alignmentSnapshot}){
  const get=id=>document.getElementById(id),save=get('save-viewer-state'),load=get('load-viewer-state'),input=get('viewer-state-file'),status=get('viewer-file-status');
  const dialog=get('state-relink-dialog'),message=get('state-relink-message'),files=get('state-relink-file-input'),folder=get('state-relink-folder-input');let active=false;
  function busy(value){active=value;save.disabled=value;load.disabled=value;get('export-positions').disabled=value;}
  function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function name(text){return (String(text||'Project').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').trim()||'Project').slice(0,100);}
  save.addEventListener('click',async()=>{
    if(active)return;busy(true);
    try{
      status.textContent='Preparing state…';await beforeSave();await window.OM13Storage.flush();const saved=await window.TableProjectStore.open();
      const ids=saved?.project?.images?.map(x=>x.id)||[],displayed=data.importedProject?data.images.map(x=>x.id):[];
      if((saved?.project?.revision||0)!==(data.projectRevision||0)||JSON.stringify(ids)!==JSON.stringify(displayed)||(data.importedProject&&(saved?.project?.mask||'')!==(data.mask||'')))throw new Error('The project changed since this viewer opened. Reopen the viewer and try again.');
      const records=window.OM13Storage.entries(window.OM10Session.scope),alignment=alignmentSnapshot();
      if(alignment){const key=window.OM10Session.storageKey('stateRestoreAlignment').slice(window.OM10Session.scope.length),index=records.findIndex(row=>row[0]===key),row=[key,JSON.stringify(alignment)];if(index>=0)records[index]=row;else records.push(row);}
      let sidebar=null;try{sidebar=localStorage.getItem('om-project-sidebar-layout-v1');}catch(_){}
      const snapshot=await window.ViewerState.capture(saved,records,{projectSidebarLayout:sidebar},(n,total)=>{status.textContent=`Checking images… ${n} / ${total}`;});
      download(new Blob([JSON.stringify(snapshot)],{type:'application/json'}),name(saved.project.projectTitle)+'_state.json');status.textContent='State saved without image files.';
    }catch(error){status.textContent='Could not save state: '+(error.message||error);}finally{busy(false);}
  });
  async function pickMissing(missing,matched){
    return new Promise(resolve=>{
      let working=false,ended=false;
      function show(){const names=missing.map(item=>item.name);message.textContent=`${names.length} image file${names.length===1?' is':'s are'} needed. Select images or folders; files are matched by checksum.\n\n${names.slice(0,12).join('\n')}${names.length>12?`\n… and ${names.length-12} more`:''}`;}
      function done(ok){if(ended)return;ended=true;dialog.close();files.value='';folder.value='';files.removeEventListener('change',chosen);folder.removeEventListener('change',chosen);get('state-relink-files').removeEventListener('click',chooseFiles);get('state-relink-folder').removeEventListener('click',chooseFolder);get('state-relink-cancel').removeEventListener('click',cancel);dialog.removeEventListener('cancel',cancel);resolve(ok);}
      function chooseFiles(){if(!working)files.click();}function chooseFolder(){if(!working)folder.click();}function cancel(event){event?.preventDefault();if(!working)done(false);}
      async function chosen(event){if(working)return;working=true;const chosen=[...event.target.files];event.target.value='';try{for(const file of chosen){if(!missing.some(item=>item.size===file.size))continue;message.textContent=`Checking ${file.name}…`;const hash=await window.ViewerState.sha256(file);for(let i=missing.length-1;i>=0;i--)if(missing[i].sha256===hash&&missing[i].size===file.size){matched.set(missing[i].key,file);missing.splice(i,1);}}}catch(error){message.textContent='Could not read an image: '+(error.message||error);working=false;return;}working=false;if(!missing.length)done(true);else show();}
      files.addEventListener('change',chosen);folder.addEventListener('change',chosen);get('state-relink-files').addEventListener('click',chooseFiles);get('state-relink-folder').addEventListener('click',chooseFolder);get('state-relink-cancel').addEventListener('click',cancel);dialog.addEventListener('cancel',cancel);show();dialog.showModal();
    });
  }
  load.addEventListener('click',()=>{if(!active)input.click();});
  input.addEventListener('change',async()=>{
    const file=input.files[0];input.value='';if(!file||active)return;busy(true);
    try{
      status.textContent='Reading state…';const snapshot=JSON.parse(await file.text());window.ViewerState.validate(snapshot);await window.OM13Storage.flush();await window.TableProjectStore.open();
      const matched=new Map(),missing=[],reusable=new Set();let checked=0;
      for(const item of snapshot.images){status.textContent=`Checking saved images… ${++checked} / ${snapshot.images.length}`;const existing=await window.TableProjectStore.getAsset(item.key);if(existing?.size===item.size&&await window.ViewerState.sha256(existing)===item.sha256){matched.set(item.key,existing);reusable.add(item.key);}else missing.push(item);}
      if(missing.length&&!await pickMissing(missing,matched)){status.textContent='State loading cancelled.';return;}
      const newId=crypto.randomUUID(),scope='om10-copy:generic-standalone-cleanup:'+newId+':',records=snapshot.records,assets=new Map(),keys=new Map();
      for(const item of snapshot.images){const found=matched.get(item.key);if(!found)throw new Error('An image is still missing.');if(reusable.has(item.key)){keys.set(item.key,item.key);continue;}
        const key='restored:'+newId+':'+item.key;keys.set(item.key,key);assets.set(key,new File([found],item.name,{type:item.type||found.type,lastModified:Number.isFinite(item.lastModified)?item.lastModified:found.lastModified}));}
      for(const item of snapshot.metadata){const key='restored:'+newId+':'+item.key;keys.set(item.key,key);assets.set(key,window.ViewerState.metadataFile(item));}
      const project=window.ViewerState.rekey(snapshot.project,keys);status.textContent='Restoring project…';await window.OM13Storage.writeScope(scope,records);await window.TableProjectStore.restore(project,assets);
      try{if(snapshot.extra?.projectSidebarLayout===null)localStorage.removeItem('om-project-sidebar-layout-v1');else if(typeof snapshot.extra?.projectSidebarLayout==='string')localStorage.setItem('om-project-sidebar-layout-v1',snapshot.extra.projectSidebarLayout);}catch(_){}
      try{sessionStorage.setItem('om13-standalone-viewer-hash','#work='+newId);}catch(_){}history.replaceState(null,'','#work='+newId);location.reload();
    }catch(error){status.textContent='Could not load state: '+(error.message||error);}finally{busy(false);}
  });
};

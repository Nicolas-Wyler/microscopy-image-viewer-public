/* Save and restore an image-free portable project snapshot. */
'use strict';
window.setupViewerState=function({data,beforeSave,alignmentSnapshot}){
  const get=id=>document.getElementById(id),save=get('save-viewer-state'),load=get('load-viewer-state'),input=get('viewer-state-file'),status=get('viewer-file-status');
  const dialog=get('state-relink-dialog'),message=get('state-relink-message'),files=get('state-relink-file-input'),folder=get('state-relink-folder-input');let active=false;
  const menu=get('state-load-menu'),list=get('state-recent-list'),browse=get('state-browse');
  const seed=Array.isArray(window.OM10_LOCAL_RECENT_STATES)?window.OM10_LOCAL_RECENT_STATES:[];
  const localIndexKey='microscopy-viewer-recent-index-v1', workKey='microscopy-viewer-recent-work:';
  let rootHandle=null;
  function readRecentIndex(){try{return JSON.parse(localStorage.getItem(localIndexKey)||'[]').filter(x=>x&&typeof x.label==='string'&&typeof x.path==='string');}catch{return [];}}
  function recentEntries(){const merged=new Map(readRecentIndex().map(x=>[x.path,x]));for(const item of seed)if(!merged.has(item.path))merged.set(item.path,item);return [...merged.values()];}
  function rememberRecent(entry){try{const all=readRecentIndex().filter(x=>x.path!==entry.path);all.unshift(entry);localStorage.setItem(localIndexKey,JSON.stringify(all.slice(0,50)));}catch{}}
  function scopeId(){return /^#work=([0-9a-f-]{36})$/.exec(location.hash)?.[1]||'';}
  function workEntry(){try{const raw=localStorage.getItem(workKey+scopeId());return raw?JSON.parse(raw):null;}catch{return null;}}
  function setWorkEntry(id,entry){try{localStorage.setItem(workKey+id,JSON.stringify(entry));}catch{}}
  // Handle persistence is separate from the state and image databases.
  const handlesDb=new Promise(resolve=>{try{const req=indexedDB.open('MicroscopyViewerRecentHandles',1);req.onupgradeneeded=()=>req.result.createObjectStore('handles');req.onsuccess=()=>resolve(req.result);req.onerror=()=>resolve(null);}catch{resolve(null);}});
  const rootReady=handlesDb.then(db=>new Promise(resolve=>{if(!db)return resolve();try{const q=db.transaction('handles').objectStore('handles').get('exposures');q.onsuccess=()=>{rootHandle=q.result||null;resolve();};q.onerror=()=>resolve();}catch{resolve();}}));
  async function rememberRoot(handle){rootHandle=handle;const db=await handlesDb;if(!db)return;await new Promise(resolve=>{try{const t=db.transaction('handles','readwrite');t.objectStore('handles').put(handle,'exposures');t.oncomplete=t.onerror=t.onabort=()=>resolve();}catch{resolve();}});}
  async function getRoot(){
    await rootReady;
    if(rootHandle){let permission='prompt';try{permission=await rootHandle.queryPermission({mode:'readwrite'});}catch{}if(permission==='granted')return rootHandle;try{if(await rootHandle.requestPermission({mode:'readwrite'})==='granted')return rootHandle;}catch{}}
    if(typeof window.showDirectoryPicker!=='function')throw new Error('This browser cannot access recent state files. Use Browse instead.');
    status.textContent='Choose the Exposures folder to access recent states.';
    const selected=await window.showDirectoryPicker({id:'microscopy-exposures',mode:'readwrite'});
    // A wrong selection must not create files elsewhere.
    await selected.getDirectoryHandle('Viewer');await rememberRoot(selected);return selected;
  }
  async function atPath(directory,path,create=false){
    const parts=String(path).split('/');if(!parts.length||parts.some(p=>!p||p==='.'||p==='..'||p.includes('\\')))throw new Error('Invalid saved file path.');
    for(const part of parts.slice(0,-1))directory=await directory.getDirectoryHandle(part,{create});
    return directory.getFileHandle(parts.at(-1),{create});
  }
  function closeMenu(){menu.hidden=true;load.setAttribute('aria-expanded','false');}
  function showMenu(){
    list.replaceChildren();const entries=recentEntries();
    if(!entries.length){const empty=document.createElement('div');empty.className='state-recent-empty';empty.textContent='No recent states';list.append(empty);}
    for(const entry of entries){const button=document.createElement('button');button.type='button';button.textContent=entry.label;button.addEventListener('click',()=>{closeMenu();openRecent(entry);});list.append(button);}
    menu.hidden=false;load.setAttribute('aria-expanded','true');
  }
  load.addEventListener('click',()=>{if(active)return;menu.hidden?showMenu():closeMenu();});
  document.addEventListener('click',e=>{if(!menu.hidden&&!e.target.closest('.state-load-menu-wrap'))closeMenu();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!menu.hidden){closeMenu();load.focus();}});
  browse.addEventListener('click',()=>{closeMenu();if(!active)input.click();});
  async function openRecent(entry){
    if(active)return;busy(true);
    try{const root=await getRoot(),file=await (await atPath(root,entry.path)).getFile();await loadFile(file,entry,root);}
    catch(error){if(error.name!=='AbortError')status.textContent='Could not open recent state: '+(error.message||error);else status.textContent='Recent state not opened.';}
    finally{busy(false);}
  }
  function busy(value){active=value;save.disabled=value;load.disabled=value;get('export-positions').disabled=value;}
  function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function name(text){return (String(text||'Project').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').trim()||'Project').slice(0,100);}
  save.addEventListener('click',async()=>{
    if(active)return;busy(true);
    let recentRoot=null,recentError=null;
    try{recentRoot=await getRoot();}catch(error){recentError=error;}
    try{
      status.textContent='Preparing state…';await beforeSave();await window.OM13Storage.flush();const saved=await window.TableProjectStore.open();
      const ids=saved?.project?.images?.map(x=>x.id)||[],displayed=data.importedProject?data.images.map(x=>x.id):[];
      if((saved?.project?.revision||0)!==(data.projectRevision||0)||JSON.stringify(ids)!==JSON.stringify(displayed)||(data.importedProject&&(saved?.project?.mask||'')!==(data.mask||'')))throw new Error('The project changed since this viewer opened. Reopen the viewer and try again.');
      const records=window.OM13Storage.entries(window.OM10Session.scope),alignment=alignmentSnapshot();
      if(alignment){const key=window.OM10Session.storageKey('stateRestoreAlignment').slice(window.OM10Session.scope.length),index=records.findIndex(row=>row[0]===key),row=[key,JSON.stringify(alignment)];if(index>=0)records[index]=row;else records.push(row);}
      let sidebar=null;try{sidebar=localStorage.getItem('om-project-sidebar-layout-v1');}catch(_){}
      const snapshot=await window.ViewerState.capture(saved,records,{projectSidebarLayout:sidebar},(n,total)=>{status.textContent=`Checking images… ${n} / ${total}`;});
      // Keep portable relative paths on newly captured image references too.
      const paths=new Map([...saved.project.images,...saved.project.backgrounds].filter(x=>x.path).map(x=>[x.assetKey,x.path]));
      for(const image of snapshot.images)if(paths.has(image.key))image.path=paths.get(image.key);
      const json=JSON.stringify(snapshot),blob=new Blob([json],{type:'application/json'});
      let entry=workEntry();
      if(!entry){const existing=recentEntries().find(x=>x.label===saved.project.projectTitle);entry=existing||{label:saved.project.projectTitle||'Project',path:'Viewer/recent-states/'+name(saved.project.projectTitle)+'-'+crypto.randomUUID().slice(0,8)+'_state.json',directory:null};}
      if(recentRoot){try{const handle=await atPath(recentRoot,entry.path,true),writer=await handle.createWritable();try{await writer.write(blob);await writer.close();}catch(error){await writer.abort().catch(()=>{});throw error;}rememberRecent(entry);setWorkEntry(scopeId(),entry);}catch(error){recentError=error;}}
      download(blob,name(saved.project.projectTitle)+'_state.json');
      status.textContent=recentError?'State downloaded, but Recent was not updated: '+(recentError.name==='AbortError'?'folder access was cancelled':recentError.message||recentError):'State saved and Recent updated.';
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
  input.addEventListener('change',async()=>{
    const file=input.files[0];input.value='';if(!file||active)return;busy(true);
    try{await loadFile(file,null,null);}catch(error){status.textContent='Could not load state: '+(error.message||error);}finally{busy(false);}
  });
  async function loadFile(file,entry,root){
      status.textContent='Reading state…';const snapshot=JSON.parse(await file.text());window.ViewerState.validate(snapshot);await window.OM13Storage.flush();await window.TableProjectStore.open();
      if(!entry)entry=recentEntries().find(x=>x.label===snapshot.project.projectTitle)||null;
      const matched=new Map(),missing=[],reusable=new Set();let checked=0;
      for(const item of snapshot.images){status.textContent=`Checking saved images… ${++checked} / ${snapshot.images.length}`;const existing=await window.TableProjectStore.getAsset(item.key);if(existing?.size===item.size&&await window.ViewerState.sha256(existing)===item.sha256){matched.set(item.key,existing);reusable.add(item.key);continue;}
        let found=null;if(root&&entry?.directory&&item.path)try{found=await (await atPath(root,entry.directory+'/'+item.path)).getFile();}catch{}
        if(found?.size===item.size&&await window.ViewerState.sha256(found)===item.sha256)matched.set(item.key,found);else missing.push(item);
      }
      if(missing.length&&!await pickMissing(missing,matched)){status.textContent='State loading cancelled.';return;}
      const newId=crypto.randomUUID(),scope='om10-copy:generic-standalone-cleanup:'+newId+':',records=snapshot.records,assets=new Map(),keys=new Map();
      for(const item of snapshot.images){const found=matched.get(item.key);if(!found)throw new Error('An image is still missing.');if(reusable.has(item.key)){keys.set(item.key,item.key);continue;}
        const key='restored:'+newId+':'+item.key;keys.set(item.key,key);assets.set(key,new File([found],item.name,{type:item.type||found.type,lastModified:Number.isFinite(item.lastModified)?item.lastModified:found.lastModified}));}
      for(const item of snapshot.metadata){const key='restored:'+newId+':'+item.key;keys.set(item.key,key);assets.set(key,window.ViewerState.metadataFile(item));}
      const project=window.ViewerState.rekey(snapshot.project,keys);status.textContent='Restoring project…';await window.OM13Storage.writeScope(scope,records);await window.TableProjectStore.restore(project,assets);
      try{if(snapshot.extra?.projectSidebarLayout===null)localStorage.removeItem('om-project-sidebar-layout-v1');else if(typeof snapshot.extra?.projectSidebarLayout==='string')localStorage.setItem('om-project-sidebar-layout-v1',snapshot.extra.projectSidebarLayout);}catch(_){}
      if(entry){rememberRecent(entry);setWorkEntry(newId,entry);}
      try{sessionStorage.setItem('om13-standalone-viewer-hash','#work='+newId);}catch(_){}history.replaceState(null,'','#work='+newId);location.reload();
  }
};

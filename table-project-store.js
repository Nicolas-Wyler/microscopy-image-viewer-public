/* Local, transactional project storage. Image and sidecar bytes stay on this computer. */
'use strict';
(() => {
  let db,revision=0;
  const existingAssets=new Set();
  function requestResult(request) {return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
  function transactionDone(tx) {return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||new Error('Local storage transaction failed'));tx.onerror=()=>{};});}
  async function open() {
    const request=indexedDB.open('OM_Microscopy_Table_Project_v1',1);
    request.onupgradeneeded=()=>{request.result.createObjectStore('projects');request.result.createObjectStore('assets');};
    db=await requestResult(request);
    db.onversionchange=()=>db.close();
    const tx=db.transaction(['projects','assets'],'readonly'),done=transactionDone(tx);
    const [project,keys]=await Promise.all([requestResult(tx.objectStore('projects').get('current')),requestResult(tx.objectStore('assets').getAllKeys())]);
    for(const key of keys)existingAssets.add(key);
    if(!project){await done;return null;}
    revision=project.revision || 0;
    const needed=new Set(project.images.map(x=>x.assetKey));
    for(const source of project.sources)for(const sidecar of source.sidecars)needed.add(sidecar.assetKey);
    for(const background of project.backgrounds || [])needed.add(background.assetKey);
    if(project.cjob)needed.add(project.cjob.assetKey);
    const assets=new Map();
    await Promise.all([...needed].map(async key=>{assets.set(key,await requestResult(tx.objectStore('assets').get(key)));}));
    await done;
    if([...needed].some(key=>!assets.get(key)))throw new Error('Some saved project files are missing from local storage.');
    return {project,assets};
  }
  async function save(project,assets) {
    if(!db)throw new Error('Local project storage is unavailable.');
    const tx=db.transaction(['projects','assets'],'readwrite'),done=transactionDone(tx),store=tx.objectStore('projects');
    const prior=await requestResult(store.get('current'));
    if((prior?.revision || 0)!==revision){tx.abort();try{await done;}catch{}throw new Error('This project changed in another tab. Reload this tab before editing here.');}
    const added=[];
    for(const [key,file] of assets)if(!existingAssets.has(key)){tx.objectStore('assets').put(file,key);added.push(key);}
    const next=revision+1;store.put({...project,revision:next},'current');
    await done;revision=next;for(const key of added)existingAssets.add(key);
  }
  async function getAsset(key){if(!db)await open();const tx=db.transaction('assets','readonly'),done=transactionDone(tx),value=await requestResult(tx.objectStore('assets').get(key));await done;return value;}
  async function restore(project,assets){
    if(!db)await open();const tx=db.transaction(['projects','assets'],'readwrite'),done=transactionDone(tx),store=tx.objectStore('projects'),prior=await requestResult(store.get('current'));
    if((prior?.revision||0)!==revision){tx.abort();try{await done;}catch{}throw new Error('The project changed in another tab. Reload before loading a state.');}
    if(prior)store.put(prior,'backup:'+Date.now()+':'+crypto.randomUUID());
    const added=[];for(const [key,file] of assets)if(!existingAssets.has(key)){tx.objectStore('assets').put(file,key);added.push(key);}
    const next=revision+1;store.put({...project,revision:next},'current');await done;revision=next;for(const key of added)existingAssets.add(key);
  }
  async function hasPrevious(){if(!db)await open();const tx=db.transaction('projects','readonly'),done=transactionDone(tx),previous=await requestResult(tx.objectStore('projects').get('previous'));await done;return Boolean(previous?.project);}
  async function switchProject(project, currentViewerHash, restorePrevious=false){
    if(!db)await open();const tx=db.transaction('projects','readwrite'),done=transactionDone(tx),store=tx.objectStore('projects');
    const [prior,previous]=await Promise.all([requestResult(store.get('current')),requestResult(store.get('previous'))]);
    if((prior?.revision||0)!==revision){tx.abort();try{await done;}catch{}throw new Error('This project changed in another tab. Reload before switching projects.');}
    if(restorePrevious&&!previous?.project){tx.abort();try{await done;}catch{}throw new Error('No previous project is available.');}
    if(prior){const archived={project:prior,viewerHash:currentViewerHash||''};store.put(archived,'previous');store.put(prior,'backup:'+Date.now()+':'+crypto.randomUUID());}else store.delete('previous');
    const next=restorePrevious?previous.project:project,hash=restorePrevious?previous.viewerHash:'';const nextRevision=revision+1;
    store.put({...next,revision:nextRevision},'current');await done;revision=nextRevision;return hash||'';
  }
  window.TableProjectStore={open,save,getAsset,restore,hasPrevious,switchProject};
})();

/* File handles for one state and one positions export, scoped to the workspace. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ViewerFileTargets=api;})(globalThis,function(){
  'use strict';
  function relativePath(path,rootName){
    let value=String(path||'').trim();if(!value||value.startsWith('/')||value.includes('\\'))throw new Error('Enter a path relative to the selected folder.');
    let parts=value.split('/');if(parts[0]===rootName)parts=parts.slice(1);
    if(!parts.length||parts.some(p=>!p||p==='.'||p==='..'))throw new Error('Enter a path relative to the selected folder.');return parts.join('/');
  }
  async function writeFile(handle,blob,{exists,confirm}){
    if(exists&&!confirm(handle.name))return false;
    const writer=await handle.createWritable();try{await writer.write(blob);await writer.close();return true;}catch(error){await writer.abort().catch(()=>{});throw error;}
  }
  function create({stateInput,exportInput,status}){
    const fields={state:stateInput,export:exportInput}, current={state:null,export:null};let rootHandle=null;
    const scope=()=>/^#work=([0-9a-f-]{36})$/.exec(location.hash)?.[1]||'default';
    const dbReady=new Promise(resolve=>{try{const q=indexedDB.open('MicroscopyViewerRecentHandles',1);q.onupgradeneeded=()=>q.result.createObjectStore('handles');q.onsuccess=()=>resolve(q.result);q.onerror=()=>resolve(null);}catch{resolve(null);}});
    async function get(key){const db=await dbReady;if(!db)return null;return new Promise(resolve=>{try{const q=db.transaction('handles').objectStore('handles').get(key);q.onsuccess=()=>resolve(q.result||null);q.onerror=()=>resolve(null);}catch{resolve(null);}});}
    async function put(key,value){const db=await dbReady;if(!db)return;await new Promise(resolve=>{try{const t=db.transaction('handles','readwrite');t.objectStore('handles').put(value,key);t.oncomplete=t.onerror=t.onabort=()=>resolve();}catch{resolve();}});}
    const ready=Promise.all([get('exposures'),get('file-state:'+scope()),get('file-export:'+scope())]).then(([root,s,e])=>{rootHandle=root;for(const [kind,value] of [['state',s],['export',e]])if(value){current[kind]=value;fields[kind].value=value.path||value.handle?.name||'';}});
    for(const kind of ['state','export'])fields[kind].addEventListener('input',()=>{if(current[kind]&&fields[kind].value!==current[kind].path)current[kind]=null;});
    async function getRoot(){await ready;if(rootHandle){try{let p=await rootHandle.queryPermission({mode:'readwrite'});if(p!=='granted')p=await rootHandle.requestPermission({mode:'readwrite'});if(p==='granted')return rootHandle;}catch{}}
      if(typeof window.showDirectoryPicker!=='function')throw new Error('Your browser cannot select a folder.');status.textContent='Choose the folder that contains the files.';rootHandle=await window.showDirectoryPicker({id:'microscopy-exposures',mode:'readwrite'});await put('exposures',rootHandle);return rootHandle;}
    async function clearRoot(){rootHandle=null;await put('exposures',null);}
    async function atPath(root,path,{create=false}={}){const parts=relativePath(path,root.name).split('/');let dir=root;for(const part of parts.slice(0,-1))dir=await dir.getDirectoryHandle(part);return dir.getFileHandle(parts.at(-1),{create});}
    async function describe(handle){await ready;if(rootHandle)try{if(await rootHandle.queryPermission({mode:'read'})==='granted'){const parts=await rootHandle.resolve(handle);if(parts)return [rootHandle.name,...parts].join('/');}}catch{}return handle.name;}
    async function bind(kind,handle,path,work=scope()){const value={handle,path:path||handle?.name||''};if(work===scope()){current[kind]=value;fields[kind].value=value.path;}await put('file-'+kind+':'+work,value);}
    async function openPicker(){if(typeof window.showOpenFilePicker!=='function')return null;const [handle]=await window.showOpenFilePicker({multiple:false,types:[{description:'Viewer state',accept:{'application/json':['.json']}}]});return {handle,file:await handle.getFile(),path:await describe(handle)};}
    async function choose(kind,suggested){
      await ready;const text=fields[kind].value.trim(),bound=current[kind];
      if(bound?.handle&&text===bound.path){const p=await bound.handle.queryPermission({mode:'readwrite'});if(p!=='granted'&&await bound.handle.requestPermission({mode:'readwrite'})!=='granted')throw new Error('Write access was not granted.');return {handle:bound.handle,path:text,exists:true};}
      if(text.includes('/')){const root=await getRoot(),rel=relativePath(text,root.name);let handle=null;try{handle=await atPath(root,rel);}catch(error){if(error.name!=='NotFoundError')throw error;}return {handle,path:root.name+'/'+rel,exists:Boolean(handle),root,relative:rel};}
      if(typeof window.showSaveFilePicker!=='function')throw new Error('This browser cannot save directly to a chosen file.');
      const extension=kind==='state'?'.json':'.zip',mime=kind==='state'?'application/json':'application/zip';
      const handle=await window.showSaveFilePicker({suggestedName:text||suggested,types:[{description:kind==='state'?'Viewer state':'Position export',accept:{[mime]:[extension]}}]});
      return {handle,path:await describe(handle),exists:false}; // The native picker confirms existing files.
    }
    async function write(kind,target,blob){
      // The destination could have appeared while an export was being prepared.
      if(!target.handle&&target.root){try{target.handle=await atPath(target.root,target.relative);target.exists=true;}catch(error){if(error.name!=='NotFoundError')throw error;}}
      if(target.exists&&!window.confirm(`Replace ${target.path}?`))return false;
      const handle=target.handle||await atPath(target.root,target.relative,{create:true});
      const done=await writeFile(handle,blob,{exists:false,confirm:()=>true});if(done)await bind(kind,handle,target.path);return done;
    }
    return {ready,getRoot,clearRoot,atPath,describe,bind,openPicker,choose,write};
  }
  return {relativePath,writeFile,create};
});

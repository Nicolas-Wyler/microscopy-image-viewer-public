/* Image-free project snapshots with checksum-verified image references. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ViewerState=api;})(globalThis,function(){
  'use strict';
  function validate(state){
    if(!state||state.format!=='microscopy-viewer-state'||state.version!==1||!state.project||!Array.isArray(state.project.images)||!Array.isArray(state.project.sources)||!Array.isArray(state.project.backgrounds)||!Array.isArray(state.images)||!Array.isArray(state.metadata)||!Array.isArray(state.records))throw new Error('This is not a supported viewer state file.');
    const seen=new Set(),pictures=new Set(),metadata=new Set();
    for(const item of state.images){if(!item||typeof item.key!=='string'||seen.has(item.key)||typeof item.name!=='string'||!Number.isSafeInteger(item.size)||item.size<0||!/^[a-f0-9]{64}$/.test(item.sha256))throw new Error('Invalid image reference in state file.');seen.add(item.key);pictures.add(item.key);}
    for(const item of state.metadata){if(!item||typeof item.key!=='string'||seen.has(item.key)||typeof item.name!=='string'||typeof item.base64!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.base64))throw new Error('Invalid project metadata in state file.');seen.add(item.key);metadata.add(item.key);}
    const sourceIds=new Set(),imageIds=new Set(),backgroundIds=new Set();
    for(const source of state.project.sources){if(!source||typeof source.id!=='string'||!source.id||sourceIds.has(source.id)||!Array.isArray(source.directories)||!Array.isArray(source.sidecars))throw new Error('Invalid source information in state file.');sourceIds.add(source.id);for(const item of source.sidecars)if(!item||typeof item.path!=='string'||!metadata.has(item.assetKey))throw new Error('A sidecar is missing from the state file.');}
    for(const item of state.project.backgrounds){if(!item||typeof item.id!=='string'||!item.id||backgroundIds.has(item.id)||typeof item.name!=='string'||!pictures.has(item.assetKey))throw new Error('Invalid background information in state file.');backgroundIds.add(item.id);}
    for(const item of state.project.images){if(!item||typeof item.id!=='string'||!item.id||imageIds.has(item.id)||!sourceIds.has(item.sourceId)||typeof item.path!=='string'||typeof item.name!=='string'||!Number.isSafeInteger(item.width)||item.width<1||!Number.isSafeInteger(item.height)||item.height<1||!pictures.has(item.assetKey)||(item.backgroundId&&!backgroundIds.has(item.backgroundId)))throw new Error('Invalid image information in state file.');imageIds.add(item.id);}
    if(state.project.cjob&&!metadata.has(state.project.cjob.assetKey))throw new Error('The CJOB is missing from the state file.');
    const keys=new Set();for(const row of state.records){if(!Array.isArray(row)||row.length!==2||typeof row[0]!=='string'||!row[0].startsWith('om10-viewer:')||keys.has(row[0])||typeof row[1]!=='string')throw new Error('Invalid viewer settings in state file.');keys.add(row[0]);}
    return true;
  }
  function rekey(project,keys){const copy=structuredClone(project),resolve=key=>{if(!keys.has(key))throw new Error('A saved project file could not be restored.');return keys.get(key);};for(const item of copy.images)item.assetKey=resolve(item.assetKey);for(const item of copy.backgrounds)item.assetKey=resolve(item.assetKey);for(const source of copy.sources)for(const item of source.sidecars)item.assetKey=resolve(item.assetKey);if(copy.cjob)copy.cjob.assetKey=resolve(copy.cjob.assetKey);return copy;}
  async function sha256(file){const bytes=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());return [...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');}
  function encode(bytes){let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);}
  function decode(text){const value=atob(text),bytes=new Uint8Array(value.length);for(let i=0;i<value.length;i++)bytes[i]=value.charCodeAt(i);return bytes;}
  async function capture(saved,records,extra={},progress=()=>{}){
    if(!saved?.project)throw new Error('No project is available to save.');const {project,assets}=saved,images=[],metadata=[],seen=new Set(),pictureKeys=new Set([...project.images,...project.backgrounds].map(item=>item.assetKey));let index=0;
    for(const key of pictureKeys){const file=assets.get(key);if(!file)throw new Error('A project image is unavailable.');progress(++index,pictureKeys.size);images.push({key,name:file.name,size:file.size,type:file.type,lastModified:file.lastModified,sha256:await sha256(file)});}
    const keys=[];for(const source of project.sources)for(const sidecar of source.sidecars)keys.push(sidecar.assetKey);if(project.cjob)keys.push(project.cjob.assetKey);
    for(const key of keys){if(seen.has(key))continue;seen.add(key);const file=assets.get(key);if(!file)throw new Error('A project metadata file is unavailable.');metadata.push({key,name:file.name,type:file.type,lastModified:file.lastModified,base64:encode(new Uint8Array(await file.arrayBuffer()))});}
    const result={format:'microscopy-viewer-state',version:1,createdAt:new Date().toISOString(),project:structuredClone(project),images,metadata,records,extra};validate(result);return result;
  }
  function metadataFile(item){return new File([decode(item.base64)],item.name,{type:item.type||'',lastModified:Number.isFinite(item.lastModified)?item.lastModified:0});}
  return {validate,rekey,sha256,capture,metadataFile};
});

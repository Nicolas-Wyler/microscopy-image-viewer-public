/* Per-image Leica objective magnification; uncertain matches stay blank. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SidecarMagnification=api;})(globalThis,function(){
  'use strict';
  function readMagnification(text){
    const values=new Set();
    for(const match of text.matchAll(/<ATLCameraSettingDefinition\b([^>]*)>/gi)) {
      const attribute=match[1].match(/(?:^|\s)Magnification\s*=\s*["']([^"']+)["']/i);
      if(!attribute)continue;
      const number=Number(attribute[1]);
      if(Number.isFinite(number) && number>0)values.add(String(number));
    }
    return values.size===1?[...values][0]:'';
  }
  async function findMagnifications(images, sidecars){
    const map=new Map();
    for(const sidecar of sidecars){
      const basename=sidecar.path.split('/').pop().replace(/\.xlif$/i,'').toLowerCase();
      if(!map.has(basename))map.set(basename,[]);map.get(basename).push(sidecar.file);
    }
    return Promise.all(images.map(async image=>{
      const basename=image.path.split('/').pop().replace(/\.tiff?$/i,'').toLowerCase();
      const matches=map.get(basename) || [];
      if(matches.length!==1)return '';
      try{return readMagnification(await matches[0].text());}catch{return '';}
    }));
  }
  return {readMagnification,findMagnifications};
});

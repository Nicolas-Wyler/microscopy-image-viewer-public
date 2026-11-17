/* Ordered list of selected file references. Never writes to the source files. */
(function (root, factory) {
  const api=factory();
  if (typeof module==='object' && module.exports) module.exports=api;
  else root.ImageTableState=api;
})(globalThis, function () {
  'use strict';
  function doseSeries(items,ids,start,multiplier){
    if(!(Number.isFinite(start)&&start>=0&&Number.isFinite(multiplier)&&multiplier>=0))throw new Error('Enter a non-negative starting dose and multiplier.');
    const selected=new Set(ids),out=[];let value=start;
    for(const item of items){if(!selected.has(item.id))continue;
      if(!Number.isFinite(value))throw new Error('The dose series exceeds the supported numeric range.');
      out.push([item.id,String(Number(value.toPrecision(12)))]);value*=multiplier;
    }
    return out;
  }
  function createImageList(entries, options={}) {
    const list=[...entries];
    if(!options.preserveOrder)list.sort((a,b)=>a.file.name.localeCompare(b.file.name, undefined, {numeric:true,sensitivity:'base'}));
    for (const item of list) if (item.name == null) item.name=item.file.name.replace(/\.tiff?$/i,'');
    return {
      items:()=>list.slice(),
      snapshot:()=>list.map(item=>({...item})),
      append(entries) {
        const added=[...entries].sort((a,b)=>a.file.name.localeCompare(b.file.name, undefined, {numeric:true,sensitivity:'base'}));
        for(const item of added) if(item.name==null) item.name=item.file.name.replace(/\.tiff?$/i,'');
        list.push(...added);
      },
      restore(snapshot) {list.splice(0,list.length,...snapshot.map(item=>({...item})));},
      moveMany(ids,targetId,after) {
        const selected=new Set(ids);
        if(selected.has(targetId) || !list.some(item=>item.id===targetId)) return;
        const moved=list.filter(item=>selected.has(item.id));
        if(!moved.length)return;
        const remaining=list.filter(item=>!selected.has(item.id));
        const pos=remaining.findIndex(item=>item.id===targetId);
        remaining.splice(pos+(after?1:0),0,...moved);
        list.splice(0,list.length,...remaining);
      },
      sort(compare) { list.sort(compare); },
      setName(id,name) { const item=list.find(x=>x.id===id); if(item) item.name=String(name); },
      setDose(id,value) { const item=list.find(x=>x.id===id); if(item) item.exposureDose=String(value); },
      setZone(id,value) { const item=list.find(x=>x.id===id); if(item) item.zoneId=value || ''; },
      setBackground(id,value) { const item=list.find(x=>x.id===id); if(item) item.backgroundId=value || ''; },
      setMagnification(id,value) { const item=list.find(x=>x.id===id); if(item) item.magnification=String(value); },
      move(id,targetId,after) {
        const from=list.findIndex(x=>x.id===id), target=list.findIndex(x=>x.id===targetId);
        if(from<0 || target<0 || from===target)return;
        const [item]=list.splice(from,1), dest=list.findIndex(x=>x.id===targetId);
        list.splice(dest+(after?1:0),0,item);
      },
      remove(id) {const n=list.findIndex(x=>x.id===id); return n<0?null:list.splice(n,1)[0];}
    };
  }
  return {createImageList,doseSeries};
});

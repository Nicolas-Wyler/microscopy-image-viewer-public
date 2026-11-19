/* Image list and full-resolution inspector for the local setup workflow. */
'use strict';
(() => {
  const body=document.getElementById('image-table-body');
  const count=document.getElementById('loaded-file-count');
  const announce=document.getElementById('image-list-announcement');
  const dialog=document.getElementById('image-inspector');
  const title=document.getElementById('inspector-title');
  const meta=document.getElementById('inspector-meta');
  const viewport=document.getElementById('inspector-viewport');
  const canvas=document.getElementById('inspector-canvas');
  const status=document.getElementById('inspector-status');
  const fit=document.getElementById('inspector-fit');
  const native=document.getElementById('inspector-native');
  const closeButton=document.getElementById('inspector-close');
  let list=null, onUpdate=()=>{}, getBackgrounds=()=>[], getZones=()=>[], getCurrentCjob=()=>null, getExtras=()=>null, restoreExtras=()=>{}, onSelectionChange=()=>{}, epoch=0, inspectorEpoch=0, returnFocus=null;
  const thumbs=new Map(), selected=new Set(), undoStack=[], redoStack=[];
  let anchor=null, editingSnapshot=null, dragIds=[], sortKey='', sortDirection='';
  const sortButtons=[...document.querySelectorAll('.image-sort')],collator=new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});
  const emptyMessage=document.createElement('p');
  emptyMessage.textContent='No images yet. Drop TIFF images or a folder here, or use Add images or folder.';
  emptyMessage.className='image-empty'; emptyMessage.hidden=true;
  document.querySelector('.image-list-frame').after(emptyMessage);
  function snapshot(){return {items:list.snapshot(),selected:[...selected],anchor,extras:getExtras()};}
  function pushHistory(before){undoStack.push(before);if(undoStack.length>100)undoStack.shift();redoStack.length=0;}
  function clearSort(){sortKey='';sortDirection='';for(const button of sortButtons){button.parentElement.removeAttribute('aria-sort');button.classList.remove('is-sorted','is-ascending','is-descending');}}
  function restore(from,to){
    if(!from.length)return;
    to.push(snapshot());const state=from.pop();list.restore(state.items);restoreExtras(state.extras);
    selected.clear();for(const id of state.selected)selected.add(id);anchor=state.anchor;
    clearSort();sync();render();generateThumbnails(++epoch);
  }
  function paintSelection(){
    for(const row of body.querySelectorAll('tr[data-image-id]')){
      const active=selected.has(row.dataset.imageId);row.classList.toggle('is-selected',active);row.setAttribute('aria-selected',String(active));
    }
    onSelectionChange(selected.size);
  }
  function selectRow(id,event){
    const items=list.items(), idx=items.findIndex(item=>item.id===id);if(idx<0)return;
    if(event.shiftKey && anchor!==null){
      const start=items.findIndex(item=>item.id===anchor);
      if(!event.metaKey && !event.ctrlKey)selected.clear();
      for(let i=Math.min(start<0?idx:start,idx);i<=Math.max(start<0?idx:start,idx);i++)selected.add(items[i].id);
    } else if(event.metaKey || event.ctrlKey){
      if(selected.has(id))selected.delete(id);else selected.add(id);anchor=id;
    } else {selected.clear();selected.add(id);anchor=id;}
    paintSelection();
  }
  function setZoom(mode) {
    canvas.classList.toggle('is-fit',mode==='fit');
    fit.setAttribute('aria-pressed',String(mode==='fit'));
    native.setAttribute('aria-pressed',String(mode==='native'));
  }
  function closeInspector() {
    inspectorEpoch++; dialog.hidden=true; canvas.hidden=true;canvas.width=1;canvas.height=1;
    if(returnFocus?.isConnected)returnFocus.focus(); returnFocus=null;
  }
  function reset() { clearSort();epoch++;closeInspector(); list=null;thumbs.clear();body.replaceChildren();selected.clear();undoStack.length=0;redoStack.length=0;anchor=null;editingSnapshot=null;emptyMessage.hidden=true; }
  function sync() { const current=list.items();count.textContent=`${current.length} ${current.length===1?'image':'images'}`;onUpdate(current); }
  function announceMove(item) {const i=list.items().findIndex(x=>x.id===item.id);announce.textContent=`${item.file.name} moved to position ${i+1}.`;}
  function reorder(source,target,after) {
    const item=list.items().find(x=>x.id===source);if(!item)return;
    const ids=dragIds.length ? dragIds : [source], before=snapshot();
    list.moveMany(ids,target,after);
    if(list.items().map(x=>x.id).join('\0')===before.items.map(x=>x.id).join('\0'))return;
    pushHistory(before);clearSort();sync();render();announceMove(item);
  }
  function removeMany(ids) {
    const before=snapshot(), removed=ids.map(id=>list.remove(id)).filter(Boolean);
    if(!removed.length)return;
    pushHistory(before);clearSort();for(const item of removed)selected.delete(item.id);
    if(!selected.has(anchor))anchor=null;
    sync();render();announce.textContent=`${removed.length} ${removed.length===1?'image':'images'} removed from the list.`;
  }
  function remove(id) {removeMany([id]);}
  async function inspect(item, button, isValid=()=>list?.items().some(x=>x.id===item.id)) {
    const token=++inspectorEpoch; returnFocus=button;dialog.hidden=false;title.textContent=item.file.name;
    meta.textContent='';status.textContent='Loading image…';status.hidden=false;canvas.hidden=true;canvas.width=1;canvas.height=1;
    setZoom('fit');closeButton.focus();
    try {
      const decoded=await window.TiffImage.decode(item.file);
      if(token!==inspectorEpoch || dialog.hidden || !isValid())return;
      canvas.width=decoded.width;canvas.height=decoded.height;
      canvas.getContext('2d').putImageData(new ImageData(decoded.rgba,decoded.width,decoded.height),0,0);
      meta.textContent=`${decoded.width} × ${decoded.height} pixels`;status.hidden=true;canvas.hidden=false;
    } catch(error) {
      if(token!==inspectorEpoch || dialog.hidden)return;
      status.textContent=`Could not display this TIFF: ${error.message || 'unsupported image format'}.`;
    }
  }
  function button(label,text,action) {const b=document.createElement('button');b.type='button';b.className='image-row-action';b.setAttribute('aria-label',label);b.textContent=text;b.addEventListener('click',action);return b;}
  function render() {
    const items=list.items();body.replaceChildren();emptyMessage.hidden=items.length>0;
    items.forEach((item,index)=>{
      const row=document.createElement('tr');row.draggable=true;row.dataset.imageId=item.id;
      row.classList.toggle('is-selected',selected.has(item.id));row.setAttribute('aria-selected',String(selected.has(item.id)));
      row.addEventListener('click',event=>{if(event.target.closest('input,button,select'))return;selectRow(item.id,event);});
      row.addEventListener('dragstart',event=>{if(event.target.closest('input,button,select')){event.preventDefault();return;}if(!selected.has(item.id)){selected.clear();selected.add(item.id);anchor=item.id;paintSelection();} dragIds=list.items().filter(x=>selected.has(x.id)).map(x=>x.id); event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',item.id);row.classList.add('is-dragged');});
      row.addEventListener('dragend',()=>{row.classList.remove('is-dragged');dragIds=[];for(const x of body.querySelectorAll('.drop-before,.drop-after'))x.classList.remove('drop-before','drop-after');});
      row.addEventListener('dragover',event=>{if(Array.from(event.dataTransfer.types).includes('Files'))return;event.preventDefault();event.dataTransfer.dropEffect='move';const after=event.clientY>row.getBoundingClientRect().top+row.getBoundingClientRect().height/2;row.classList.toggle('drop-after',after);row.classList.toggle('drop-before',!after);});
      row.addEventListener('dragleave',()=>row.classList.remove('drop-before','drop-after'));
      row.addEventListener('drop',event=>{if(Array.from(event.dataTransfer.types).includes('Files'))return;event.preventDefault();event.stopPropagation();const after=event.clientY>row.getBoundingClientRect().top+row.getBoundingClientRect().height/2;reorder(event.dataTransfer.getData('text/plain'),item.id,after);});
      const position=document.createElement('td');position.className='image-number';
      const n=document.createElement('span');n.textContent=String(index+1);position.append(n);
      const thumbCell=document.createElement('td');thumbCell.className='image-thumb-cell';const thumb=document.createElement('button');thumb.type='button';thumb.className='image-thumb';thumb.title='Inspect image';thumb.setAttribute('aria-label',`Inspect ${item.file.name}`);
      const cached=thumbs.get(item.id);if(cached?.url){const img=document.createElement('img');img.src=cached.url;img.alt='';thumb.append(img);}else{thumb.textContent=cached?.error?'Unavailable':'Loading…';}
      thumb.addEventListener('click',event=>{if(event.metaKey||event.ctrlKey||event.shiftKey){selectRow(item.id,event);return;}inspect(item,thumb);});thumbCell.append(thumb);
      const filename=document.createElement('td');filename.className='image-filename';filename.textContent=item.file.name;filename.title=item.file.name;
      const nameCell=document.createElement('td');nameCell.className='image-name';
      const nameInput=document.createElement('input');nameInput.type='text';nameInput.value=item.name;nameInput.setAttribute('aria-label',`Name for ${item.file.name}`);
      nameInput.addEventListener('focus',()=>{editingSnapshot=snapshot();});
      nameInput.addEventListener('input',()=>{clearSort();list.setName(item.id,nameInput.value);sync();});
      nameInput.addEventListener('blur',()=>{if(editingSnapshot){const prev=editingSnapshot.items.find(x=>x.id===item.id);if(prev && prev.name!==nameInput.value)pushHistory(editingSnapshot);editingSnapshot=null;}});
      nameCell.append(nameInput);
      const doseCell=document.createElement('td');doseCell.className='image-dose';
      const doseInput=document.createElement('input');doseInput.type='number';doseInput.min='0';doseInput.step='any';doseInput.placeholder='None';doseInput.value=item.exposureDose ?? '';doseInput.setAttribute('aria-label',`Exposure dose for ${item.file.name} (mJ/cm²)`);
      doseInput.addEventListener('focus',()=>{editingSnapshot=snapshot();});
      doseInput.addEventListener('input',()=>{clearSort();list.setDose(item.id,doseInput.value);sync();});
      doseInput.addEventListener('blur',()=>{if(editingSnapshot){const prev=editingSnapshot.items.find(x=>x.id===item.id);if(prev && (prev.exposureDose ?? '')!==doseInput.value)pushHistory(editingSnapshot);editingSnapshot=null;}});
      doseCell.append(doseInput);
      const backgroundCell=document.createElement('td');backgroundCell.className='image-background';
      const backgroundSelect=document.createElement('select');backgroundSelect.setAttribute('aria-label',`Background for ${item.file.name}`);
      backgroundSelect.add(new Option('None',''));
      for(const background of getBackgrounds())backgroundSelect.add(new Option(background.name,background.id));
      backgroundSelect.value=item.backgroundId || '';
      backgroundSelect.addEventListener('change',()=>assignBackground([item.id],backgroundSelect.value));
      backgroundCell.append(backgroundSelect);
      const zoneCell=document.createElement('td');zoneCell.className='image-zone';
      const zoneSelect=document.createElement('select');zoneSelect.setAttribute('aria-label',`Zone for ${item.file.name}`);zoneSelect.add(new Option('Everything',''));
      for(const zone of getZones()){
        const relevant=zone.cjobId===getCurrentCjob();
        if(relevant || zone.id===item.zoneId){const option=new Option(relevant?zone.name:`${zone.name} (other CJOB)`,zone.id);option.disabled=!relevant;zoneSelect.add(option);}
      }
      zoneSelect.value=item.zoneId || '';zoneSelect.addEventListener('change',()=>assignZone([item.id],zoneSelect.value));zoneCell.append(zoneSelect);
      const actions=document.createElement('td');actions.className='image-actions';
      const trash=button(`Remove ${item.file.name}`,'',()=>remove(item.id));trash.classList.add('image-delete');trash.innerHTML='<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';actions.append(trash);
      row.append(position,thumbCell,filename,nameCell,doseCell,backgroundCell,zoneCell,actions);body.append(row);
    });
    onSelectionChange(selected.size);
  }
  async function generateThumbnails(token) {
    for(const item of list.items()) {
      if(token!==epoch)return;
      if(thumbs.has(item.id))continue;
      try {
        const data=await window.TiffImage.decode(item.file);
        if(token!==epoch)return;
        if(!list.items().some(x=>x.id===item.id))continue;
        const full=document.createElement('canvas');full.width=data.width;full.height=data.height;
        full.getContext('2d').putImageData(new ImageData(data.rgba,data.width,data.height),0,0);
        const small=document.createElement('canvas'),ratio=Math.min(1,144/data.width,96/data.height);
        small.width=Math.max(1,Math.round(data.width*ratio));small.height=Math.max(1,Math.round(data.height*ratio));
        small.getContext('2d').drawImage(full,0,0,small.width,small.height);full.width=1;full.height=1;
        thumbs.set(item.id,{url:small.toDataURL('image/png')});small.width=1;small.height=1;
      } catch(error) { if(token!==epoch)return;thumbs.set(item.id,{error:true}); }
      const button=body.querySelector(`[data-image-id="${item.id}"] .image-thumb`), cached=thumbs.get(item.id);
      if(button && cached) {
        button.replaceChildren();
        if(cached.url){const img=document.createElement('img');img.src=cached.url;img.alt='';button.append(img);}
        else button.textContent='Unavailable';
      }
      await new Promise(resolve=>setTimeout(resolve,0));
    }
  }
  function start(items, options={}) {
    reset();onUpdate=options.onUpdate||(()=>{});getBackgrounds=options.getBackgrounds||(()=>[]);getZones=options.getZones||(()=>[]);getCurrentCjob=options.getCurrentCjob||(()=>null);getExtras=options.getExtras||(()=>null);restoreExtras=options.restoreExtras||(()=>{});onSelectionChange=options.onSelectionChange||(()=>{});
    list=window.ImageTableState.createImageList(items, {preserveOrder:options.preserveOrder});sync();render();generateThumbnails(epoch);
  }
  function add(items) {
    if(!list || !items.length)return;
    const before=snapshot();list.append(items);pushHistory(before);clearSort();sync();render();generateThumbnails(++epoch);
    announce.textContent=`${items.length} ${items.length===1?'image':'images'} added.`;
  }
  function mutateProject(fn) {
    if(!list)return;
    const before=snapshot();fn(list);pushHistory(before);clearSort();sync();render();
  }
  function assignDose(ids,value) {
    if(!list || !ids.length)return;
    if(!list.items().some(item=>ids.includes(item.id) && (item.exposureDose ?? '')!==value))return;
    mutateProject(state=>{for(const id of ids)state.setDose(id,value);});
  }
  function assignDoseSeries(ids,start,multiplier) {
    if(!list || !ids.length)return;
    const series=window.ImageTableState.doseSeries(list.items(),ids,start,multiplier);
    if(!series.some(([id,value])=>list.items().some(item=>item.id===id&&(item.exposureDose??'')!==value)))return;
    mutateProject(state=>{for(const [id,value] of series)state.setDose(id,value);});
  }
  function assignBackground(ids,backgroundId) {
    if(!list || !ids.length)return;
    const changed=list.items().some(item=>ids.includes(item.id) && (item.backgroundId || '')!==backgroundId);
    if(!changed)return;
    mutateProject(state=>{for(const id of ids)state.setBackground(id,backgroundId);});
  }
  function assignZone(ids,zoneId) {
    if(!list || !ids.length)return;
    if(!list.items().some(item=>ids.includes(item.id) && (item.zoneId || '')!==zoneId))return;
    mutateProject(state=>{for(const id of ids)state.setZone(id,zoneId);});
  }
  function sortImages(key){
    if(!list)return;
    const direction=sortKey===key&&sortDirection==='ascending'?'descending':'ascending';
    const backgrounds=new Map(getBackgrounds().map(item=>[item.id,item.name]));
    const zones=new Map(getZones().map(item=>[item.id,item.name+(item.cjobId===getCurrentCjob()?'':' (other CJOB)')]));
    const value=item=>key==='filename'?item.file.name:key==='name'?item.name:key==='dose'?item.exposureDose:key==='background'?(backgrounds.get(item.backgroundId)||'None'):(zones.get(item.zoneId)||'Everything');
    const before=snapshot(),sign=direction==='ascending'?1:-1;
    list.sort((a,b)=>{const x=value(a),y=value(b);if(key==='dose'){const missingX=x==null||String(x).trim()===''||!Number.isFinite(Number(x)),missingY=y==null||String(y).trim()===''||!Number.isFinite(Number(y));if(missingX||missingY)return missingX===missingY?0:missingX?1:-1;return sign*(Number(x)-Number(y));}return sign*collator.compare(String(x??''),String(y??''));});
    if(list.items().some((item,index)=>item.id!==before.items[index].id))pushHistory(before);
    clearSort();sortKey=key;sortDirection=direction;const active=sortButtons.find(button=>button.dataset.sort===key);active.classList.add('is-sorted',`is-${direction}`);active.parentElement.setAttribute('aria-sort',direction);
    sync();render();announce.textContent=`Images sorted by ${active.getAttribute('aria-label').replace('Sort by ','')}, ${direction}.`;
  }
  for(const button of sortButtons)button.addEventListener('click',()=>sortImages(button.dataset.sort));
  document.addEventListener('pointerdown',event=>{
    const target=event.target;
    if(!selected.size || !dialog.hidden || !(target instanceof Element))return;
    // Sidebar controls act on the highlighted rows; only a click on unused space clears them.
    if(target.closest('.image-list-frame, .image-inspector, .cjob-dialog, .mask-editor, button, input, select, textarea, summary, label, a'))return;
    selected.clear();anchor=null;paintSelection();
  });
  document.addEventListener('keydown',event=>{
    if(!list || !document.getElementById('loader-success') || document.getElementById('loader-success').hidden || !dialog.hidden || document.getElementById('cjob-dialog').open || document.getElementById('mask-editor').open)return;
    const target=event.target;
    if(target instanceof Element && (target.matches('input,textarea,select') || target.isContentEditable))return;
    const key=event.key.toLowerCase(), command=event.metaKey||event.ctrlKey;
    if(command && key==='a'){event.preventDefault();selected.clear();for(const item of list.items())selected.add(item.id);anchor=list.items()[0]?.id ?? null;paintSelection();}
    else if(command && key==='z'){event.preventDefault();if(event.shiftKey)restore(redoStack,undoStack);else restore(undoStack,redoStack);}
    else if((key==='backspace'||key==='delete') && selected.size){event.preventDefault();removeMany([...selected]);}
    else if(key==='escape' && selected.size){selected.clear();anchor=null;paintSelection();}
  },true);
  fit.addEventListener('click',()=>setZoom('fit'));native.addEventListener('click',()=>setZoom('native'));closeButton.addEventListener('click',closeInspector);
  dialog.addEventListener('click',event=>{if(event.target===dialog)closeInspector();});
  dialog.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();closeInspector();}});
  window.ImageTable={start,reset,add,mutateProject,assignDose,assignDoseSeries,assignBackground,assignZone,refresh:()=>{if(list)render();},clearThumbnails:()=>thumbs.clear(),refreshThumbnails:()=>{if(list){thumbs.clear();render();generateThumbnails(++epoch);}},getSelectedIds:()=>[...selected],inspectBackground:(background,button)=>inspect(background,button,()=>getBackgrounds().some(item=>item.id===background.id))};
})();

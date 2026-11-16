/* Local, editable scratch designs and a read-only view of imported CJOBs. */
'use strict';
(() => {
  const edit=document.getElementById('mask-edit'),dialog=document.getElementById('mask-editor'),close=document.getElementById('mask-editor-close');
  const name=document.getElementById('mask-design-name'),subtitle=document.getElementById('mask-editor-subtitle'),notice=document.getElementById('mask-editor-notice');
  const body=document.getElementById('mask-editor-body'),add=document.getElementById('mask-add-row'),removeCjob=document.getElementById('mask-remove-cjob'),save=document.getElementById('mask-editor-save');
  const preview=document.getElementById('mask-preview'),empty=document.getElementById('mask-preview-empty'),error=document.getElementById('mask-editor-error');
  const sadp=document.getElementById('mask-sadp');
  const fields=['pitch','x','y','width','height','dose'];let api,ready=false,draft={name:'New Mask Design',rows:[]},imported=false;
  function blankRow(){return {id:'grating-'+crypto.randomUUID(),pitch:'',x:'',y:'',width:'',height:'',dose:''};}
  function fromGrating(g){return {id:g.spotBaseId||'grating-'+crypto.randomUUID(),pitch:String(g.pitch??''),x:String(g.x??''),y:String(g.y??''),width:String(g.width??''),height:String(g.height??''),dose:String(g.dose??'')};}
  function persistDraft(){if(imported)api.onImportedDraft(structuredClone(draft));else api.onDraft(structuredClone(draft));}
  function load(){
    const source=api.getImported();imported=Boolean(source);error.textContent='';
    if(imported){const stored=api.getImportedDraft();draft={name:source.name.replace(/\.cjob$/i,''),rows:api.getImportedRows().map(row=>{const previous=stored?.rows?.find(item=>item.id===row.id),values={...row};for(const field of fields){const value=previous && row.editableFields.includes(field)?previous[field]:row[field];values[field]=typeof value==='number'&&Number.isFinite(value)?String(Number(value.toFixed(6))):String(value??'');}return values;})};}
    else {const stored=api.getDraft(),manual=api.getManual();draft=stored?structuredClone(stored):{name:manual?.name||'New Mask Design',rows:(manual?.model?.windows[0]?.gratings||[]).map(fromGrating)};}
    name.value=draft.name;name.disabled=imported;removeCjob.hidden=!imported;add.disabled=imported;save.disabled=false;save.textContent=imported?'Save missing values':'Save design';
    sadp.checked=(!imported && draft.sadp!=null)?draft.sadp:api.getSadp();api.prepareGeometry();
    subtitle.textContent=imported?source.name:'Scratch design';
    notice.textContent=imported?'Values supplied by the CJOB are locked. Fill in missing values below; matching patterns share their dimensions and pitch.':'Enter one row per vertical grating. Your draft is saved locally as you edit.';
    renderRows();drawPreview();
  }
  function renderRows(){
    body.replaceChildren();
    for(const row of draft.rows){
      const tr=document.createElement('tr');tr.dataset.id=row.id;
      for(const field of fields){const td=document.createElement('td'),input=document.createElement('input');input.type='number';input.step='any';input.dataset.field=field;input.value=row[field]??'';input.disabled=imported&&!row.editableFields.includes(field);input.setAttribute('aria-label',`${field} for grating`);
        input.addEventListener('input',()=>{row[field]=input.value;if(imported&&['pitch','width','height'].includes(field)){for(const other of draft.rows)if(other!==row&&other.pattern===row.pattern&&other.editableFields.includes(field)){other[field]=input.value;const target=[...body.rows].find(tr=>tr.dataset.id===other.id)?.querySelector(`[data-field="${field}"]`);if(target)target.value=input.value;}}error.textContent='';persistDraft();drawPreview();});td.append(input);tr.append(td);}
      const td=document.createElement('td'),button=document.createElement('button');button.type='button';button.className='mask-delete';button.disabled=imported;button.setAttribute('aria-label','Delete grating');button.title='Delete grating';
      button.innerHTML='<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
      button.addEventListener('click',()=>{draft.rows=draft.rows.filter(item=>item.id!==row.id);persistDraft();renderRows();drawPreview();});td.append(button);tr.append(td);body.append(tr);
    }
  }
  function numeric(row){
    if(['pitch','x','y','width','height'].some(field=>String(row[field]??'').trim()===''))return null;
    const n=Object.fromEntries(fields.filter(f=>f!=='dose').map(f=>[f,Number(row[f])]));
    if(Object.values(n).some(v=>!Number.isFinite(v))||n.pitch<=0||n.width<=0||n.height<=0)return null;
    if(String(row.dose??'').trim()!==''&&(!Number.isFinite(Number(row.dose))||Number(row.dose)<0))return null;
    return n;
  }
  function drawPreview(){
    const previewGeometry=row=>{const keys=['x','y','width','height'];if(keys.some(field=>String(row[field]??'').trim()===''))return null;const n=Object.fromEntries(keys.map(field=>[field,Number(row[field])]));if(Object.values(n).some(v=>!Number.isFinite(v))||n.width<=0||n.height<=0)return null;return {...n,pitch:row.pitch||'Unknown'};};
    const valid=draft.rows.map(row=>({row,n:previewGeometry(row)})).filter(item=>item.n),ns='http://www.w3.org/2000/svg',W=900,H=240,margin=18;
    preview.replaceChildren();preview.setAttribute('viewBox',`0 0 ${W} ${H}`);empty.hidden=Boolean(valid.length);
    if(!valid.length)return;
    const minX=Math.min(...valid.map(({n})=>n.x-n.width/2)),maxX=Math.max(...valid.map(({n})=>n.x+n.width/2));
    const minY=Math.min(...valid.map(({n})=>n.y-n.height/2)),maxY=Math.max(...valid.map(({n})=>n.y+n.height/2));
    const spanX=Math.max(maxX-minX,1)*1.12,spanY=Math.max(maxY-minY,1)*1.12,scale=Math.min((W-2*margin)/spanX,(H-2*margin)/spanY),cx=(minX+maxX)/2,cy=(minY+maxY)/2;
    const defs=document.createElementNS(ns,'defs'),pattern=document.createElementNS(ns,'pattern');pattern.setAttribute('id','mask-preview-lines');pattern.setAttribute('width','7');pattern.setAttribute('height','7');pattern.setAttribute('patternUnits','userSpaceOnUse');const line=document.createElementNS(ns,'path');line.setAttribute('d','M 1 0 V 7');line.setAttribute('stroke','#8aaf96');line.setAttribute('stroke-opacity','.45');line.setAttribute('stroke-width','1');pattern.append(line);defs.append(pattern);preview.append(defs);
    for(const {n} of valid){const rect=document.createElementNS(ns,'rect');for(const [key,value] of Object.entries({x:W/2+(n.x-cx-n.width/2)*scale,y:H/2-(n.y-cy+n.height/2)*scale,width:n.width*scale,height:n.height*scale,fill:'url(#mask-preview-lines)',stroke:'#d8eb87','stroke-width':1.5,'data-grating':'true','data-x':n.x,'data-y':n.y}))rect.setAttribute(key,String(value));const title=document.createElementNS(ns,'title');title.textContent=`${n.pitch} nm · (${n.x}, ${n.y}) µm · ${n.width} × ${n.height} µm`;rect.append(title);preview.append(rect);}
  }
  edit.addEventListener('click',()=>{load();dialog.showModal();});close.addEventListener('click',()=>dialog.close());dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
  sadp.addEventListener('change',()=>{if(!imported){draft.sadp=sadp.checked;persistDraft();}api.setSadp(sadp.checked);});
  name.addEventListener('input',()=>{draft.name=name.value;error.textContent='';persistDraft();});
  add.addEventListener('click',()=>{if(imported)return;draft.rows.push(blankRow());persistDraft();renderRows();drawPreview();body.lastElementChild?.querySelector('input')?.focus();});
  removeCjob.addEventListener('click',()=>{api.onRemoveCjob();load();});
  save.addEventListener('click',()=>{if(imported){for(const row of draft.rows)for(const field of row.editableFields){const value=String(row[field]??'').trim();if(value!==''&&(!Number.isFinite(Number(value))||(field==='dose'?Number(value)<0:Number(value)<=0))){error.textContent='Enter positive pitch and dimensions and a non-negative electron dose.';return;}}api.onSaveImported(structuredClone(draft.rows));dialog.close();return;}const title=draft.name.trim();if(!title){error.textContent='Enter a design name.';name.focus();return;}const bad=draft.rows.findIndex(row=>!numeric(row));if(bad>=0){error.textContent=`Complete valid dimensions and pitch for grating ${bad+1}; electron dose may be left blank.`;return;}api.onSave(title,structuredClone(draft.rows),sadp.checked);dialog.close();});
  window.MaskDesignEditor={configure(options){api=options;},setReady(value){ready=value;edit.disabled=!ready;}};
})();

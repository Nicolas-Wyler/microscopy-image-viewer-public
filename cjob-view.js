'use strict';
(() => {
  const input=document.getElementById('cjob-input'),load=document.getElementById('cjob-load'),view=document.getElementById('cjob-view');
  const filename=document.getElementById('cjob-filename'),status=document.getElementById('cjob-status');
  const dialog=document.getElementById('cjob-dialog'),close=document.getElementById('cjob-close');
  const plots=document.getElementById('cjob-plots'),notes=document.getElementById('cjob-notes'),details=document.getElementById('cjob-details');
  const parameters=document.getElementById('cjob-parameters'),addZone=document.getElementById('cjob-add-zone'),selectionCount=document.getElementById('cjob-selection-count');
  const innerSwitch=document.getElementById('cjob-inner-together');
  const zoneForm=document.getElementById('cjob-zone-form'),zoneName=document.getElementById('cjob-zone-name'),zoneError=document.getElementById('cjob-zone-error');
  const geometryEditor=document.getElementById('cjob-geometry-editor'),geometryForm=document.getElementById('cjob-geometry-form'),geometryError=document.getElementById('cjob-geometry-error');
  let getProject=()=>null,onChange=()=>{},onCreateZone=()=>{},onSetGeometry=()=>{},onUpdateZone=()=>{},onSetDefaultInner=()=>{},ready=false,loading=false;const selectedSpots=new Set();let innerPairs=[],anyInnerOverlap=false;
  // Apply this only to the exact documented CJOB bytes, never to an unrelated job.
  const knownGeometry={};
  function resolvedGrating(grating,project,spotId){
    const known=knownGeometry[project.cjob.fingerprint];
    const saved=project.cjobGeometry?.[project.cjob.fingerprint]?.[grating.name]||{};
    const pitch=grating.pitch ?? saved.pitch ?? null;
    const sadp=project.sadpByDesign?.[project.cjob.fingerprint] ?? Boolean(project.cjob.model.sadpDocumented);
    const factor=sadp?0.5:1;
    return {...grating,pitch,width:grating.width ?? known?.width ?? saved.width ?? null,height:grating.height ?? known?.height ?? saved.height ?? null,
      effectivePitch:pitch ? pitch*factor : saved.effectivePitch ?? null,orientation:grating.orientation ?? saved.orientation ?? null,
      dose:grating.dose ?? project.cjobDoseOverrides?.[project.cjob.fingerprint]?.[spotId] ?? null};
  }
  function geometryRows(project){
    const unique=new Map();for(const mask of project.cjob.model.windows)for(const grating of mask.gratings)if(!unique.has(grating.name))unique.set(grating.name,{base:grating,value:resolvedGrating(grating,project)});
    const body=geometryForm.querySelector('tbody');body.replaceChildren();
    for(const [name,entry] of unique){const {base,value:g}=entry,known=knownGeometry[project.cjob.fingerprint];const row=document.createElement('tr');row.dataset.pattern=name;const label=document.createElement('td');label.textContent=name;row.append(label);
      for(const field of ['width','height','effectivePitch']){const cell=document.createElement('td'),input=document.createElement('input');input.type='number';input.min='0.000001';input.step='any';input.dataset.field=field;input.disabled=field==='width'?Boolean(base.width||known?.width):field==='height'?Boolean(base.height||known?.height):Boolean(base.effectivePitch);input.setAttribute('aria-label',`${field} for ${name}`);input.value=g[field]??'';cell.append(input);row.append(cell);}
      const cell=document.createElement('td'),select=document.createElement('select');select.dataset.field='orientation';select.setAttribute('aria-label',`Orientation for ${name}`);select.add(new Option('Unknown',''));select.add(new Option('Vertical','vertical'));select.add(new Option('Horizontal','horizontal'));select.value=g.orientation||'';select.disabled=Boolean(base.orientation);cell.append(select);row.append(cell);body.append(row);
    }
    return [...unique.values()].some(({value:g})=>!g.width||!g.height||!g.effectivePitch||!g.orientation);
  }
  geometryForm.addEventListener('submit',event=>{
    event.preventDefault();const result=Object.create(null);geometryError.textContent='';
    for(const row of geometryForm.querySelectorAll('tbody tr')){const value=field=>row.querySelector(`[data-field="${field}"]`).value.trim(),rawWidth=value('width'),rawHeight=value('height'),rawPitch=value('effectivePitch');
      if(Boolean(rawWidth)!==Boolean(rawHeight)||[rawWidth,rawHeight,rawPitch].some(x=>x!==''&&(!Number.isFinite(Number(x))||Number(x)<=0))){geometryError.textContent='Enter positive width and height together, and a positive pitch if provided.';return;}
      result[row.dataset.pattern]={width:rawWidth?Number(rawWidth):null,height:rawHeight?Number(rawHeight):null,effectivePitch:rawPitch?Number(rawPitch):null,orientation:value('orientation')||null};
    }
    onSetGeometry(result);update();geometryRows(getProject());
  });
  async function fingerprint(text){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');}
  function update(){const job=getProject()?.cjob;const warning=document.getElementById('cjob-warning');const missing=new Set();if(job?.model&&!job.manual){for(const row of editableRows()){for(const field of ['pitch','width','height','dose'])if(row[field]===''||row[field]==null)missing.add(field==='dose'?'electron dose':field);}for(const mask of job.model.windows)for(const raw of mask.gratings){const g=resolvedGrating(raw,getProject());if(!g.orientation)missing.add('orientation');if(!g.effectivePitch)missing.add('diffraction pitch');}}warning.textContent=missing.size?`Missing ${[...missing].join(', ')}. Add the missing values in Edit.`:'';load.disabled=!ready||loading;view.disabled=!ready||loading||!job?.model;filename.textContent=job?.name||'No CJOB loaded';if(job?.parseError)status.textContent=`Saved CJOB cannot be displayed: ${job.parseError}`;else if(status.textContent.startsWith('Saved CJOB cannot be displayed:'))status.textContent='';}
  load.addEventListener('click',()=>{input.value='';input.click();});
  input.addEventListener('change',async()=>{
    const file=input.files[0];if(!file)return;loading=true;update();status.textContent='Reading CJOB…';
    try {const content=await file.text(),model=window.CjobModel.parse(content),hash=await fingerprint(content),project=getProject(),prior=project?.cjob;const id=prior?.fingerprint===hash ? prior.id : project.zones.find(zone=>zone.cjobFingerprint===hash)?.cjobId || crypto.randomUUID();onChange({id,name:file.name,file,model,fingerprint:hash});status.textContent='';}
    catch(error){status.textContent=error.message||'Could not read this CJOB.';}
    finally{loading=false;update();}
  });
  function open(){
    const project=getProject(),job=project?.cjob;if(!job)return;
    document.getElementById('cjob-dialog-file').textContent=job.name;
    selectedSpots.clear();const zone=project.zones.find(item=>item.id===project.selectedZoneId && item.cjobId===job.id);if(zone)for(const id of zone.spotIds)selectedSpots.add(id);innerSwitch.checked=false;zoneForm.hidden=true;render();innerSwitch.checked=zone ? zone.innerSpotsTogether===true : (project.innerTogetherByDesign?.[job.fingerprint] ?? anyInnerOverlap);paintSpots();dialog.showModal();
  }
  view.addEventListener('click',open);close.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
  function selectedGroups(){return window.SpotGrouping.groups([...selectedSpots],innerPairs,innerSwitch.checked);}
  function pairFor(id){return innerSwitch.checked?innerPairs.find(pair=>pair.includes(id))||[id]:[id];}
  function expandSelection(){if(innerSwitch.checked)for(const pair of innerPairs)if(pair.some(id=>selectedSpots.has(id)))for(const id of pair)selectedSpots.add(id);}
  function paintSpots(){for(const rect of plots.querySelectorAll('rect[data-spot-id]')){const active=selectedSpots.has(rect.dataset.spotId),pair=innerPairs.find(p=>p.includes(rect.dataset.spotId));rect.classList.toggle('is-zone-selected',active);rect.setAttribute('aria-selected',String(active));if(pair&&innerSwitch.checked)rect.dataset.innerPair=pair.join('|');else delete rect.dataset.innerPair;}addZone.disabled=!selectedSpots.size;const count=selectedGroups().length;selectionCount.textContent=count?`${count} selected`:'Select spots to create a zone';}
  innerSwitch.addEventListener('change',()=>{expandSelection();paintSpots();const project=getProject(),zone=project.zones.find(item=>item.id===project.selectedZoneId&&item.cjobId===project.cjob.id);if(zone){const saved=new Set(zone.spotIds);if(innerSwitch.checked)for(const pair of innerPairs)if(pair.some(id=>saved.has(id)))for(const id of pair)saved.add(id);const ids=[...saved];onUpdateZone(zone.id,innerSwitch.checked,ids,window.SpotGrouping.groups(ids,innerPairs,innerSwitch.checked));}else onSetDefaultInner(innerSwitch.checked);});
  addZone.addEventListener('click',()=>{zoneForm.hidden=false;zoneName.value='';zoneError.textContent='';zoneName.focus();});
  document.getElementById('cjob-zone-cancel').addEventListener('click',()=>{zoneForm.hidden=true;zoneError.textContent='';addZone.focus();});
  zoneForm.addEventListener('submit',event=>{
    event.preventDefault();const name=zoneName.value.trim(),project=getProject();
    if(!name){zoneError.textContent='Enter a zone name.';return;}
    if(name.toLocaleLowerCase()==='everything'||project.zones.some(zone=>zone.cjobId===project.cjob.id && zone.name.toLocaleLowerCase()===name.toLocaleLowerCase())){zoneError.textContent='Choose a different name.';return;}
    if(!selectedSpots.size){zoneError.textContent='Select at least one spot.';return;}
    onCreateZone(name,[...selectedSpots],innerSwitch.checked,selectedGroups());zoneForm.hidden=true;zoneError.textContent='';addZone.focus();
  });
  dialog.addEventListener('keydown',event=>{
    const target=event.target;if(target instanceof Element && (target.matches('input,textarea,select')||target.isContentEditable))return;
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='a'){event.preventDefault();event.stopPropagation();selectedSpots.clear();for(const rect of plots.querySelectorAll('rect[data-spot-id]'))selectedSpots.add(rect.dataset.spotId);paintSpots();}
    else if(event.key==='Escape' && selectedSpots.size){event.preventDefault();event.stopPropagation();selectedSpots.clear();paintSpots();}
  });
  function render(){
    const project=getProject(),model=project.cjob.model;
    const wavelength=window.CjobModel.quantity(project.wavelength,'wavelength'),gap=window.CjobModel.quantity(project.gap,'gap');
    parameters.textContent=wavelength&&gap?`λ ${wavelength} nm · gap ${gap} µm`:'Enter a wavelength and gap to show predicted spots';
    // Coalesce geometrically identical windows; different layouts remain visible.
    const groups=new Map();
    for(const mask of model.windows){
      const signature=JSON.stringify(mask.gratings.map(g=>[g.name,g.x.toFixed(6),g.y.toFixed(6),g.width,g.height,g.effectivePitch,g.orientation,g.dose]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
      if(!groups.has(signature))groups.set(signature,{mask,names:[]});groups.get(signature).names.push(mask.name);
    }
    plots.replaceChildren();details.replaceChildren();innerPairs=[];anyInnerOverlap=false;const allRows=[],allMessages=new Set(model.warnings.filter(message=>!message.includes('are omitted')&&!message.includes('spots are omitted')&&!message.includes('footprints are omitted')));let missingOrders=0,missingSizes=false,missingPitch=false,missingOrientation=false;
    for(const {mask,names} of groups.values()){
      const windowIndex=model.windows.indexOf(mask);
      const shapes=[],rows=new Map();
      for(const [gratingIndex,sourceGrating] of mask.gratings.entries()){
        const grating=resolvedGrating(sourceGrating,project,sourceGrating.spotBaseId||`w${windowIndex}:g${gratingIndex}`);
        if(!grating.width||!grating.height)missingSizes=true;if(!grating.effectivePitch)missingPitch=true;if(!grating.orientation)missingOrientation=true;
        const spotId=kind=>`${grating.spotBaseId||`w${windowIndex}:g${gratingIndex}`}:${kind}`;
        const pitch=grating.effectivePitch,order=wavelength&&gap&&pitch&&grating.orientation?window.CjobModel.displacement(wavelength,gap,pitch):null;
        if(wavelength&&gap&&pitch&&grating.orientation&&order===null)missingOrders++;
        if(grating.width && grating.height){
          shapes.push({x:grating.x,y:grating.y,kind:'zero',id:spotId('zero'),grating});
          if(order!==null)for(const sign of [-1,1])shapes.push({x:grating.x+(grating.orientation==='vertical'?sign*order:0),y:grating.y+(grating.orientation==='horizontal'?sign*order:0),kind:sign<0?'minus':'plus',id:spotId(sign<0?'minus':'plus'),grating});
        }
        const rowkey=`${grating.pitch}:${pitch}:${grating.orientation}:${grating.width}:${grating.height}:${grating.dose}`;
        if(!rows.has(rowkey))rows.set(rowkey,{pitch:grating.pitch,effective:pitch,orientation:grating.orientation,width:grating.width,height:grating.height,dose:grating.dose,count:0,order});rows.get(rowkey).count++;
      }
      const gratings=shapes.filter(p=>p.kind==='zero').map(p=>({x:p.x,y:p.y,width:p.grating.width,height:p.grating.height,orientation:p.grating.orientation,plusId:p.id.replace(/:zero$/,':plus'),minusId:p.id.replace(/:zero$/,':minus')}));
      const available=new Map(shapes.map(p=>[p.id,p]));const pairs=window.SpotGrouping.innerPairs(gratings).filter(pair=>pair.every(id=>available.has(id)));innerPairs.push(...pairs);if(pairs.some(pair=>{const [a,b]=pair.map(id=>available.get(id));return window.SpotGrouping.overlaps({...a,width:a.grating.width,height:a.grating.height},{...b,width:b.grating.width,height:b.grating.height});}))anyInnerOverlap=true;
      if(groups.size>1){const heading=document.createElement('h3');heading.className='cjob-window-heading';heading.textContent=`Windows ${names.join(', ')}`;plots.append(heading);}
      if(shapes.length){const plot=document.createElementNS('http://www.w3.org/2000/svg','svg');plot.classList.add('cjob-plot');plot.setAttribute('role','img');plot.setAttribute('aria-label',`Grating and predicted first-order footprints for ${names.join(', ')}`);plots.append(plot);draw(plot,shapes);}
      else {const text=document.createElement('p');text.className='cjob-notes';text.textContent=mask.gratings.length?'No grating outlines can be shown because their dimensions are unavailable.':'No gratings in this mask design yet.';plots.append(text);}
      allRows.push(...rows.values());
    }
    paintSpots();
    const messages=['Positions are relative to each window (x right, y up). The first-order outlines are ideal translated grating footprints at normal incidence; diffraction broadening is not modelled.','Without units, wavelength is in nm and gap is in µm.',...allMessages];
    if(groups.size===1&&model.windows.length>1)messages.unshift(`The ${model.windows.map(w=>w.name).join(' and ')} windows have the same grating geometry; the shared layout is shown once.`);
    if(project.sadpByDesign?.[project.cjob.fingerprint] ?? Boolean(model.sadpDocumented))messages.push('SADP is enabled: diffraction uses half the designed pitch.');
    if(knownGeometry[project.cjob.fingerprint])messages.push(`Grating dimensions: ${knownGeometry[project.cjob.fingerprint].source}.`);
    if(missingSizes)messages.push('Enter missing sizes in Edit to show those outlines.');
    if(missingPitch||missingOrientation)messages.push('Enter missing diffraction pitches and orientations in Edit to show those first orders.');
    if(missingOrders)messages.push(`${missingOrders} grating(s): first order does not propagate at this wavelength.`);
    notes.textContent=messages.join(' ');
    const table=document.createElement('table'),head=document.createElement('tr');
    for(const label of ['Pitch','Grating size','Electron dose (µC/cm²)','±1 displacement']){const th=document.createElement('th');th.textContent=label;head.append(th);}table.append(head);
    for(const row of allRows){const tr=document.createElement('tr');for(const value of [row.pitch?`${row.pitch} nm`:'Unknown',row.width&&row.height?`${row.width} × ${row.height} µm`:'Unknown',row.dose===null?'—':String(row.dose),row.order!==null?`${row.order.toFixed(2)} µm`:'—']){const td=document.createElement('td');td.textContent=value;tr.append(td);}table.append(tr);}details.append(table);
  }
  function draw(plot,shapes){
    const ns='http://www.w3.org/2000/svg',W=900,H=460,left=65,right=25,top=22,bottom=52;
    const minX0=Math.min(...shapes.map(p=>p.x-p.grating.width/2)),maxX0=Math.max(...shapes.map(p=>p.x+p.grating.width/2));
    const minY0=Math.min(...shapes.map(p=>p.y-p.grating.height/2)),maxY0=Math.max(...shapes.map(p=>p.y+p.grating.height/2));
    const cx=(minX0+maxX0)/2,cy=(minY0+maxY0)/2;let spanX=Math.max(maxX0-minX0,100)*1.15,spanY=Math.max(maxY0-minY0,100)*1.15;
    const ratio=(W-left-right)/(H-top-bottom);if(spanX/spanY<ratio)spanX=spanY*ratio;else spanY=spanX/ratio;
    const minX=cx-spanX/2,maxY=cy+spanY/2,minY=cy-spanY/2;
    const px=x=>left+(x-minX)/spanX*(W-left-right),py=y=>top+(maxY-y)/spanY*(H-top-bottom),scale=(W-left-right)/spanX;
    function element(tag,attrs,text){const el=document.createElementNS(ns,tag);for(const [key,value] of Object.entries(attrs))el.setAttribute(key,String(value));if(text!==undefined)el.textContent=text;plot.append(el);return el;}
    plot.setAttribute('viewBox',`0 0 ${W} ${H}`);
    for(let i=0;i<=4;i++){const x=minX+i*spanX/4,y=minY+i*spanY/4;
      element('line',{x1:px(x),y1:top,x2:px(x),y2:H-bottom,stroke:'#263637','stroke-width':1});element('text',{x:px(x),y:H-bottom+20,fill:'#aabbb4','font-size':12,'text-anchor':'middle'},x.toFixed(0));
      element('line',{x1:left,y1:py(y),x2:W-right,y2:py(y),stroke:'#263637','stroke-width':1});element('text',{x:left-9,y:py(y)+4,fill:'#aabbb4','font-size':12,'text-anchor':'end'},y.toFixed(0));}
    element('text',{x:W/2,y:H-5,fill:'#aabbb4','font-size':12,'text-anchor':'middle'},'x relative to window (µm)');
    element('text',{x:16,y:H/2,fill:'#aabbb4','font-size':12,'text-anchor':'middle',transform:`rotate(-90 16 ${H/2})`},'y relative to window (µm)');
    let gesture=null;
    function position(event){return new DOMPoint(event.clientX,event.clientY).matrixTransform(plot.getScreenCTM().inverse());}
    plot.addEventListener('pointerdown',event=>{
      if(event.button!==0)return;event.preventDefault();plot.setPointerCapture(event.pointerId);
      const start=position(event);let target=event.target.closest?.('rect[data-spot-id]');if(!innerSwitch.checked&&target){const hits=document.elementsFromPoint(event.clientX,event.clientY).filter(el=>el.matches?.('rect[data-spot-id]')&&el.closest('svg')===plot);if(hits.length>1){const active=hits.findIndex(el=>selectedSpots.has(el.dataset.spotId));if(active>=0)target=hits[(active+1)%hits.length];}}gesture={start,clientX:event.clientX,clientY:event.clientY,target,add:event.shiftKey||event.metaKey||event.ctrlKey,moved:false,marquee:null};
    });
    plot.addEventListener('pointermove',event=>{
      if(!gesture)return;const end=position(event);
      if(!gesture.moved && Math.hypot(event.clientX-gesture.clientX,event.clientY-gesture.clientY)>=4){gesture.moved=true;gesture.marquee=element('rect',{class:'zone-marquee'});}
      if(gesture.moved){const x=Math.min(gesture.start.x,end.x),y=Math.min(gesture.start.y,end.y);for(const [key,value] of Object.entries({x,y,width:Math.abs(end.x-gesture.start.x),height:Math.abs(end.y-gesture.start.y)}))gesture.marquee.setAttribute(key,value);}
    });
    function finish(event,cancel){
      if(!gesture)return;const g=gesture;gesture=null;if(cancel){g.marquee?.remove();return;}
      if(g.moved){const end=position(event),x1=Math.min(g.start.x,end.x),x2=Math.max(g.start.x,end.x),y1=Math.min(g.start.y,end.y),y2=Math.max(g.start.y,end.y);if(!g.add)selectedSpots.clear();
        for(const rect of plot.querySelectorAll('rect[data-spot-id]')){const b=rect.getBBox();if(b.x<=x2 && b.x+b.width>=x1 && b.y<=y2 && b.y+b.height>=y1)selectedSpots.add(rect.dataset.spotId);}
        if(innerSwitch.checked)expandSelection();g.marquee.remove();
      }else if(g.target){const id=g.target.dataset.spotId,ids=pairFor(id);if(g.add){const remove=ids.every(item=>selectedSpots.has(item));for(const item of ids)if(remove)selectedSpots.delete(item);else selectedSpots.add(item);}else{selectedSpots.clear();for(const item of ids)selectedSpots.add(item);}}
      else if(!g.add)selectedSpots.clear();paintSpots();
    }
    plot.addEventListener('pointerup',event=>finish(event,false));plot.addEventListener('pointercancel',event=>finish(event,true));
    for(const p of shapes){const colour={zero:'#edf4e9',minus:'#72c7f3',plus:'#ffb17b'}[p.kind];const rect=element('rect',{x:px(p.x-p.grating.width/2),y:py(p.y+p.grating.height/2),width:p.grating.width*scale,height:p.grating.height*scale,fill:colour,'fill-opacity':p.kind==='zero'?0.12:0.06,stroke:colour,'stroke-width':p.kind==='zero'?1.8:1.4,'stroke-dasharray':p.kind==='zero'?'none':p.kind==='minus'?'5 3':'2 2','data-order':p.kind,'data-spot-id':p.id,'data-pitch':p.grating.pitch,'data-width-um':p.grating.width,'data-height-um':p.grating.height,'data-center-x-um':p.x,'data-center-y-um':p.y});const title=document.createElementNS(ns,'title');title.textContent=`${p.kind==='zero'?'Grating':p.kind==='minus'?'−1':'+1'} · ${p.grating.name} · (${p.x.toFixed(2)}, ${p.y.toFixed(2)}) µm · ${p.grating.width} × ${p.grating.height} µm`;rect.append(title);}
  }
  function editableRows(){
    const project=getProject(),model=project?.cjob?.model;if(!model)return [];
    const groups=new Map();for(const mask of model.windows){const key=JSON.stringify(mask.gratings.map(g=>[g.name,g.x.toFixed(6),g.y.toFixed(6),g.width,g.height,g.effectivePitch,g.orientation,g.dose]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));if(!groups.has(key))groups.set(key,mask);}
    const windows=[...groups.values()],origin=windows[0]||{x:0,y:0},rows=[];
    for(const mask of windows)for(const [index,raw] of mask.gratings.entries()){
      const id=raw.spotBaseId||`w${model.windows.indexOf(mask)}:g${index}`,g=resolvedGrating(raw,project,id),offset=windows.length>1,known=knownGeometry[project.cjob.fingerprint];
      const editableFields=[];if(raw.pitch==null)editableFields.push('pitch');if(raw.width==null&&!known?.width)editableFields.push('width');if(raw.height==null&&!known?.height)editableFields.push('height');if(raw.dose==null)editableFields.push('dose');
      rows.push({id,pattern:raw.name,editableFields,pitch:g.pitch??'',x:g.x+(offset?mask.x-origin.x:0),y:g.y+(offset?mask.y-origin.y:0),width:g.width??'',height:g.height??'',dose:g.dose??''});
    }
    return rows;
  }
  window.CjobView={refreshUi:update,editableRows,prepareGeometry(){const project=getProject();geometryEditor.hidden=!project?.cjob||Boolean(project.cjob.manual);if(!geometryEditor.hidden){geometryRows(project);geometryEditor.open=false;}},configure(options){getProject=options.getProject;onChange=options.onChange;onCreateZone=options.onCreateZone;onSetGeometry=options.onSetGeometry;onUpdateZone=options.onUpdateZone||(()=>{});onSetDefaultInner=options.onSetDefaultInner||(()=>{});},setReady(value){ready=value;update();},async restore(record,file){const content=await file.text();let model=null,parseError='';try{model=window.CjobModel.parse(content);}catch(error){parseError=error.message||'Unsupported CJOB';}return {id:record.id,name:record.name,file,model,parseError,fingerprint:await fingerprint(content)};}};
})();

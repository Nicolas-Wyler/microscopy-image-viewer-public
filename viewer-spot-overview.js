/* Group current-zone spots into compact, physical mask rows. */
'use strict';
window.createSpotOverview = function ({onToggle}) {
  const diagram=document.getElementById('spot-diagram'),caption=document.getElementById('spot-caption'),data=window.OM10_DATA;
  let current=null,signature='',snapshot=null;
  function doseVariants(){
    const pitches=new Map();for(const spot of data.maskDesign?.spots?.values()||[]){const pitch=spot.grating.effectivePitch??spot.grating.pitch,dose=spot.grating.dose;if(!Number.isFinite(pitch)||!Number.isFinite(dose))continue;if(!pitches.has(pitch))pitches.set(pitch,new Set());pitches.get(pitch).add(dose);}
    return new Map([...pitches].map(([pitch,values])=>[pitch,[...values].sort((a,b)=>a-b)]));
  }
  function makeRows(groups){
    const variants=doseVariants(),rows=[];
    for(const group of groups){
      const values=group.spots,gratings=values.map(spot=>spot.grating),pitches=[...new Set(gratings.map(g=>g.effectivePitch??g.pitch).filter(Number.isFinite))].sort((a,b)=>a-b);
      const labels=[...new Set(gratings.map(g=>{const options=variants.get(g.effectivePitch??g.pitch)||[];if(options.length<2)return '';const index=options.indexOf(g.dose);return index<0?'e?':`e${index}`;}).filter(Boolean))];
      const pitchLabel=pitches.length?`${pitches.join('/')} nm`:'Pitch unknown',label=pitchLabel+(labels.length?` · ${labels.join('/')}`:'');
      const orientation=gratings[0].orientation||'vertical',cross=g=>orientation==='horizontal'?g.x:g.y,extent=g=>orientation==='horizontal'?g.width:g.height;
      const centre=gratings.reduce((sum,g)=>sum+cross(g),0)/gratings.length,size=Math.min(...gratings.map(g=>extent(g)||0));
      const windowId=gratings[0].windowIndex??0,key=JSON.stringify([pitches,labels,orientation,windowId]);
      let row=rows.find(item=>item.key===key&&Math.abs(item.centre-centre)<=((item.size>0&&size>0)?Math.min(5,Math.min(item.size,size)*0.1):1e-6));
      if(!row){row={key,label,centre,size,orientation,windowId,groups:[]};rows.push(row);}
      row.groups.push(group);
    }
    for(const row of rows){const position=group=>group.spots.reduce((sum,spot)=>sum+(row.orientation==='horizontal'?-spot.y:spot.x),0)/group.spots.length;const rank=group=>({'minus':0,'zero':1,'plus':2})[group.spots[0].kind]??1;row.groups.sort((a,b)=>position(a)-position(b)||rank(a)-rank(b));}
    rows.sort((a,b)=>a.windowId-b.windowId||b.centre-a.centre||a.label.localeCompare(b.label,undefined,{numeric:true}));return rows;
  }
  function show(entry){
    const result=window.ViewerMask.forImage(data.maskDesign,entry),key=JSON.stringify([entry?.id,result.zoneName,result.groups.map(g=>g.members),result.message,data.maskError]);
    if(key===signature){updateButtons();return;}signature=key;diagram.replaceChildren();
    if(data.maskError){caption.textContent='Could not load mask design: '+data.maskError;return;}
    if(result.message){caption.textContent=result.message;if(!result.groups.length)return;}
    else if(!data.maskDesign){caption.textContent='No mask design loaded.';return;}
    else if(!result.groups.length){caption.textContent=`${result.zoneName}: no spots in this zone.`;return;}
    else caption.textContent=`${result.zoneName}: click a spot to add or remove its rectangle.`;
    const rows=makeRows(result.groups),sideFor=group=>group.spots.length>1?'both':(window.ViewerSpotPlacement.side(data.maskDesign,group.spots[0].grating)||'unknown');
    const sides=['left',...(result.groups.some(g=>sideFor(g)==='both')?['both']:[]),'right',...(result.groups.some(g=>sideFor(g)==='unknown')?['unknown']:[])];
    const columns=['62px',...sides.map(side=>side==='both'?'30px':'minmax(0, 1fr)')].join(' '),heading=document.createElement('div');heading.className='viewer-spot-heading';heading.style.gridTemplateColumns=columns;heading.append(document.createElement('span'));
    for(const side of sides){const label=document.createElement('span');label.dataset.side=side;label.textContent=({left:'L',both:'L/R',right:'R',unknown:'?'})[side];heading.append(label);}diagram.append(heading);
    for(const row of rows){
      const wrapper=document.createElement('div'),label=document.createElement('span'),sections={};wrapper.className='viewer-spot-row';wrapper.style.gridTemplateColumns=columns;label.className='spot-pitch';label.textContent=row.label;wrapper.append(label);
      for(const side of sides){const section=document.createElement('div');section.className='viewer-spot-group';section.dataset.side=side;sections[side]=section;wrapper.append(section);}diagram.append(wrapper);
      row.groups.sort((a,b)=>({minus:0,zero:1,plus:2}[a.spots[0].kind]??1)-({minus:0,zero:1,plus:2}[b.spots[0].kind]??1));
      for(const group of row.groups){const values=group.spots,orders=values.length===2?'±1':values[0].label;
        const button=document.createElement('button'),order=document.createElement('span'),remove=document.createElement('span');button.type='button';button.className='expected-spot';button.style.setProperty('--spot-color','#d8eb87');button.dataset.spotMembers=JSON.stringify(group.members);button.setAttribute('aria-pressed','false');order.className='spot-order';order.textContent=orders;remove.className='spot-remove';remove.textContent='×';remove.setAttribute('aria-hidden','true');button.append(order,remove);
        button.title=values.map(spot=>`${spot.grating.name} · ${spot.label} · (${spot.grating.x}, ${spot.grating.y}) µm${spot.grating.dose==null?'':` · ${spot.grating.dose} µC/cm²`}`).join(' / ');button.setAttribute('aria-label',button.title);
        const spot=window.ViewerSpotPlacement.definition(group);button.dataset.rectangleId=spot.id;button.addEventListener('click',()=>{const initial=window.ViewerSpotPlacement.placement(current,group);if(initial.error&&!snapshot?.active.some(item=>item.id===spot.id)){caption.textContent=initial.error;return;}onToggle({...spot,pickerPlacement:initial.rect});});sections[sideFor(group)].append(button);
      }
    }
    updateButtons();
  }
  function updateButtons(){const active=new Map((snapshot?.active||[]).map(item=>[item.id,item]));for(const button of diagram.querySelectorAll('button[data-rectangle-id]')){const id=button.dataset.rectangleId,exists=active.has(id),group=window.ViewerMask.forImage(data.maskDesign,current).groups.find(g=>window.ViewerSpotPlacement.definition(g).id===id),initial=group&&window.ViewerSpotPlacement.placement(current,group),covered=group?.members.length>1&&!exists&&group.members.some(member=>active.has(window.ViewerSpotPlacement.definition({members:[member],spots:[data.maskDesign.spots.get(member)]}).id));button.disabled=!snapshot?.ready||Boolean(covered)||(!exists&&Boolean(initial?.error));button.title=exists?'Remove rectangle':covered?'This pair contains separately saved rectangles; remove them before adding a combined rectangle.':initial?.error||'Add a rough rectangle';button.classList.toggle('active-spot',exists||covered);button.setAttribute('aria-pressed',covered?'mixed':String(exists));if(exists)button.style.setProperty('--spot-color',active.get(id).color);}}
  return {get spots(){return current?window.ViewerMask.forImage(data.maskDesign,current).groups.map(group=>window.ViewerSpotPlacement.definition(group)):[];},exists:id=>{const group=window.ViewerMask.forImage(data.maskDesign,current).groups.find(g=>window.ViewerSpotPlacement.definition(g).id===id);return Boolean(snapshot?.active.some(item=>item.id===id||(group?.members.length>1&&window.ViewerSpotPlacement.members(item.id).some(member=>group.members.includes(member)))));},refreshSide(){signature='';if(current)show(current);},update(next){snapshot=next;current=next.entry;show(current);}};
};

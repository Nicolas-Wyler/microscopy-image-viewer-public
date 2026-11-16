/* Local panel preferences are separate from project and viewer data. */
'use strict';
(() => {
  const panel=document.getElementById('project-sidebar'),toggle=document.getElementById('toggle-project-sidebar'),divider=document.getElementById('resize-project-sidebar');
  const key='om-project-sidebar-layout-v1',minimum=220,maximum=420,collapsedWidth=18;
  let preferences={width:280,collapsed:false},drag=null;
  try {const saved=JSON.parse(localStorage.getItem(key));if(saved&&Number.isFinite(saved.width))preferences.width=Math.max(minimum,Math.min(maximum,saved.width));if(saved?.collapsed===true)preferences.collapsed=true;}catch(_){}
  const desktop=()=>innerWidth>700,limit=()=>Math.max(minimum,Math.min(maximum,innerWidth-320)),clamp=value=>Math.max(minimum,Math.min(limit(),value));
  function save(){try{localStorage.setItem(key,JSON.stringify(preferences));}catch(_){}}
  function render(){const width=clamp(preferences.width),collapsed=preferences.collapsed;panel.style.setProperty('--project-sidebar-width',`${width}px`);panel.classList.toggle('is-collapsed',collapsed);toggle.setAttribute('aria-expanded',String(!collapsed));toggle.setAttribute('aria-label',`${collapsed?'Expand':'Collapse'} project sidebar`);toggle.title=toggle.getAttribute('aria-label');toggle.textContent=desktop()?(collapsed?'›':'‹'):(collapsed?'⌄':'⌃');divider.setAttribute('aria-valuemin',String(collapsed?collapsedWidth:minimum));divider.setAttribute('aria-valuemax',String(limit()));divider.setAttribute('aria-valuenow',String(collapsed?collapsedWidth:Math.round(width)));divider.setAttribute('aria-valuetext',collapsed?'Collapsed':`${Math.round(width)} pixels`);}
  function resize(value){preferences.collapsed=false;preferences.width=clamp(value);render();}
  function finish(cancel=false){if(!drag)return;const previous=drag;drag=null;if(cancel)preferences=previous.preferences;document.body.classList.remove('resizing-sidebar');if(divider.hasPointerCapture(previous.id))divider.releasePointerCapture(previous.id);render();save();}
  toggle.addEventListener('click',()=>{finish();preferences.collapsed=!preferences.collapsed;render();save();});
  divider.addEventListener('pointerdown',event=>{if(!desktop()||event.button!==0||drag)return;event.preventDefault();event.stopPropagation();drag={id:event.pointerId,x:event.clientX,width:panel.getBoundingClientRect().width,preferences:{...preferences},moved:false};divider.focus({preventScroll:true});divider.setPointerCapture(event.pointerId);document.body.classList.add('resizing-sidebar');});
  divider.addEventListener('pointermove',event=>{if(!drag||drag.id!==event.pointerId)return;const delta=event.clientX-drag.x;if(!drag.moved&&Math.abs(delta)<3)return;drag.moved=true;event.preventDefault();resize(drag.width+delta);});
  divider.addEventListener('pointerup',event=>{if(drag?.id===event.pointerId)finish();});divider.addEventListener('pointercancel',event=>{if(drag?.id===event.pointerId)finish(true);});divider.addEventListener('lostpointercapture',()=>finish());
  divider.addEventListener('keydown',event=>{if(!desktop()||!['ArrowLeft','ArrowRight','Home','End','Escape'].includes(event.key))return;event.preventDefault();event.stopPropagation();if(event.key==='Escape'){finish(true);return;}const change=(event.key==='ArrowRight'?1:-1)*(event.shiftKey?50:10);resize(event.key==='Home'?minimum:event.key==='End'?limit():panel.getBoundingClientRect().width+change);save();});
  window.addEventListener('resize',()=>{finish();render();});window.addEventListener('blur',()=>finish());window.addEventListener('pagehide',()=>finish());render();
})();

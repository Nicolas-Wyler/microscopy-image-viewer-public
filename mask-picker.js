/* Temporary mask in aligned crop coordinates. The image frame provides the
 * zoom, pan and clipping; in Original view the group maps crop back to TIFF. */
'use strict';
window.createMaskPicker = function (viewport, frameElement, overview, getFrame, spawn, redraw, beginPan) {
  const G = window.GratingGeometry;
  const feedback = document.getElementById('view-status');
  const duplicatePrompt = 'Choose an empty spot for the duplicate.';
  let overlay, press, guideRects = null, duplicateSource = null, priorFeedback = null, preview = false, pickerPlacements = new Map();
  const gapButton=document.getElementById('gap-correction-button'), gapMenu=document.getElementById('gap-correction-menu');
  const gapSlider=document.getElementById('gap-slider'), gapNumber=document.getElementById('gap-number');
  let gapCorrection=gapButton?Number(window.OM10Session.get('gapCorrectionUm',0)):0;
  if (!Number.isFinite(gapCorrection)) gapCorrection=0;
  gapNumber.value=String(gapCorrection); gapSlider.value=String(Math.max(-100,Math.min(100,gapCorrection)));
  const nominalGap=window.OM10_DATA?.nominalGapUm;
  function updateGapReadout() {
    if(!Number.isFinite(nominalGap)||nominalGap<=0){document.getElementById('assumed-gap').textContent='—';if(document.getElementById('gap-correction-readout'))document.getElementById('gap-correction-readout').textContent='—';if(gapButton){gapButton.disabled=true;gapButton.title='Set gap is unavailable';}return;}
    const pretty=v => new Intl.NumberFormat('en-GB',{maximumFractionDigits:6}).format(v);
    document.getElementById('assumed-gap').textContent=pretty(nominalGap+gapCorrection)+' µm';document.getElementById('assumed-gap').title='Set gap: '+pretty(nominalGap)+' µm';
    if(document.getElementById('gap-correction-readout'))document.getElementById('gap-correction-readout').textContent=(gapCorrection>0?'+':'')+pretty(gapCorrection)+' µm';
    if(gapButton)gapButton.title='Correction '+(gapCorrection>0?'+':'')+pretty(gapCorrection)+' µm · assumed gap '+pretty(nominalGap+gapCorrection)+' µm';
  }
  updateGapReadout();
  function svg(tag, attributes, parent) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key,value] of Object.entries(attributes)) node.setAttribute(key,value);
    parent.append(node);
    return node;
  }
  function close(preserveMenu = false) {
    if (!preserveMenu) { gapMenu.hidden=true; gapButton?.setAttribute('aria-expanded','false'); preview=false; }
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    press = null;
    guideRects = null;
    pickerPlacements = new Map();
    if (duplicateSource && feedback?.textContent===duplicatePrompt) feedback.textContent=priorFeedback;
    duplicateSource = null;
    priorFeedback = null;
    redraw();
  }
  function containsImagePoint(event) {
    const box = frameElement.getBoundingClientRect();
    return event.clientX >= box.left && event.clientX < box.right && event.clientY >= box.top && event.clientY < box.bottom;
  }
  function openImported(source) {
    const frame=getFrame(),entry=frame?.entry;if(!frame)return false;
    if(!window.OM10_DATA.maskDesign){if(feedback)feedback.textContent='No mask design is available for spot placement.';return false;}
    if(!entry.hasCalibration||!entry.alignment){if(feedback)feedback.textContent=entry.alignmentError||'A sidecar pixel size and rough alignment are needed before placing spots.';return false;}
    const candidates=overview.spots.filter(spot=>!overview.exists(spot.id)).map(spot=>({spot,result:window.ViewerSpotPlacement.placement(entry,spot.group)})).filter(item=>item.result.rect);
    if(!candidates.length){if(feedback)feedback.textContent='No unplaced spots with usable geometry are visible for this image and zone.';return false;}
    close();duplicateSource=source;if(source&&feedback){priorFeedback=feedback.textContent;feedback.textContent=duplicatePrompt;}
    overlay=svg('svg',{viewBox:'0 0 '+frame.width+' '+frame.height,'aria-label':source?'Choose an empty spot for the duplicate':'Expected spot picker'},frameElement);
    overlay.style.cssText='position:absolute;inset:0;width:100%;height:100%;cursor:default';
    const shade=svg('mask',{id:'spot-picker-shade',maskUnits:'userSpaceOnUse',x:0,y:0,width:frame.width,height:frame.height},overlay);
    svg('rect',{width:frame.width,height:frame.height,fill:'white'},shade);
    svg('rect',{width:frame.width,height:frame.height,fill:'black',opacity:.40,mask:'url(#spot-picker-shade)'},overlay);
    const targets=svg('g',{},overlay),matrix=G.viewMatrix(entry,frame.view);guideRects=[];pickerPlacements=new Map();
    for(const {spot,result} of candidates){
      const rect=result.rect,point=G.transform({x:rect.cx,y:rect.cy},matrix),angle=(rect.angle+Math.atan2(matrix[1][0],matrix[0][0]))*180/Math.PI;
      const factor=Math.hypot(matrix[0][0],matrix[1][0]),width=rect.width*factor,height=rect.height*factor;
      const box={x:point.x-width/2,y:point.y-height/2,width,height,transform:`rotate(${angle} ${point.x} ${point.y})`};
      svg('rect',{...box,fill:'black'},shade);svg('rect',{...box,'aria-label':spot.label,'data-pick':spot.id,fill:spot.color,'fill-opacity':.28,stroke:'none',cursor:'pointer'},targets);
      guideRects.push(rect);pickerPlacements.set(spot.id,rect);
    }
    redraw();return true;
  }
  function open(source = null, correction = null) {
    if(window.OM10_DATA?.importedProject)return openImported(source);
    if (!window.OM10_MASK?.rows?.length) { if (feedback) feedback.textContent=window.OM10_DATA?.maskDesign?'Use the expected-spot buttons to add rectangles for this mask.':'No mask design is available for spot placement.'; return false; }
    if(!Number.isFinite(nominalGap)||nominalGap<=0){if(feedback)feedback.textContent='Set gap is unavailable; spot placement is disabled.';return false;}
    const frame = getFrame();
    if (!frame) return false;
    close(correction !== null);
    preview = correction !== null;
    const effectiveCorrection=correction ?? gapCorrection;
    duplicateSource = source;
    if (source && feedback) { priorFeedback=feedback.textContent; feedback.textContent=duplicatePrompt; }
    overlay = svg('svg', {viewBox:'0 0 '+frame.width+' '+frame.height,
      'aria-label':source ? 'Choose an empty spot for the duplicate' : 'Expected spot picker'},frameElement);
    overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;cursor:default';
    const mask = svg('mask',{id:'spot-picker-shade',maskUnits:'userSpaceOnUse',x:0,y:0,width:frame.width,height:frame.height},overlay);
    svg('rect',{width:frame.width,height:frame.height,fill:'white'},mask);
    svg('rect',{width:frame.width,height:frame.height,fill:'black',opacity:.40,mask:'url(#spot-picker-shade)'},overlay);
    const matrix = G.viewMatrix(frame.entry,'cropped');
    const [[a,c,tx],[b,d,ty]] = matrix;
    const attrs = frame.view === 'original'
      ? {transform:new DOMMatrix([a,b,c,d,tx,ty]).inverse().toString()} : {};
    const holes = svg('g',attrs,mask), colors = svg('g',attrs,overlay);
    const design = window.OM10_MASK;
    // Rigid registration only: keep the mask's dimensions and separations in µm.
    const anchors = design.rows.flatMap(row => [row.leftCentreUm,row.rightCentreUm]);
    const refs = design.referenceZeroCentresCrop;
    const mean = (points,axis) => points.reduce((sum,p)=>sum+p[axis],0)/points.length;
    const mx=mean(anchors,0), my=mean(anchors,1), rx=mean(refs,0), ry=mean(refs,1);
    let dot=0, cross=0;
    anchors.forEach(([x,y],i)=>{
      const u=refs[i][0]-rx, v=refs[i][1]-ry;
      dot+=(x-mx)*u+(y-my)*v; cross+=(x-mx)*v-(y-my)*u;
    });
    const angle=Math.atan2(cross,dot)*180/Math.PI;
    const registration = new DOMMatrix().translate(rx+.5,ry+.5).rotate(angle)
      .scale(1/frame.entry.pixelSizeUm).translate(-mx,-my);
    const maskToRaw = new DOMMatrix([a,b,c,d,tx,ty]).inverse().multiply(registration);
    guideRects = [];
    pickerPlacements = new Map();
    const maskHoles=svg('g',{transform:registration},holes);
    const targets=svg('g',{transform:registration},colors);
    const size=design.nominalSpotSideUm;
    function target(spot,box) {
      svg('rect',{...box,'aria-label':spot.label,'data-pick':spot.id,fill:spot.color,'fill-opacity':.28,
        stroke:'none',cursor:'pointer'},targets);
    }
    const inward=new Map();
    for (const spot of overview.spots) {
      if (!preview && overview.exists(spot.id)) continue;
      const row=design.rows[spot.rowIndex];
      const [x,y]=spot.side === 'both' ? [(row.leftCentreUm[0]+row.rightCentreUm[0])/2,(row.leftCentreUm[1]+row.rightCentreUm[1])/2] : row[spot.side+'CentreUm'];
      const spotWidth=row.nominalSpotWidthUm ?? size;
      const displacement=spot.side === 'both' ? 0 : spot.order*row.nominalDisplacementUm*(1+effectiveCorrection/nominalGap);
      const box={x:x+displacement-spotWidth/2,y:y-size/2,width:spotWidth,height:size};
      const centre = maskToRaw.transformPoint({x:box.x+spotWidth/2, y:box.y+size/2});
      const sidePixels = size / frame.entry.pixelSizeUm;
      const rawAngle = Math.atan2(maskToRaw.b,maskToRaw.a), rectAngle = Math.atan2(Math.sin(2*rawAngle),Math.cos(2*rawAngle))/2;
      guideRects.push({cx:centre.x, cy:centre.y, width:spotWidth/frame.entry.pixelSizeUm, height:sidePixels,
        angle:rectAngle});
      pickerPlacements.set(spot.id,{cx:centre.x,cy:centre.y,width:spotWidth/frame.entry.pixelSizeUm,height:sidePixels,angle:rectAngle});
      svg('rect',{...box,fill:'black'},maskHoles);
      target(spot,box);
      if (spot.side==='left' && spot.order===1) inward.set(row.id,{spot,box});
      const left = inward.get(row.id);
      if (spot.side==='right' && spot.order===-1 && left) {
        const top=Math.max(left.box.y,box.y);
        const height=Math.min(left.box.y+size,box.y+size)-top;
        const start=Math.max(box.x,left.box.x), half=(Math.min(box.x+box.width,left.box.x+left.box.width)-start)/2;
        if (half>0 && height>0) {
          target(left.spot,{x:start,y:top,width:half,height});
          target(spot,{x:start+half,y:top,width:half,height});
        }
      }
    }
    redraw();
    return true;
  }
  viewport.addEventListener('contextmenu', event => {
    if (event.defaultPrevented || event.target.closest('[data-outline-id], button, .zoom-toolbar') || !containsImagePoint(event)) return;
    if (!getFrame()) return;
    event.preventDefault();
    open();
  });
  function intercept(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  function zoomControl(event) {
    return event.target.closest('.zoom-toolbar');
  }
  function moved(event) {
    return Math.hypot(event.clientX - press.x, event.clientY - press.y) >= 4;
  }
  document.addEventListener('pointerdown', event => {
    if (!overlay || zoomControl(event) || event.target.closest('[data-draggable-popup], #gap-correction-button, #filter-parameters-toggle')) return;
    if (event.target.closest('#clean-image, #exposure-map .map-cell')) {
      close(); // These controls take effect on the first press, even with the picker open.
      return;
    }
    intercept(event);
    if (event.button !== 0 || !event.isPrimary) return;
    press = {id:event.pointerId, x:event.clientX, y:event.clientY, time:event.timeStamp,
      spot:event.target.closest('[data-pick]')?.dataset.pick, dragged:false, released:false};
    if (viewport.contains(event.target)) beginPan(event);
  }, true);
  document.addEventListener('pointermove', event => {
    if (press?.id === event.pointerId && moved(event)) press.dragged = true;
  }, true);
  document.addEventListener('pointerup', event => {
    if (press?.id !== event.pointerId) return;
    press.released = !press.dragged && !moved(event) && event.timeStamp - press.time <= 350;
    if (!viewport.contains(event.target)) intercept(event);
  }, true);
  document.addEventListener('pointercancel', () => { press = null; }, true);
  document.addEventListener('wheel', () => { if (press) press.dragged = true; }, true);
  document.addEventListener('click', event => {
    if (!overlay || zoomControl(event) || event.target.closest('[data-draggable-popup], #gap-correction-button, #filter-parameters-toggle')) return;
    intercept(event);
    const gesture = press;
    press = null;
    if (!gesture?.released) return;
    // Pointer capture sends the click to the viewport. Hit-test the actual release position.
    const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-pick]');
    const spot = hit && gesture.spot === hit.dataset.pick && overview.spots.find(s => s.id === gesture.spot);
    const source = duplicateSource, placement=spot && pickerPlacements.get(spot.id);
    close();
    if (spot && placement && !overview.exists(spot.id)) spawn({...spot,pickerPlacement:placement},source);
  }, true);
  document.addEventListener('contextmenu', event => {
    if (!overlay || event.target.closest('[data-draggable-popup]')) return;
    if (preview && viewport.contains(event.target) && containsImagePoint(event)) { close(); return; }
    intercept(event);
  }, true);
  document.addEventListener('keydown',event=>{
    if (event.target.closest('#gap-correction-menu')) { if(event.key==='Escape'){ close(); gapButton?.focus(); event.preventDefault(); event.stopImmediatePropagation(); } return; }
    if (event.target.closest('[data-draggable-popup]')) return;
    if (!overlay || ['+', '=', '-', '1', 'f'].includes(event.key.toLowerCase())) return;
    close();
    if (event.key==='Escape') {event.preventDefault();event.stopImmediatePropagation();}
  },true);
  function positionGapMenu() {
    if (gapMenu.hidden || window.OM11PopupDrag?.restore(gapMenu)) return;
    const anchor = viewport.getBoundingClientRect(), box = gapMenu.getBoundingClientRect();
    gapMenu.style.left = Math.max(8, Math.min(anchor.right - box.width - 14, window.innerWidth - box.width - 8)) + 'px';
    gapMenu.style.top = Math.max(8, Math.min(anchor.top + 14, window.innerHeight - box.height - 8)) + 'px';
  }
  window.addEventListener('resize', positionGapMenu);
  document.addEventListener('scroll', positionGapMenu, true);
  if (window.ResizeObserver) new ResizeObserver(positionGapMenu).observe(viewport);
  function showGap() {
    const value=Number(gapNumber.value);
    if (!Number.isFinite(value) || gapNumber.value.trim()==='') return;
    gapCorrection=value; window.OM10Session.set('gapCorrectionUm',value); updateGapReadout();
    if (open(null,value)) { gapMenu.hidden=false; positionGapMenu(); gapButton?.setAttribute('aria-expanded','true'); }
  }
  gapButton?.addEventListener('click',()=>{ if (!gapMenu.hidden) close(); else showGap(); });
  gapSlider.addEventListener('input',()=>{ gapNumber.value=gapSlider.value; showGap(); });
  gapNumber.addEventListener('input',()=>{
    const v=Number(gapNumber.value);
    if(gapNumber.value.trim()==='' || !Number.isFinite(v)) return;
    gapSlider.value=String(Math.max(-100,Math.min(100,v))); showGap();
  });
  document.getElementById('gap-close').addEventListener('click',()=>{close();gapButton?.focus();});
  window.addEventListener('blur',()=>close());
  return {close,open, get guideRects() { return guideRects; }};
};

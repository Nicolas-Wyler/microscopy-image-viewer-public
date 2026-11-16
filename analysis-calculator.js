/* Independent all-image calculations from measured horizontal spot distances. */
'use strict';
window.createAnalysisCalculator = function ({data, mask, store}) {
  const session=window.OM10Session, geometry=window.GratingGeometry;
  const measure=window.createDistanceMeasurements(mask);
  const root=document.getElementById('analysis-calculator');
  const enabled=document.getElementById('analysis-calc-enabled');
  const lambdaButton=document.getElementById('analysis-calc-lambda');
  const gapButton=document.getElementById('analysis-calc-gap');
  const gear=document.getElementById('analysis-calc-gear');
  const settings=document.getElementById('analysis-calc-settings');
  const closeButton=document.getElementById('analysis-calc-settings-close');
  const input=document.getElementById('analysis-calc-value');
  const label=document.getElementById('analysis-calc-label');
  const stepInput=document.getElementById('analysis-calc-step');
  const stepLabel=document.getElementById('analysis-calc-step-label');
  const binInput=document.getElementById('analysis-calc-bin');
  const binLabel=document.getElementById('analysis-calc-bin-label');
  const limitsLabel=document.getElementById('analysis-calc-limits-label');
  const xminInput=document.getElementById('analysis-calc-xmin');
  const xmaxInput=document.getElementById('analysis-calc-xmax');
  const ymaxInput=document.getElementById('analysis-calc-ymax');
  const lambdaFormula=document.getElementById('analysis-calc-formula-lambda');
  const gapFormula=document.getElementById('analysis-calc-formula-gap');
  const caption=document.getElementById('analysis-calc-caption');
  const histogram=document.getElementById('analysis-calc-histogram');
  const status=document.getElementById('analysis-calc-status');
  const saved=session.get('analysisCalculator', {});
  const str=(name,fallback)=>typeof saved[name] === 'string' ? saved[name] : fallback;
  const state={enabled:saved.enabled === true, mode:saved.mode === 'gap' ? 'gap' : 'lambda',
    gap:str('gap',Number.isFinite(data.nominalGapUm)?String(data.nominalGapUm):''), wavelength:str('wavelength',Number.isFinite(data.nominalWavelengthNm)?String(data.nominalWavelengthNm):''),
    gapStep:str('gapStep','1'), wavelengthStep:str('wavelengthStep','0.1'),
    lambdaBin:str('lambdaBin','0.1'), gapBin:str('gapBin',''),
    lambdaMin:str('lambdaMin',''), lambdaMax:str('lambdaMax',''), gapMin:str('gapMin',''), gapMax:str('gapMax',''),
    lambdaYMax:str('lambdaYMax',''), gapYMax:str('gapYMax','')};
  const cache=new Map();
  let current=null, signature='';
  const save=()=>session.set('analysisCalculator',{...state});
  function closeSettings(restoreFocus=false) {
    if (settings.hidden) return;
    settings.hidden=true;gear.setAttribute('aria-expanded','false');
    if (restoreFocus && !gear.disabled) gear.focus({preventScroll:true});
  }
  function positionSettings() {
    if (settings.hidden) return;
    const anchor=gear.getBoundingClientRect();
    if (!anchor.width && !anchor.height) {closeSettings();return;}
    if (window.OM11PopupDrag?.restore(settings)) return;
    const box=settings.getBoundingClientRect(), margin=8;
    let left=anchor.left-box.width-margin;
    if (left<margin) left=anchor.right+margin;
    settings.style.left=Math.max(margin,Math.min(left,window.innerWidth-box.width-margin))+'px';
    settings.style.top=Math.max(margin,Math.min(anchor.top,window.innerHeight-box.height-margin))+'px';
  }
  const settingsTarget=target=>settings.contains(target) || gear.contains(target) || lambdaButton.contains(target) || gapButton.contains(target);
  function svg(tag, attrs, parent) {
    const node=document.createElementNS('http://www.w3.org/2000/svg',tag);
    for (const [name,value] of Object.entries(attrs)) node.setAttribute(name,value);
    parent.append(node); return node;
  }
  function pairsFor(entry, view) {
    let item=cache.get(entry.filename);
    if (!item) {
      item={items:new Map(store.load(entry.filename).items),views:new Map()};
      cache.set(entry.filename,item);
    }
    if (!item.views.has(view)) {
      const centres=new Map(), matrix=geometry.viewMatrix(entry,view);
      for (const [id,raw] of item.items) {
        const point=geometry.transform({x:raw.cx,y:raw.cy},matrix);
        centres.set(id,{raw,xUm:point.x*(view==='cropped'?(entry.alignment?.alignedPixelUm??entry.pixelSizeUm):entry.pixelSizeUm)});
      }
      item.views.set(view,measure(centres));
    }
    return item.views.get(view);
  }
  const keys=()=>state.mode === 'lambda'
    ? {step:'gapStep',bin:'lambdaBin',min:'lambdaMin',max:'lambdaMax',ymax:'lambdaYMax'}
    : {step:'wavelengthStep',bin:'gapBin',min:'gapMin',max:'gapMax',ymax:'gapYMax'};
  function niceStep(target) {
    if (!Number.isFinite(target) || target<=0) return 1;
    const magnitude=10**Math.floor(Math.log10(target));
    if (!magnitude) return target;
    return [1,2,5,10].find(factor=>factor*magnitude>=target)*magnitude;
  }
  function formatNumber(value, step) {
    const exponent=Math.floor(Math.log10(step));
    if (exponent < -12 || exponent > 10) return String(Number(value.toPrecision(15)));
    let decimals=Math.max(0,-exponent);
    while (decimals<15 && Math.abs(step*10**decimals-Math.round(step*10**decimals))>1e-8) decimals++;
    return value.toFixed(decimals);
  }
  function drawHistogram(values, fields) {
    histogram.replaceChildren();
    const lambda=state.mode==='lambda', min=Math.min(...values), max=Math.max(...values);
    const width=fields.bin.trim() ? Number(fields.bin) : lambda ? .1 : niceStep(Math.max(1,(max-min)/15));
    if (!Number.isFinite(width) || width<=0) return {error:'Enter a positive bin size, or leave it empty for Auto.'};
    const indexFor=value=>{
      const scaled=value/width, nearest=Math.round(scaled);
      return Math.abs(scaled-nearest)<=Number.EPSILON*8*Math.max(1,Math.abs(scaled)) ? nearest : Math.floor(scaled);
    };
    const indices=values.map(indexFor);
    if (indices.some(index=>!Number.isSafeInteger(index))) return {error:'Bin size is too small for these values.'};
    const first=Math.min(...indices), last=Math.max(...indices), span=Math.max(4,last-first+1);
    const lowIndex=Math.max(0,first-Math.floor((span-(last-first+1))/2));
    if (!Number.isSafeInteger(lowIndex+span)) return {error:'Bin size is too small for these values.'};
    let low=lowIndex*width, high=(lowIndex+span)*width;
    const minSet=fields.min.trim()!=='';const maxSet=fields.max.trim()!=='';
    const minLimit=minSet?Number(fields.min):null, maxLimit=maxSet?Number(fields.max):null;
    if ((minSet && !Number.isFinite(minLimit)) || (maxSet && !Number.isFinite(maxLimit))) return {error:'Enter valid x limits, or leave them empty for Auto.'};
    const autoSpan=high-low;
    if (minSet) low=minLimit;
    if (maxSet) high=maxLimit;
    if (minSet && !maxSet && low>=high) high=low+autoSpan;
    if (maxSet && !minSet && high<=low) low=high-autoSpan;
    if (!(Number.isFinite(low) && Number.isFinite(high) && high>low && Number.isFinite(high-low))) return {error:'X minimum must be smaller than x maximum.'};
    const visible=values.filter(value=>value>=low && value<high);
    const counts=new Map();
    for (const value of values) {
      const index=indexFor(value);
      counts.set(index,(counts.get(index)||0)+1);
    }
    const unit=lambda?'nm':'µm', range=high-low;
    const edge=index=>formatNumber(index*width,width);
    const extent=index=>{
      const binLeft=index*width, binRight=(index+1)*width;
      const left=Math.max(low,binLeft), right=Math.min(high,binRight);
      return {left,right,partial:left>binLeft || right<binRight,
        label:(left>binLeft?String(Number(left.toPrecision(12))):edge(index))+'–'+
          (right<binRight?String(Number(right.toPrecision(12))):edge(index+1))};
    };
    const ordered=[...counts.entries()].filter(([index])=>{const e=extent(index);return e.right>e.left;}).sort((a,b)=>a[0]-b[0]);
    const peak=Math.max(0,...ordered.map(([,count])=>count));
    const customY=fields.ymax.trim()!=='';
    const yMax=customY?Number(fields.ymax):Math.max(1,peak);
    if (!(Number.isFinite(yMax) && yMax>0)) return {error:'Enter a positive y maximum, or leave it empty for Auto.'};
    const plot=svg('svg',{viewBox:'0 0 220 94',role:'img',
      'aria-label':(lambda?'Wavelength':'Gap')+' histogram in '+width+' '+unit+' bins: '+ordered.map(([index,count])=>edge(index)+' to '+edge(index+1)+' '+unit+': '+count).join(', ')},histogram);
    const text=(x,y,value,anchor)=>{svg('text',{x,y,'text-anchor':anchor,'font-size':10,fill:'currentColor'},plot).textContent=value;};
    text(21,14,customY?String(yMax):peak,'end');text(21,70,0,'end');
    svg('path',{d:'M25 10v57h186',fill:'none',stroke:'currentColor'},plot);
    ordered.forEach(([index,count])=>{
      const {left,right,partial,label}=extent(index);
      if (!(right>left)) return;
      const x=25+186*(left-low)/range, barWidth=186*(right-left)/range, space=Math.min(2,barWidth*.15);
      const h=56*Math.min(count,yMax)/yMax;
      const bar=svg('rect',{x:x+space/2,y:67-h,width:barWidth-space,height:h,fill:lambda?'#87b8c2':'#b7cf91'},plot);
      svg('title',{},bar).textContent=edge(index)+'–'+edge(index+1)+' '+unit+' · '+count+(partial?' · visible '+label:'')+(count>yMax?' · clipped at y max '+yMax:'');
    });
    const tickStep=niceStep(range/5 || range), firstTick=Math.ceil(low/tickStep), lastTick=Math.floor(high/tickStep);
    for(let tick=firstTick;tick<=lastTick && tick-firstTick<10;tick++) {
      const value=tick*tickStep, x=25+186*(value-low)/range;
      svg('path',{d:'M'+x+' 67v4',stroke:'currentColor'},plot);
      text(x,81,formatNumber(value,tickStep),'middle');
    }
    text(118,93,(lambda?'λ':'g')+' ('+unit+')','middle');
    return {description:width+' '+unit+' bins',visible:visible.length,limited:minSet||maxSet,clipped:peak>yMax};
  }
  function refresh() {
    if (!state.enabled) {
      if (!histogram.children.length) status.textContent='Enable to calculate from all measured distances.';
      return;
    }
    histogram.replaceChildren();
    if (!current) {status.textContent='Loading image measurements…';return;}
    const raw=state.mode==='lambda' ? state.gap : state.wavelength, number=Number(raw);
    if (raw.trim()==='' || !Number.isFinite(number) || number<=0) {
      status.textContent='Enter a positive '+(state.mode==='lambda'?'gap':'wavelength')+'.';return;
    }
    const values=[], usedImages=new Set();
    let skipped=0, unreadable=0;
    for (const entry of data.images) {
      let pairs;
      try {
        pairs=current.context.ready && current.context.entry.filename===entry.filename ? current.pairs : pairsFor(entry,current.context.view);
      } catch (_) { unreadable++; continue; }
      for (const pair of pairs) {
        const result = state.mode==='lambda'
          ? window.OM11Diffraction.wavelengthFromRadius(pair.distanceUm,number,pair.maskPitchNm)
          : window.OM11Diffraction.gapFromRadius(pair.distanceUm,number,pair.maskPitchNm);
        if (!Number.isFinite(result)) {skipped++;continue;}
        values.push(result);usedImages.add(entry.filename);
      }
    }
    if (!values.length) {
      status.textContent=skipped ? 'No physical results for the entered value.' : 'No matching zero- and first-order rectangles across the images.';
    } else {
      const selected=keys(), bins=drawHistogram(values,{bin:state[selected.bin],min:state[selected.min],max:state[selected.max],ymax:state[selected.ymax]});
      if (bins.error) status.textContent=bins.error;
      else {
        status.textContent=(bins.limited ? bins.visible+' of '+values.length+' distances in range' : values.length+' distance'+(values.length===1?'':'s')+' · '+usedImages.size+' image'+(usedImages.size===1?'':'s'))+' · '+bins.description;
        if (bins.clipped) status.textContent+=' · bars clipped';
        if (skipped) status.textContent+=' · '+skipped+' not physical';
      }
    }
    if (unreadable) status.textContent+=' · '+unreadable+' image'+(unreadable===1?'':'s')+' could not be read';
    const rawStep=state[keys().step], step=Number(rawStep);
    if (!rawStep.trim() || !Number.isFinite(step) || step<=0) status.textContent+=' · Enter a positive arrow step';
  }
  function applyStep() {
    const raw=state[keys().step], value=Number(raw);
    input.step=raw.trim() && Number.isFinite(value) && value>0 ? String(value) : 'any';
  }
  function renderControls() {
    const lambda=state.mode==='lambda', selected=keys(), inputUnit=lambda?'µm':'nm', resultUnit=lambda?'nm':'µm';
    root.classList.toggle('is-disabled',!state.enabled);
    enabled.checked=state.enabled;
    lambdaButton.disabled=gapButton.disabled=gear.disabled=input.disabled=stepInput.disabled=binInput.disabled=xminInput.disabled=xmaxInput.disabled=ymaxInput.disabled=!state.enabled;
    if (!state.enabled) closeSettings();
    lambdaButton.setAttribute('aria-pressed',String(lambda));gapButton.setAttribute('aria-pressed',String(!lambda));
    label.textContent=lambda?'Gap (µm)':'Wavelength (nm)';
    input.value=lambda?state.gap:state.wavelength;
    input.setAttribute('value',input.value); // Native arrows step from the current value, even between multiples.
    stepLabel.textContent='Arrow step ('+inputUnit+')';stepInput.value=state[selected.step];applyStep();
    binLabel.textContent='Bin size ('+resultUnit+')';binInput.value=state[selected.bin];
    limitsLabel.textContent='X limits ('+resultUnit+')';xminInput.value=state[selected.min];xmaxInput.value=state[selected.max];
    ymaxInput.value=state[selected.ymax];
    xminInput.setAttribute('aria-label','Histogram x minimum in '+resultUnit);xmaxInput.setAttribute('aria-label','Histogram x maximum in '+resultUnit);
    lambdaFormula.hidden=!lambda;gapFormula.hidden=lambda;
    caption.textContent=(lambda?'Wavelength':'Gap')+' · all images';
    refresh();
  }
  enabled.addEventListener('change',()=>{state.enabled=enabled.checked;save();renderControls();});
  gear.addEventListener('click',()=>{
    if (!state.enabled) return;
    if (!settings.hidden) {closeSettings();return;}
    settings.hidden=false;gear.setAttribute('aria-expanded','true');positionSettings();
    if (!settings.hidden) stepInput.focus({preventScroll:true});
  });
  closeButton.addEventListener('click',()=>closeSettings(true));
  document.addEventListener('pointerdown',event=>{if (!settings.hidden && !settingsTarget(event.target)) closeSettings();},true);
  document.addEventListener('focusin',event=>{if (!settings.hidden && !settingsTarget(event.target)) closeSettings();});
  document.addEventListener('keydown',event=>{
    if (!settings.hidden && event.key==='Escape') {event.preventDefault();event.stopPropagation();closeSettings(true);}
  });
  document.addEventListener('scroll',positionSettings,true);
  window.addEventListener('resize',positionSettings);
  for (const [button,mode] of [[lambdaButton,'lambda'],[gapButton,'gap']]) button.addEventListener('click',()=>{
    if (!state.enabled || state.mode===mode) return;
    state.mode=mode;save();renderControls();
  });
  input.addEventListener('input',()=>{
    if (state.mode==='lambda') state.gap=input.value; else state.wavelength=input.value;
    input.setAttribute('value',input.value);
    save();refresh();
  });
  stepInput.addEventListener('input',()=>{state[keys().step]=stepInput.value;save();applyStep();refresh();});
  for (const [control,property] of [[binInput,'bin'],[xminInput,'min'],[xmaxInput,'max'],[ymaxInput,'ymax']]) control.addEventListener('input',()=>{
    state[keys()[property]]=control.value;save();refresh();
  });
  window.addEventListener('storage',event=>{
    if (event.key===null) cache.clear();
    else {
      const entry=data.images.find(image=>store.keyFor(image.filename)===event.key);
      if (!entry) return;
      cache.delete(entry.filename);
    }
    if (state.enabled) refresh();
  });
  renderControls();
  return {
    resetSide() { cache.clear(); current=null; signature=''; if (state.enabled) refresh(); },
    remember(name,items) {
      cache.set(name,{items:new Map(items),views:new Map()});
      if (state.enabled && current && (name!==current.context.entry.filename || !current.context.ready)) refresh();
    },
    update(pairs,context) {
      const next=context.entry.filename+'|'+context.view+'|'+context.ready+'|'+pairs.map(pair=>pair.firstId+':'+pair.distanceUm).join('|');
      current={pairs,context};
      if (next!==signature) {signature=next;if(state.enabled)refresh();}
    }
  };
};

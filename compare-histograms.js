/* View settings for the two all-dose comparison histograms. */
'use strict';
window.createCompareHistograms = function () {
  const session=window.OM10Session, saved=session.get('compareHistograms',{});
  const defaults={wavelength:{bin:'0.1',min:'',max:'',ymax:''},gap:{bin:'',min:'',max:'',ymax:''}};
  const state={};
  for (const name of Object.keys(defaults)) {
    state[name]={};
    for (const [key,fallback] of Object.entries(defaults[name]))
      state[name][key]=typeof saved?.[name]?.[key]==='string' ? saved[name][key] : fallback;
    state[name].filterOther=saved?.[name]?.filterOther===true;
  }
  const plots={wavelength:document.getElementById('compare-histogram'),gap:document.getElementById('compare-gap-histogram')};
  const gears={wavelength:document.getElementById('compare-wavelength-gear'),gap:document.getElementById('compare-gap-gear')};
  const dialog=document.getElementById('compare-histogram-settings');
  const closeButton=document.getElementById('compare-histogram-settings-close');
  const title=document.getElementById('compare-histogram-settings-title');
  const binLabel=document.getElementById('compare-histogram-bin-label');
  const limitsLabel=document.getElementById('compare-histogram-limits-label');
  const filterOther=document.getElementById('compare-histogram-filter-other');
  const filterLabel=document.getElementById('compare-histogram-filter-label');
  const controls={bin:document.getElementById('compare-histogram-bin'),min:document.getElementById('compare-histogram-xmin'),
    max:document.getElementById('compare-histogram-xmax'),ymax:document.getElementById('compare-histogram-ymax')};
  let active=null, data=[];
  const save=()=>session.set('compareHistograms',{wavelength:{...state.wavelength},gap:{...state.gap}});

  function svg(tag,attrs,parent) {
    const node=document.createElementNS('http://www.w3.org/2000/svg',tag);
    for (const [key,value] of Object.entries(attrs)) node.setAttribute(key,value);
    parent.append(node);return node;
  }
  function niceStep(target) {
    if (!(Number.isFinite(target) && target>0)) return 1;
    const magnitude=10**Math.floor(Math.log10(target));
    return magnitude ? [1,2,5,10].find(factor=>factor*magnitude>=target)*magnitude : target;
  }
  function formatNumber(value,step) {
    const exponent=Math.floor(Math.log10(step));
    if (exponent < -12 || exponent > 10) return String(Number(value.toPrecision(15)));
    let decimals=Math.max(0,-exponent);
    while (decimals<15 && Math.abs(step*10**decimals-Math.round(step*10**decimals))>1e-8) decimals++;
    return value.toFixed(decimals);
  }
  function selection(name) {
    const other=name==='wavelength'?'gap':'wavelength', rule=state[other];
    const all=data.filter(row=>Number.isFinite(row[name]));
    let allowed=()=>true;
    if (rule.filterOther) {
      const hasMin=rule.min.trim()!=='' , hasMax=rule.max.trim()!=='';
      const min=hasMin?Number(rule.min):null, max=hasMax?Number(rule.max):null;
      if ((hasMin && !Number.isFinite(min)) || (hasMax && !Number.isFinite(max)) || (hasMin && hasMax && min>=max))
        return {error:'Check '+other+' x limits before filtering this histogram.'};
      // The lower bound is inclusive and the upper bound exclusive, as in the plot.
      allowed=row=>Number.isFinite(row[other]) && (!hasMin || row[other]>=min) && (!hasMax || row[other]<max);
    }
    const values=all.filter(allowed).map(row=>row[name]);
    const unavailable=name==='gap' ? data.filter(row=>Number.isFinite(row.wavelength) && !Number.isFinite(row.gap) && allowed(row)).length : 0;
    return {values,total:all.length,filtered:rule.filterOther,other,unavailable};
  }
  function draw(name) {
    const target=plots[name], selected=selection(name), options=state[name], lambda=name==='wavelength';
    const titleText=lambda?'Wavelength':'Gap', unit=lambda?'nm':'µm';
    target.replaceChildren();
    if (selected.error) {target.textContent=selected.error;return;}
    const values=selected.values;
    if (!values.length) {
      target.textContent=selected.filtered && selected.total ? 'No '+name+' estimates match the '+selected.other+' x limits.'
        : lambda ? 'No physical wavelength estimates across the EUV doses yet.'
        : selected.unavailable ? 'Gap unavailable for the saved comparisons.' : 'No physical gap estimates across the EUV doses yet.';
      return;
    }
    const minimum=Math.min(...values), maximum=Math.max(...values);
    const width=options.bin.trim() ? Number(options.bin) : lambda ? .1 : niceStep(Math.max(1,(maximum-minimum)/15));
    if (!(Number.isFinite(width) && width>0)) {target.textContent='Enter a positive bin size, or leave it empty for Auto.';return;}
    const indexFor=value=>{
      const scaled=value/width,nearest=Math.round(scaled);
      return Math.abs(scaled-nearest)<=Number.EPSILON*8*Math.max(1,Math.abs(scaled)) ? nearest : Math.floor(scaled);
    };
    const counts=new Map();
    for (const value of values) {
      const index=indexFor(value);
      if (!Number.isSafeInteger(index)) {target.textContent='Bin size is too small for these values.';return;}
      counts.set(index,(counts.get(index)||0)+1);
    }
    const indices=[...counts.keys()], first=Math.min(...indices),last=Math.max(...indices),span=Math.max(4,last-first+1);
    const lowIndex=Math.max(0,first-Math.floor((span-(last-first+1))/2));
    if (!Number.isSafeInteger(lowIndex+span)) {target.textContent='Bin size is too small for these values.';return;}
    let low=lowIndex*width, high=(lowIndex+span)*width;
    const minSet=options.min.trim()!=='' , maxSet=options.max.trim()!=='';
    const minLimit=minSet?Number(options.min):null, maxLimit=maxSet?Number(options.max):null;
    if ((minSet && !Number.isFinite(minLimit)) || (maxSet && !Number.isFinite(maxLimit))) {
      target.textContent='Enter valid x limits, or leave them empty for Auto.';return;
    }
    const autoSpan=high-low;
    if (minSet) low=minLimit;
    if (maxSet) high=maxLimit;
    if (minSet && !maxSet && low>=high) high=low+autoSpan;
    if (maxSet && !minSet && high<=low) low=high-autoSpan;
    if (!(Number.isFinite(low) && Number.isFinite(high) && high>low && Number.isFinite(high-low))) {
      target.textContent='X minimum must be smaller than x maximum.';return;
    }
    const edge=index=>formatNumber(index*width,width), range=high-low;
    const extent=index=>{
      const binLeft=index*width,binRight=(index+1)*width,left=Math.max(low,binLeft),right=Math.min(high,binRight);
      const tolerance=Number.EPSILON*16*Math.max(1,Math.abs(left),Math.abs(right),Math.abs(binLeft),Math.abs(binRight));
      const leftClipped=left>binLeft+tolerance, rightClipped=right<binRight-tolerance;
      return {left,right,partial:leftClipped || rightClipped,
        label:(leftClipped?String(Number(left.toPrecision(12))):edge(index))+'–'+
          (rightClipped?String(Number(right.toPrecision(12))):edge(index+1))};
    };
    const ordered=[...counts.entries()].filter(([index])=>{const part=extent(index);return part.right>part.left;}).sort((a,b)=>a[0]-b[0]);
    const peak=Math.max(0,...ordered.map(([,count])=>count));
    const customY=options.ymax.trim()!=='';
    const yMax=customY?Number(options.ymax):Math.max(1,peak);
    if (!(Number.isFinite(yMax) && yMax>0)) {target.textContent='Enter a positive y maximum, or leave it empty for Auto.';return;}
    const plot=svg('svg',{viewBox:'0 0 220 94',role:'img',
      'aria-label':titleText+' histogram in '+width+' '+unit+' bins: '+ordered.map(([index,count])=>edge(index)+' to '+edge(index+1)+' '+unit+': '+count).join(', ')},target);
    const text=(x,y,value,anchor)=>{svg('text',{x,y,'text-anchor':anchor,'font-size':10,fill:'currentColor'},plot).textContent=value;};
    text(21,14,customY?String(yMax):peak,'end');text(21,70,0,'end');
    svg('path',{d:'M25 10v57h186',fill:'none',stroke:'currentColor'},plot);
    for (const [index,count] of ordered) {
      const {left,right,partial,label}=extent(index),x=25+186*(left-low)/range,barWidth=186*(right-left)/range;
      const space=Math.min(2,barWidth*.15),h=56*Math.min(count,yMax)/yMax;
      const bar=svg('rect',{x:x+space/2,y:67-h,width:barWidth-space,height:h,fill:lambda?'#87b8c2':'#b7cf91'},plot);
      svg('title',{},bar).textContent=edge(index)+'–'+edge(index+1)+' '+unit+' · '+count+
        (partial?' · visible '+label:'')+(count>yMax?' · clipped at y max '+yMax:'');
    }
    // Retain small bin-boundary ticks when they are far enough apart to read.
    const firstEdge=Math.ceil(low/width),lastEdge=Math.floor(high/width);
    if (186*width/range>=3 && Number.isSafeInteger(firstEdge) && Number.isSafeInteger(lastEdge) && lastEdge-firstEdge<250) {
      for (let edgeIndex=firstEdge;edgeIndex<=lastEdge;edgeIndex++) {
        const x=25+186*(edgeIndex*width-low)/range;
        svg('path',{d:'M'+x+' 67v2',stroke:'currentColor'},plot);
      }
    }
    const tickStep=niceStep(range/5),firstTick=Math.ceil(low/tickStep),lastTick=Math.floor(high/tickStep);
    for (let tick=firstTick;tick<=lastTick && tick-firstTick<10;tick++) {
      const value=tick*tickStep,x=25+186*(value-low)/range;
      svg('path',{d:'M'+x+' 67v4',stroke:'currentColor'},plot);text(x,81,formatNumber(value,tickStep),'middle');
    }
    text(118,93,(lambda?'λ':'g')+' ('+unit+')','middle');
    const noun=lambda?'wavelength estimate':'gap estimate';
    const visible=values.filter(value=>value>=low && value<high).length;
    let status=(minSet||maxSet ? visible+' of '+values.length+' '+noun+'s in range'
      : selected.filtered ? values.length+' of '+selected.total+' '+noun+'s' : values.length+' '+noun+(values.length===1?'':'s'))+
      ' · '+String(Number(width.toPrecision(12)))+' '+unit+' bins';
    if (selected.filtered) status+=' · filtered by '+selected.other;
    if (peak>yMax) status+=' · bars clipped';
    if (!lambda && selected.unavailable) status+=' · '+selected.unavailable+' unavailable';
    target.append(document.createTextNode(status));
  }
  function close(restoreFocus=false) {
    if (!active) return;
    const previous=gears[active]; active=null;dialog.hidden=true;
    for (const gear of Object.values(gears)) gear.setAttribute('aria-expanded','false');
    if (restoreFocus) previous.focus({preventScroll:true});
  }
  function position() {
    if (!active) return;
    const anchor=gears[active].getBoundingClientRect();
    if (!anchor.width && !anchor.height) {close();return;}
    if (window.OM11PopupDrag?.restore(dialog)) return;
    const box=dialog.getBoundingClientRect(), margin=8;
    let left=anchor.left-box.width-margin;
    if (left<margin) left=anchor.right+margin;
    dialog.style.left=Math.max(margin,Math.min(left,window.innerWidth-box.width-margin))+'px';
    dialog.style.top=Math.max(margin,Math.min(anchor.top,window.innerHeight-box.height-margin))+'px';
  }
  function open(name) {
    if (active===name) {close();return;}
    active=name;dialog.hidden=false;
    for (const [key,gear] of Object.entries(gears)) gear.setAttribute('aria-expanded',String(key===name));
    const unit=name==='wavelength'?'nm':'µm';
    title.textContent=(name==='wavelength'?'Wavelength':'Gap')+' histogram';
    binLabel.textContent='Bin size ('+unit+')';limitsLabel.textContent='X limits ('+unit+')';
    filterOther.checked=state[name].filterOther;
    filterLabel.textContent='Filter '+(name==='wavelength'?'gap':'wavelength')+' histogram by these x limits';
    controls.min.setAttribute('aria-label','Histogram x minimum in '+unit);
    controls.max.setAttribute('aria-label','Histogram x maximum in '+unit);
    for (const key of Object.keys(controls)) controls[key].value=state[name][key];
    position();if (active) controls.bin.focus({preventScroll:true});
  }
  for (const name of Object.keys(gears)) gears[name].addEventListener('click',()=>open(name));
  closeButton.addEventListener('click',()=>close(true));
  for (const [key,control] of Object.entries(controls)) control.addEventListener('input',()=>{
    if (!active) return;
    state[active][key]=control.value;save();draw('wavelength');draw('gap');
  });
  filterOther.addEventListener('change',()=>{
    if (!active) return;
    state[active].filterOther=filterOther.checked;save();draw('wavelength');draw('gap');
  });
  const inside=target=>dialog.contains(target) || Object.values(gears).some(gear=>gear.contains(target));
  document.addEventListener('pointerdown',event=>{if (active && !inside(event.target)) close();},true);
  document.addEventListener('focusin',event=>{if (active && !inside(event.target)) close();});
  document.addEventListener('keydown',event=>{
    if (active && event.key==='Escape') {event.preventDefault();event.stopPropagation();close(true);}
  });
  document.addEventListener('scroll',position,true);
  window.addEventListener('resize',position);
  return {render(results) {
    data=results.map(row=>({wavelength:row.wavelength,gap:row.gap}));
    draw('wavelength');draw('gap');
  }};
};

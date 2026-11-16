/* First-order wavelength values and a compact, automatically binned histogram. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ViewerWavelengthHistogram=api;})(globalThis,function(){
  'use strict';
  function parseImages(text,count){
    const input=String(text??'').trim();if(!input)return null;
    const numbers=new Set();for(const part of input.split(',')){
      const match=/^\s*(\d+)\s*(?:[-–]\s*(\d+)\s*)?$/.exec(part);if(!match)throw new Error('Enter image numbers and ranges, for example 1, 4, 6-11.');
      const first=Number(match[1]),last=match[2]===undefined?first:Number(match[2]);
      if(!Number.isSafeInteger(first)||!Number.isSafeInteger(last)||first<1||last<first||last>count)throw new Error(`Use ascending image numbers from 1 to ${count}.`);
      for(let n=first;n<=last;n++)numbers.add(n);
    }return numbers;
  }
  const numericOrNull=value=>Number.isFinite(value)?value:null;
  function combinationKey(pitch,dose){return JSON.stringify([numericOrNull(pitch),numericOrNull(dose)]);}
  function combinations(gratings){
    const unique=new Map();for(const g of gratings){const pitch=numericOrNull(g.effectivePitch??g.pitch),dose=numericOrNull(g.dose),key=combinationKey(pitch,dose);unique.set(key,{key,pitch,dose});}
    const values=[...unique.values()].sort((a,b)=>(a.pitch??Infinity)-(b.pitch??Infinity)||(a.dose??Infinity)-(b.dose??Infinity));
    const levels=new Map();for(const v of values)if(v.dose!==null){if(!levels.has(v.pitch))levels.set(v.pitch,[]);levels.get(v.pitch).push(v.dose);}
    for(const value of values){const options=levels.get(value.pitch)||[],pitch=value.pitch===null?'Pitch unknown':`${value.pitch} nm`;let dose;
      if(value.dose===null)dose='e-dose unknown';else dose=`e${options.indexOf(value.dose)}`;
      value.label=`${pitch} · ${dose}`;
    }return values;
  }
  function matchesFilters(pair,filters){
    return (filters.order==='all'||Number(filters.order)===pair.order)&&(filters.side==='all'||filters.side===pair.side)&&!filters.excluded.has(combinationKey(pair.pitch,pair.electronDose));
  }
  function wavelengths(pairs,gapUm){
    if(!Number.isFinite(gapUm)||gapUm<=0)return [];
    return pairs.filter(p=>Number.isFinite(p.distanceUm)&&p.distanceUm>=0&&Number.isFinite(p.pitch)&&p.pitch>0)
      .map(p=>p.pitch*p.distanceUm/Math.hypot(gapUm,p.distanceUm));
  }
  function bins(values,requestedWidth=null){
    if(requestedWidth!==null&&(!(Number.isFinite(requestedWidth))||requestedWidth<=0))throw new Error('Bin width must be a positive number.');
    values=values.filter(Number.isFinite);if(!values.length)return null;
    if(requestedWidth!==null){
      const width=requestedWidth,smallest=Math.min(...values),largest=Math.max(...values),quotient=smallest/width;
      if(!Number.isFinite(quotient)||Math.abs(quotient)>Number.MAX_SAFE_INTEGER/2)throw new Error('Bin width is too small for these wavelengths.');
      const tolerance=Math.max(1,Math.abs(quotient),Math.abs(largest/width))*Number.EPSILON*8,first=Math.floor(quotient+tolerance),min=first*width,position=(largest-min)/width;
      const n=Math.floor(position+tolerance)+1;
      if(!Number.isSafeInteger(n)||n<1||n>1000)throw new Error('Bin width is too small: more than 1,000 bins would be needed.');
      const counts=Array(n).fill(0);for(const value of values){const index=(value-min)/width;counts[Math.max(0,Math.min(n-1,Math.floor(index+tolerance)))]++;}
      return {min,max:min+n*width,width,counts};
    }
    let min=Math.min(...values),max=Math.max(...values),span=max-min;
    if(span===0){const pad=Math.max(Math.abs(min)*.025,.01);min=Math.max(0,min-pad);max+=pad;span=max-min;}
    else {const pad=span*.025;min=Math.max(0,min-pad);max+=pad;span=max-min;}
    const n=Math.max(1,Math.min(25,Math.ceil(Math.sqrt(values.length)))),counts=Array(n).fill(0),width=span/n;
    for(const value of values)counts[Math.max(0,Math.min(n-1,Math.floor((value-min)/width)))]++;
    return {min,max,width,counts};
  }
  function statistics(values){
    const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b),n=sorted.length;if(!n)return null;
    const mean=sorted.reduce((a,b)=>a+b,0)/n,median=n%2?sorted[(n-1)/2]:(sorted[n/2-1]+sorted[n/2])/2;
    const sd=n>1?Math.sqrt(sorted.reduce((sum,value)=>sum+(value-mean)**2,0)/(n-1)):null;
    return {mean,median,sd};
  }
  function niceAxis(min,max,target=5,integer=false){
    if(!Number.isFinite(min)||!Number.isFinite(max))return null;if(max<min)[min,max]=[max,min];if(max===min){const padding=Math.max(Math.abs(min)*.01,integer?1:.001);min-=padding;max+=padding;}
    const raw=(max-min)/target,power=10**Math.floor(Math.log10(raw)),ratio=raw/power;
    const factor=ratio<=1?1:ratio<=2.5?2.5:ratio<=5?5:10;
    let step=Math.max(integer?1:0,factor*power);if(integer&&!Number.isInteger(step))step=5*10**Math.floor(Math.log10(step));
    const lower=Math.floor(min/step+1e-10)*step,upper=Math.ceil(max/step-1e-10)*step,count=Math.round((upper-lower)/step);
    const ticks=Array.from({length:count+1},(_,i)=>Number((lower+i*step).toPrecision(14)));
    return {min:ticks[0],max:ticks.at(-1),step,ticks};
  }
  function formatTick(value,step){
    if(Math.abs(value)<step*1e-8)value=0;let places=0;while(places<10&&Math.abs(step*10**places-Math.round(step*10**places))>1e-7)places++;
    if(Math.abs(value)>=1e8||(value!==0&&Math.abs(value)<1e-6))return value.toExponential(2).replace(/\.00e/,'e');
    return Number(value.toFixed(places)).toString();
  }
  function draw(container,values,width=null){
    container.replaceChildren();const chart=bins(values,width);if(!chart)return;
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 320 230');svg.setAttribute('role','img');svg.setAttribute('aria-label',`Wavelength histogram, ${values.length} measurements`);
    const add=(tag,attrs,text,parent=svg)=>{const e=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);if(text!==undefined)e.textContent=text;parent.append(e);return e;};
    const x=38,y=12,w=268,h=170,peak=Math.max(...chart.counts),xAxis=niceAxis(chart.min,chart.max),yAxis=niceAxis(0,Math.max(1,peak),4,true),X=v=>x+(v-xAxis.min)*w/(xAxis.max-xAxis.min);
    add('line',{x1:x,y1:y+h,x2:x+w,y2:y+h,class:'wavelength-axis'});add('line',{x1:x,y1:y,x2:x,y2:y+h,class:'wavelength-axis'});
    for(let i=0;i<chart.counts.length;i++){const count=chart.counts[i],left=X(chart.min+i*chart.width),right=X(chart.min+(i+1)*chart.width),bar=add('rect',{x:left+(right-left>4?1:0),y:y+h-h*count/yAxis.max,width:Math.max(.3,right-left-(right-left>4?2:0)),height:h*count/yAxis.max,class:'wavelength-bar'});add('title',{},`${formatTick(chart.min+i*chart.width,chart.width)}–${formatTick(chart.min+(i+1)*chart.width,chart.width)} nm: ${count}`,bar);}
    for(const value of xAxis.ticks)add('text',{x:X(value),y:y+h+16,'text-anchor':'middle',class:'wavelength-tick'},formatTick(value,xAxis.step));
    add('text',{x:2,y:9,class:'wavelength-tick'},'Count');for(const value of yAxis.ticks)add('text',{x:x-6,y:y+h-h*value/yAxis.max+3,'text-anchor':'end',class:'wavelength-tick'},formatTick(value,yAxis.step));
    add('text',{x:x+w/2,y:224,'text-anchor':'middle',class:'wavelength-axis-label'},'Wavelength (nm)');container.append(svg);
  }
  function gapSensitivity(pairs,gapUm,range=50){
    if(!(Number.isFinite(range)&&range>0))throw new Error('Gap error range must be a positive number.');
    if(!pairs.length||!Number.isFinite(gapUm)||gapUm<=0)return [];
    const valid=pairs.filter(p=>Number.isFinite(p.distanceUm)&&p.distanceUm>=0&&Number.isFinite(p.pitch)&&p.pitch>0);if(!valid.length)return [];
    return Array.from({length:101},(_,i)=>{const offset=range*(i-50)/50,gap=gapUm+offset;if(gap<=0)return {offset,mean:null,sd:null};let n=0,mean=0,m2=0;for(const p of valid){const value=p.pitch*p.distanceUm/Math.hypot(gap,p.distanceUm),delta=value-mean;mean+=delta/++n;m2+=delta*(value-mean);}return {offset,mean,sd:n>1?Math.sqrt(m2/(n-1)):null};});
  }
  function drawGap(container,points){
    container.replaceChildren();const usable=points.filter(p=>Number.isFinite(p.mean));if(!usable.length)return;
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 320 230');svg.setAttribute('role','img');svg.setAttribute('aria-label','Mean wavelength and sample standard deviation versus gap change');
    const add=(tag,attrs,text)=>{const e=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);if(text!==undefined)e.textContent=text;svg.append(e);return e;};
    const bounds=usable.flatMap(p=>p.sd===null?[p.mean]:[p.mean-p.sd,p.mean+p.sd]);let lo=Math.min(...bounds),hi=Math.max(...bounds);const padding=(hi-lo)*.04||Math.max(Math.abs(lo)*.01,.001);lo-=padding;hi+=padding;
    const range=Math.max(...points.map(p=>Math.abs(p.offset))),axis=niceAxis(lo,hi,4),xAxis=niceAxis(-range,range,4),x0=48,y0=20,w=257,h=160,X=v=>x0+(v+range)*w/(2*range),Y=v=>y0+h-(v-axis.min)*h/(axis.max-axis.min);
    for(const offset of xAxis.ticks.filter(v=>v>=-range-Math.abs(range)*1e-10&&v<=range+Math.abs(range)*1e-10)){const x=X(offset);add('line',{x1:x,y1:y0,x2:x,y2:y0+h,class:'gap-grid'});add('text',{x,y:y0+h+16,'text-anchor':'middle',class:'wavelength-tick'},formatTick(offset,xAxis.step));}
    for(const value of axis.ticks){const y=Y(value);add('line',{x1:x0,y1:y,x2:x0+w,y2:y,class:'gap-grid'});add('text',{x:x0-5,y:y+3,'text-anchor':'end',class:'wavelength-tick'},formatTick(value,axis.step));}
    add('line',{x1:x0,y1:y0+h,x2:x0+w,y2:y0+h,class:'wavelength-axis'});add('line',{x1:x0,y1:y0,x2:x0,y2:y0+h,class:'wavelength-axis'});
    add('text',{x:x0,y:10,class:'wavelength-tick'},'Wavelength (nm)');add('text',{x:x0+w/2,y:223,'text-anchor':'middle',class:'wavelength-axis-label'},'Gap change from set gap (µm)');
    add('line',{x1:X(0),y1:y0,x2:X(0),y2:y0+h,class:'gap-nominal'});
    if(usable.every(p=>Number.isFinite(p.sd))){const upper=usable.map(p=>`${X(p.offset)},${Y(p.mean+p.sd)}`),lower=[...usable].reverse().map(p=>`${X(p.offset)},${Y(p.mean-p.sd)}`);add('polygon',{points:[...upper,...lower].join(' '),class:'gap-band'});}
    add('polyline',{points:usable.map(p=>`${X(p.offset)},${Y(p.mean)}`).join(' '),class:'gap-mean'});container.append(svg);
  }
  return {parseImages,combinationKey,combinations,matchesFilters,wavelengths,bins,statistics,niceAxis,draw,gapSensitivity,drawGap};
});

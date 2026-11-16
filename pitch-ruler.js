/* Row heights are defined once in the aligned crop. Project their boundaries
 * onto the visible edges of either view, including the reversed Image019. */
'use strict';
(() => {
  const mask = window.OM10_MASK, root = document.getElementById('pitch-ruler');
  function node(tag) {
    const n = document.createElementNS('http://www.w3.org/2000/svg', tag); root.append(n); return n;
  }
  const rails = [1,-1].map(sign => ({sign, ticks:node('path'), labels:mask.rows.map(row => {
    const n=node('text'); n.textContent=row.pitchNm+' nm'; n.setAttribute('text-anchor',sign===1?'start':'end'); return n;
  })}));
  window.renderPitchRuler = (viewport, frame, scale, dx, dy) => {
    if(mask.rows.length<2)return;
    const centres = mask.rows.map((_, i) => .5 + (mask.referenceZeroCentresCrop[2*i][1] + mask.referenceZeroCentresCrop[2*i+1][1])/2);
    const last=centres.length-1;
    const bounds=[centres[0]-(centres[1]-centres[0])/2,
      ...centres.slice(1).map((y,i)=>(y+centres[i])/2),
      centres[last]+(centres[last]-centres[last-1])/2];
    const side=window.OM10Session?.get('pictureSide','top') === 'bottom' ? 'bottom' : 'top';
    const selected=mask.visiblePitchesBySide?.[side],visiblePitches=selected ? new Set(selected) : null;
    const w=viewport.clientWidth,h=viewport.clientHeight;
    const x0=(w-frame.width*scale)/2+dx, y0=(h-frame.height*scale)/2+dy;
    const left=Math.max(0,x0),right=Math.min(w,x0+frame.width*scale);
    const top=Math.max(0,y0),bottom=Math.min(h,y0+frame.height*scale);
    const matrix=window.GratingGeometry.viewMatrix(frame.entry, frame.view==='original'?'cropped':'original');
    const [a,b,c]=matrix[1]; // cropY = a*viewX + b*viewY + c
    for(const {sign,ticks,labels} of rails) {
      const x=sign===1?left+2:right-2;
      const ys=bounds.map(y=>y0+scale*(y-a*(x-x0)/scale-c)/b);
      ticks.setAttribute('d',right-left<60?'':ys.filter(y=>y>=top&&y<=bottom).map(y=>'M'+x+' '+y+'h'+(sign*7)).join(' '));
      labels.forEach((n,i)=>{
        const lo=Math.max(top,Math.min(ys[i],ys[i+1])),hi=Math.min(bottom,Math.max(ys[i],ys[i+1]));
        const visible=(!visiblePitches || visiblePitches.has(mask.rows[i].pitchNm)) && hi-lo>=13 && right-left>=60;
        n.style.display=visible?'':'none';
        if(visible){ n.setAttribute('x',x+sign*3); n.setAttribute('y',(lo+hi)/2+3.5); }
      });
    }
  };
})();

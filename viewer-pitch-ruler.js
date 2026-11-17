/* Pitch and electron-dose rows projected onto the edges of the displayed image. */
'use strict';
(()=>{
  const root=document.getElementById('pitch-ruler'),legacy=window.renderPitchRuler,ns='http://www.w3.org/2000/svg';
  window.renderPitchRuler=(viewport,frame,scale,dx,dy)=>{
    const data=window.OM10_DATA,entry=frame.entry;if(!data.importedProject)return legacy(viewport,frame,scale,dx,dy);
    root.replaceChildren();if(!data.maskDesign||!entry.alignment||entry.alignment.translationSource==='centered'||!entry.hasCalibration)return;
    const doses=new Map();for(const spot of data.maskDesign.spots.values()){const g=spot.grating,p=g.effectivePitch??g.pitch;if(!Number.isFinite(p)||!Number.isFinite(g.dose))continue;if(!doses.has(p))doses.set(p,new Set());doses.get(p).add(g.dose);}
    const grates=new Map();for(const group of window.ViewerMask.forImage(data.maskDesign,entry).groups)for(const spot of group.spots)grates.set(spot.grating.id,spot.grating);
    const rows=[];for(const g of grates.values()){
      if(!Number.isFinite(g.y))continue;const pitch=g.effectivePitch??g.pitch,variants=[...(doses.get(pitch)||[])].sort((a,b)=>a-b),variant=variants.length>1?(variants.indexOf(g.dose)<0?'e?':'e'+variants.indexOf(g.dose)):'',label=(Number.isFinite(pitch)?pitch+' nm':'Pitch unknown')+(variant?' · '+variant:'');
      const size=g.height||0;let row=rows.find(r=>r.label===label&&r.windowIndex===g.windowIndex&&Math.abs(r.y-g.y)<(size>0&&r.size>0?Math.min(5,Math.min(size,r.size)*.1):1e-6));if(!row)rows.push({label,y:g.y,size,windowIndex:g.windowIndex});
    }
    rows.sort((a,b)=>b.y-a.y||a.label.localeCompare(b.label));if(!rows.length)return;
    const pixel=entry.alignment.alignedPixelUm??entry.pixelSizeUm,origin=entry.alignment.originCropY??entry.cropHeight/2,centres=rows.map(r=>origin-r.y/pixel),half=r=>Math.max(1,(r.size||pixel*20)/(2*pixel));
    const bounds=centres.length===1?[centres[0]-half(rows[0]),centres[0]+half(rows[0])]:[centres[0]-(centres[1]-centres[0])/2,...centres.slice(1).map((y,i)=>(y+centres[i])/2),centres.at(-1)+(centres.at(-1)-centres.at(-2))/2];
    const w=viewport.clientWidth,h=viewport.clientHeight,x0=(w-frame.width*scale)/2+dx,y0=(h-frame.height*scale)/2+dy;
    const matrix=window.GratingGeometry.viewMatrix(entry,frame.view==='original'?'cropped':'original'),[a,b,c]=matrix[1];
    if(Math.abs(b)>1e-9){
      const x=2,ys=bounds.map(y=>y0+scale*(y-a*(x-x0)/scale-c)/b);
      rows.forEach((row,i)=>{const lo=Math.max(0,Math.min(ys[i],ys[i+1])),hi=Math.min(h,Math.max(ys[i],ys[i+1]));if(hi-lo<13)return;const text=document.createElementNS(ns,'text');text.textContent=row.label;text.dataset.ruler='left';text.setAttribute('text-anchor','start');text.setAttribute('x','5');text.setAttribute('y',(lo+hi)/2+3.5);root.append(text);});
    }
    // Identify left/right within each physical grating row, using the whole mask
    // even when this image's zone includes only one of the two gratings.
    const allGratings=new Map();for(const spot of data.maskDesign.spots.values())allGratings.set(spot.grating.id,spot.grating);
    function side(g){
      const neighbours=[...allGratings.values()].filter(o=>o.windowIndex===g.windowIndex&&Number.isFinite(o.x)&&Number.isFinite(o.y)&&Math.abs(o.y-g.y)<=Math.min(5,(g.height||50)*.1));
      const xs=[...new Set(neighbours.map(o=>o.x))].sort((u,v)=>u-v);if(xs.length!==2)return '';
      return Math.abs(g.x-xs[0])<=Math.abs(g.x-xs[1])?'L':'R';
    }
    const groups=window.ViewerMask.forImage(data.maskDesign,entry).groups,positions=new Map();
    for(const group of groups){
      if(!window.ViewerSpotPlacement.placement(entry,group).rect)continue;
      const labels=group.spots.map(spot=>side(spot.grating)+(spot.kind==='zero'?'0':spot.kind==='minus'?'−1':'+1'));
      const sides=group.spots.map(spot=>side(spot.grating));const label=group.spots.length===2&&sides.includes('L')&&sides.includes('R')?'LR±1':[...new Set(labels)].join('/');
      const cropX=entry.cropWidth/2+group.spots.reduce((sum,spot)=>sum+spot.x,0)/group.spots.length/pixel;
      if(!positions.has(label))positions.set(label,[]);positions.get(label).push(cropX);
    }
    const [ax,bx,tx]=matrix[0];if(Math.abs(ax)>1e-9){
      const projected=[...positions].map(([label,xs])=>({label,x:x0+scale*((xs.reduce((a,v)=>a+v,0)/xs.length-bx*(2-y0)/scale-tx)/ax)})).filter(p=>p.x>=8&&p.x<=w-8).sort((a,b)=>a.x-b.x);
      let lastRight=-Infinity,lane=0;for(const p of projected){const width=p.label.length*6;if(p.x-width/2<lastRight+5)lane=1-lane;else lane=0;lastRight=p.x+width/2;
        const text=document.createElementNS(ns,'text');text.dataset.ruler='top';text.textContent=p.label;text.setAttribute('text-anchor','middle');text.setAttribute('x',p.x);text.setAttribute('y',lane?29:17);root.append(text);
      }
    }

  };
})();

/* Fit the visible union boundary, then apply the same adjustment to both spots. */
'use strict';
(() => {
  const U=typeof module!=='undefined' && module.exports ? require('./rectangle-union.js') : window.OM10RectangleUnion;
  const fitSide=typeof module!=='undefined' && module.exports ? require('./rectangle-snap.js').side : window.fitRectangleToCanny.side;
  const dot=(a,b)=>a.x*b.x+a.y*b.y;

  function fitPair(a,b,mode,fraction,width,height,black) {
    if (!(fraction>0 && fraction<=1)) return null;
    const boundary=U.pairBoundary(a,b,fraction);
    if (!boundary) return null;
    const hits=[];
    for (const side of boundary.segments) {
      const fit=fitSide(side,1,width,height,black,mode);
      if (fit) hits.push({side,fit});
    }
    if (!hits.length) return null;
    const {bounds,origin,u,v,angle}=boundary;
    const present=new Set(hits.map(hit=>hit.side.side));
    // As for a single rectangle, do not rotate when an outer side is unsupported.
    const totalWeight=hits.reduce((sum,hit)=>sum+hit.fit.weight,0);
    const rotation=present.size===4 && totalWeight ? hits.reduce((sum,hit)=>sum+hit.fit.delta*hit.fit.weight,0)/totalWeight : 0;
    const middle={x:(bounds.left+bounds.right)/2,y:(bounds.top+bounds.bottom)/2};
    const centre={x:origin.x+middle.x*u.x+middle.y*v.x,y:origin.y+middle.x*u.y+middle.y*v.y};
    const shifts={};
    for (const name of ['left','right','top','bottom']) {
      let weighted=0, weight=0;
      for (const {side,fit} of hits) if (side.side===name) {
        const normal={x:-side.uy,y:side.ux}, direction=name==='left'||name==='right' ? u : v;
        const projection=dot(normal,direction);
        if (Math.abs(projection)<.5) continue;
        const relative={x:side.x-centre.x,y:side.y-centre.y};
        const rotationOffset=rotation*dot(normal,{x:-relative.y,y:relative.x});
        weighted+=(fit.offset-rotationOffset)/projection*fit.count;
        weight+=fit.count;
      }
      shifts[name]=weight ? weighted/weight : 0;
    }
    const next={left:bounds.left+shifts.left,right:bounds.right+shifts.right,
      top:bounds.top+shifts.top,bottom:bounds.bottom+shifts.bottom};
    const originalWidth=bounds.right-bounds.left, originalHeight=bounds.bottom-bounds.top;
    const nextWidth=next.right-next.left, nextHeight=next.bottom-next.top;
    if (nextWidth<1 || nextHeight<1) return null;
    const sx=nextWidth/originalWidth, sy=nextHeight/originalHeight;
    const newMiddle={x:(next.left+next.right)/2,y:(next.top+next.bottom)/2};
    const newCentre={x:origin.x+newMiddle.x*u.x+newMiddle.y*v.x,y:origin.y+newMiddle.x*u.y+newMiddle.y*v.y};
    const c=Math.cos(angle+rotation), s=Math.sin(angle+rotation);
    const baseline=[a,b].map(rect=>{
      const p={x:rect.cx-centre.x,y:rect.cy-centre.y};
      const x=dot(p,u)*sx, y=dot(p,v)*sy;
      const relative=rect.angle-angle, cw=Math.cos(relative)**2, sw=Math.sin(relative)**2;
      // Rectangles retain perpendicular sides even if their original angles differ.
      return {...rect,cx:newCentre.x+c*x-s*y,cy:newCentre.y+s*x+c*y,
        width:rect.width*(sx*cw+sy*sw),height:rect.height*(sx*sw+sy*cw),
        angle:Math.atan2(Math.sin(rect.angle+rotation),Math.cos(rect.angle+rotation))};
    });
    // A shared move/scale carries the unobservable interior edges along. Then
    // each measured exterior segment is put on its own detected line, so a
    // stepped union can fit an underlying straight boundary as well.
    const result=baseline.map((rect,owner)=>{
      const c=Math.cos(rect.angle),s=Math.sin(rect.angle);
      const limits={left:-rect.width/2,right:rect.width/2,top:-rect.height/2,bottom:rect.height/2};
      for (const name of ['left','right','top','bottom']) {
        let sum=0, weight=0;
        for (const hit of hits) if (hit.side.owner===owner && hit.side.edge===name) {
          const dx=hit.fit.x-rect.cx,dy=hit.fit.y-rect.cy;
          const position=name==='left'||name==='right' ? dx*c+dy*s : -dx*s+dy*c;
          sum+=position*hit.fit.count; weight+=hit.fit.count;
        }
        if (weight) limits[name]=sum/weight;
      }
      const width=limits.right-limits.left,height=limits.bottom-limits.top;
      if (width<1 || height<1) return null;
      const dx=(limits.left+limits.right)/2,dy=(limits.top+limits.bottom)/2;
      return {...rect,cx:rect.cx+c*dx-s*dy,cy:rect.cy+s*dx+c*dy,width,height};
    });
    if (result.some(rect=>!rect)) return null;
    return {rects:result,supportedSides:[...present]};
  }
  if (typeof module!=='undefined' && module.exports) module.exports=fitPair;
  else window.fitRectanglePairToCanny=fitPair;
})();

/* Visible boundary segments of two overlapping, rotated rectangles in raw pixels. */
'use strict';
(() => {
  const axis=angle=>({x:Math.cos(angle),y:Math.sin(angle)});
  const dot=(a,b)=>a.x*b.x+a.y*b.y;
  const turn=(p,angle)=>({x:p.x*Math.cos(angle)-p.y*Math.sin(angle),y:p.x*Math.sin(angle)+p.y*Math.cos(angle)});
  function overlaps(a,b,epsilon) {
    const au=axis(a.angle), av={x:-au.y,y:au.x}, bu=axis(b.angle), bv={x:-bu.y,y:bu.x};
    const delta={x:b.cx-a.cx,y:b.cy-a.cy};
    return [au,av,bu,bv].every(direction=>{
      const ra=a.width/2*Math.abs(dot(au,direction))+a.height/2*Math.abs(dot(av,direction));
      const rb=b.width/2*Math.abs(dot(bu,direction))+b.height/2*Math.abs(dot(bv,direction));
      return Math.abs(dot(delta,direction))<ra+rb-epsilon;
    });
  }
  function outsideSegments(rect,other,epsilon,preferred) {
    const w=rect.width/2,h=rect.height/2,ow=other.width/2,oh=other.height/2;
    const corners=[{x:-w,y:-h},{x:w,y:-h},{x:w,y:h},{x:-w,y:h}];
    const outward=[{x:0,y:-1},{x:1,y:0},{x:0,y:1},{x:-1,y:0}];
    const inOther=point=>{
      const raw=turn(point,rect.angle);
      return turn({x:raw.x+rect.cx-other.cx,y:raw.y+rect.cy-other.cy},-other.angle);
    };
    const inside=point=>Math.abs(point.x)<ow-epsilon && Math.abs(point.y)<oh-epsilon;
    const segments=[], interior=[];
    for(let edge=0;edge<4;edge++) {
      const start=corners[edge],end=corners[(edge+1)%4], a=inOther(start),b=inOther(end);
      const dx=b.x-a.x,dy=b.y-a.y, cuts=[0,1];
      if (Math.abs(dx)>epsilon) for(const x of [-ow,ow]) {const t=(x-a.x)/dx;if(t>0 && t<1)cuts.push(t);}
      if (Math.abs(dy)>epsilon) for(const y of [-oh,oh]) {const t=(y-a.y)/dy;if(t>0 && t<1)cuts.push(t);}
      cuts.sort((x,y)=>x-y);
      for(let i=0;i<cuts.length-1;i++) {
        const from=cuts[i],to=cuts[i+1];
        if (to-from<1e-12) continue;
        const middle=(from+to)/2, point={x:a.x+middle*dx,y:a.y+middle*dy};
        let internal=inside(point);
        const boundary=(Math.abs(Math.abs(point.x)-ow)<=epsilon && Math.abs(point.y)<=oh+epsilon)
          || (Math.abs(Math.abs(point.y)-oh)<=epsilon && Math.abs(point.x)<=ow+epsilon);
        if (!internal && boundary) {
          const direction=turn(outward[edge],rect.angle-other.angle), probe=16*epsilon;
          internal=inside({x:point.x+direction.x*probe,y:point.y+direction.y*probe});
          if (!internal && !preferred) continue; // The coincident outer edge is already drawn.
        }
        const collection=internal ? interior : segments;
        const segment={edge:['top','right','bottom','left'][edge],
          x1:start.x+(end.x-start.x)*from,y1:start.y+(end.y-start.y)*from,
          x2:start.x+(end.x-start.x)*to,y2:start.y+(end.y-start.y)*to};
        const last=collection[collection.length-1];
        if (last && last.edge===segment.edge && Math.hypot(last.x2-segment.x1,last.y2-segment.y1)<epsilon) {
          last.x2=segment.x2; last.y2=segment.y2;
        } else collection.push(segment);
      }
    }
    return {segments,interior};
  }
  function rectangleUnion(a,b) {
    if (!a || !b || ![a,b].every(r=>['cx','cy','width','height','angle'].every(k=>Number.isFinite(r[k])) && r.width>0 && r.height>0)) return null;
    const epsilon=Math.max(1e-9,Math.max(a.width,a.height,b.width,b.height)*1e-9);
    if (!overlaps(a,b,epsilon)) return null;
    const first=outsideSegments(a,b,epsilon,true), second=outsideSegments(b,a,epsilon,false);
    return {first:first.segments,second:second.segments,firstInterior:first.interior,secondInterior:second.interior};
  }
  function innerPairs(mask,items) {
    const pairs=new Map();
    for (const row of mask.rows) {
      const left=`spot-${row.id}-left-p1`, right=`spot-${row.id}-right-m1`;
      const union=rectangleUnion(items.get(left),items.get(right));
      if (union) {
        const pair={ids:[left,right],rects:[items.get(left),items.get(right)],union};
        pairs.set(left,pair); pairs.set(right,pair);
      }
    }
    return pairs;
  }
  function innerUnionPaths(mask,items) {
    const paths = new Map();
    for (const [id,pair] of innerPairs(mask,items)) {
      paths.set(id,id===pair.ids[0] ? pair.union.first : pair.union.second);
    }
    return paths;
  }
  // Project the actual union boundary into a common frame. The selected range
  // is the central fraction of the pair's overall width or height, rather than
  // a separate fraction of either rectangle's edge.
  function pairBoundary(a,b,fraction,union=rectangleUnion(a,b)) {
    if (!union || !Number.isFinite(fraction) || fraction<0 || fraction>1) return null;
    const difference=Math.atan2(Math.sin(2*(b.angle-a.angle)),Math.cos(2*(b.angle-a.angle)))/4;
    const angle=a.angle+difference, u=axis(angle), v={x:-u.y,y:u.x};
    const origin={x:(a.cx+b.cx)/2,y:(a.cy+b.cy)/2};
    const project=p=>({x:dot({x:p.x-origin.x,y:p.y-origin.y},u),y:dot({x:p.x-origin.x,y:p.y-origin.y},v)});
    const raw=(rect,x,y)=>{const p=turn({x,y},rect.angle);return {x:rect.cx+p.x,y:rect.cy+p.y};};
    const points=[];
    for (const rect of [a,b]) for (const x of [-rect.width/2,rect.width/2]) for (const y of [-rect.height/2,rect.height/2]) points.push(project(raw(rect,x,y)));
    const bounds={left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),
      top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y))};
    const extents={x:[(bounds.left+bounds.right)/2-(bounds.right-bounds.left)*fraction/2,
      (bounds.left+bounds.right)/2+(bounds.right-bounds.left)*fraction/2],
      y:[(bounds.top+bounds.bottom)/2-(bounds.bottom-bounds.top)*fraction/2,
      (bounds.top+bounds.bottom)/2+(bounds.bottom-bounds.top)*fraction/2]};
    const normals={top:{x:0,y:-1},right:{x:1,y:0},bottom:{x:0,y:1},left:{x:-1,y:0}};
    const segments=[], ticks=[[],[]], seenTicks=new Set();
    for (const [owner,parts] of [union.first,union.second].entries()) for (const part of parts) {
      const rect=[a,b][owner], p=raw(rect,part.x1,part.y1), q=raw(rect,part.x2,part.y2);
      const normal=turn(normals[part.edge],rect.angle), nx=dot(normal,u), ny=dot(normal,v);
      const side=Math.abs(nx)>Math.abs(ny) ? (nx<0?'left':'right') : (ny<0?'top':'bottom');
      const along=side==='left'||side==='right' ? 'y' : 'x';
      const p0=project(p)[along], p1=project(q)[along], [low,high]=extents[along], span=p1-p0;
      if (Math.abs(span)<1e-12) continue;
      const t0=(low-p0)/span, t1=(high-p0)/span;
      const from=Math.max(0,Math.min(t0,t1)), to=Math.min(1,Math.max(t0,t1));
      for (const t of [t0,t1]) if (t>=-1e-10 && t<=1+1e-10) {
        const tClamped=Math.max(0,Math.min(1,t));
        const x=part.x1+(part.x2-part.x1)*tClamped,y=part.y1+(part.y2-part.y1)*tClamped;
        const world=raw(rect,x,y), key=`${Math.round(world.x*1e6)},${Math.round(world.y*1e6)},${Math.round(normal.x*1e6)},${Math.round(normal.y*1e6)}`;
        if (!seenTicks.has(key)) { seenTicks.add(key); ticks[owner].push({x,y,nx:normals[part.edge].x,ny:normals[part.edge].y}); }
      }
      if (to-from<=1e-10) continue;
      const start={x:p.x+(q.x-p.x)*from,y:p.y+(q.y-p.y)*from};
      const end={x:p.x+(q.x-p.x)*to,y:p.y+(q.y-p.y)*to};
      const length=Math.hypot(end.x-start.x,end.y-start.y);
      segments.push({owner,side,edge:part.edge,x:(start.x+end.x)/2,y:(start.y+end.y)/2,
        ux:(end.x-start.x)/length,uy:(end.y-start.y)/length,length});
    }
    return {angle,origin,u,v,bounds,segments,ticks};
  }
  const api={rectangleUnion,innerPairs,innerUnionPaths,pairBoundary};
  if (typeof module!=='undefined' && module.exports) module.exports=api;
  else window.OM10RectangleUnion=api;
})();

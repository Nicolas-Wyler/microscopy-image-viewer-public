/* Rough rigid zero-order registration; coordinates are downsampled pixels. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ViewerRegistration=api;})(globalThis,function(){
  'use strict';
  function detect(pixels,width,height,model){
    if(!model.length||pixels.length!==width*height)return [];
    const sizes=model.map(p=>Math.min(p.width,p.height)).filter(x=>Number.isFinite(x)&&x>0).sort((a,b)=>a-b);if(!sizes.length)return [];
    const size=sizes[Math.floor(sizes.length/2)],radius=Math.max(3,Math.round(size*.8)),stride=width+1,integral=new Float64Array((width+1)*(height+1));
    for(let y=0;y<height;y++){let sum=0;for(let x=0;x<width;x++){sum+=pixels[y*width+x];integral[(y+1)*stride+x+1]=integral[y*stride+x+1]+sum;}}
    const high=new Float32Array(width*height);
    for(let y=0;y<height;y++){const y0=Math.max(0,y-radius),y1=Math.min(height,y+radius+1);for(let x=0;x<width;x++){const x0=Math.max(0,x-radius),x1=Math.min(width,x+radius+1);const sum=integral[y1*stride+x1]-integral[y0*stride+x1]-integral[y1*stride+x0]+integral[y0*stride+x0];high[y*width+x]=pixels[y*width+x]-sum/((x1-x0)*(y1-y0));}}
    const output=[],queue=new Int32Array(width*height);
    for(const sign of [1,-1])for(const threshold of [6,10,18]){
      const visited=new Uint8Array(width*height);
      for(let index=0;index<high.length;index++){
        if(visited[index]||sign*high[index]<threshold)continue;let head=0,tail=0,area=0,sumX=0,sumY=0,minX=width,minY=height,maxX=0,maxY=0;visited[index]=1;queue[tail++]=index;
        while(head<tail){const pos=queue[head++],x=pos%width,y=(pos/width)|0;area++;sumX+=x;sumY+=y;if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
          for(const next of [x?pos-1:-1,x+1<width?pos+1:-1,y?pos-width:-1,y+1<height?pos+width:-1])if(next>=0&&!visited[next]&&sign*high[next]>=threshold){visited[next]=1;queue[tail++]=next;}
        }
        const w=maxX-minX+1,h=maxY-minY+1;if(w<size*.48||h<size*.48||w>size*1.8||h>size*1.8||area<w*h*.36)continue;
        const x=sumX/area,y=sumY/area,quality=area/(w*h)-Math.abs(Math.log((w*h)/(size*size)))*.15;
        const existing=output.find(p=>Math.hypot(p.x-x,p.y-y)<Math.max(3,size*.15));if(!existing)output.push({x,y,width:w,height:h,quality,sign});else if(quality>existing.quality)Object.assign(existing,{x,y,width:w,height:h,quality,sign});
      }
    }
    return output.sort((a,b)=>b.quality-a.quality).slice(0,100);
  }
  function fit(model,candidates){
    if(model.length<3||candidates.length<3)return null;
    const base=model.slice(0,40),points=candidates.slice(0,80),sizes=base.map(p=>Math.min(p.width,p.height)).filter(v=>v>0).sort((a,b)=>a-b),size=sizes[Math.floor(sizes.length/2)]||20,tolerance=Math.max(3,size*.28);let best=null;
    function evaluate(angle,tx,ty){const c=Math.cos(angle),s=Math.sin(angle),edges=[];for(let i=0;i<base.length;i++){const x=c*base[i].x-s*base[i].y+tx,y=s*base[i].x+c*base[i].y+ty;for(let j=0;j<points.length;j++){const d=Math.hypot(x-points[j].x,y-points[j].y);if(d<=tolerance)edges.push({i,j,d});}}edges.sort((a,b)=>a.d-b.d);const is=new Set(),js=new Set(),matches=[];for(const e of edges)if(!is.has(e.i)&&!js.has(e.j)){is.add(e.i);js.add(e.j);matches.push(e);}if(matches.length<3)return;const rms=Math.sqrt(matches.reduce((sum,m)=>sum+m.d*m.d,0)/matches.length),score=matches.length*100-rms-Math.abs(angle)*.05;if(!best||score>best.score)best={angle,tx,ty,matches,score};}
    for(let i=0;i<base.length;i++)for(let j=i+1;j<base.length;j++){const dx=base[j].x-base[i].x,dy=base[j].y-base[i].y,d=Math.hypot(dx,dy);if(d<size*.5)continue;for(let a=0;a<points.length;a++)for(let b=0;b<points.length;b++){if(a===b)continue;const px=points[b].x-points[a].x,py=points[b].y-points[a].y;if(Math.abs(Math.hypot(px,py)-d)>tolerance*1.3)continue;let angle=Math.atan2(py,px)-Math.atan2(dy,dx);angle=Math.atan2(Math.sin(angle),Math.cos(angle));const c=Math.cos(angle),s=Math.sin(angle);evaluate(angle,points[a].x-c*base[i].x+s*base[i].y,points[a].y-s*base[i].x-c*base[i].y);}}
    if(!best||best.matches.length<Math.max(3,Math.ceil(base.length*.5)))return null;
    const n=best.matches.length;let qx=0,qy=0,px=0,py=0;for(const m of best.matches){qx+=base[m.i].x/n;qy+=base[m.i].y/n;px+=points[m.j].x/n;py+=points[m.j].y/n;}let dot=0,cross=0;for(const m of best.matches){const a=base[m.i],b=points[m.j],x=a.x-qx,y=a.y-qy,u=b.x-px,v=b.y-py;dot+=x*u+y*v;cross+=x*v-y*u;}const angle=Math.atan2(cross,dot),c=Math.cos(angle),s=Math.sin(angle),tx=px-c*qx+s*qy,ty=py-s*qx-c*qy;
    return {angle,tx,ty,matches:best.matches.map(m=>({model:base[m.i],candidate:points[m.j]}))};
  }
  return {detect,fit};
});

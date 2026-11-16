/* Shared similarity fit with a separate nuisance translation for every image. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ViewerRecalibration=api;})(globalThis,function(){
  'use strict';
  function fit(images){
    let dot=0,cross=0,denominator=0,points=0;const valid=[];
    for(const image of images){
      if(!(Number.isFinite(image.pixelSizeUm)&&image.pixelSizeUm>0))continue;
      const entries=image.points.filter(p=>[p.raw?.x,p.raw?.y,p.mask?.x,p.mask?.y].every(Number.isFinite));if(entries.length<2)continue;
      const n=entries.length,p={x:0,y:0},q={x:0,y:0};for(const v of entries){p.x+=v.raw.x*image.pixelSizeUm/n;p.y+=v.raw.y*image.pixelSizeUm/n;q.x+=v.mask.x/n;q.y+=v.mask.y/n;}
      let spread=0,localDot=0,localCross=0;for(const v of entries){const x=v.raw.x*image.pixelSizeUm-p.x,y=v.raw.y*image.pixelSizeUm-p.y,u=v.mask.x-q.x,w=v.mask.y-q.y;spread+=x*x+y*y;localDot+=x*u+y*w;localCross+=x*w-y*u;}
      if(spread<=1e-12)continue;dot+=localDot;cross+=localCross;denominator+=spread;points+=n;valid.push({entries,p,q,scale:image.pixelSizeUm});
    }
    if(!valid.length||!(denominator>1e-12))return null;const a=dot/denominator,b=cross/denominator,factor=Math.hypot(a,b),rotation=Math.atan2(b,a);if(!(Number.isFinite(factor)&&factor>0))return null;
    let sum=0;for(const {entries,p,q,scale} of valid)for(const v of entries){const x=v.raw.x*scale-p.x,y=v.raw.y*scale-p.y,u=v.mask.x-q.x,w=v.mask.y-q.y;sum+=(a*x-b*y-u)**2+(b*x+a*y-w)**2;}
    return {factor,rotation,images:valid.length,points,rmsUm:Math.sqrt(sum/points)};
  }
  function plan(images,solution,bounds){
    const valid=images.filter(im=>Number.isFinite(im.pixelSizeUm)&&im.pixelSizeUm>0&&im.width>0&&im.height>0),scales=valid.map(im=>im.pixelSizeUm*solution.factor).sort((a,b)=>a-b);if(!scales.length)return null;
    const ref=scales[Math.floor(scales.length/2)],c=Math.cos(solution.rotation),s=Math.sin(solution.rotation),maxWidth=Math.max(...valid.map(im=>im.width*im.pixelSizeUm*solution.factor/ref)),maxHeight=Math.max(...valid.map(im=>im.height*im.pixelSizeUm*solution.factor/ref));
    const cropWidth=Math.ceil(Math.max(maxWidth,2*(bounds.maxX+bounds.margin)/ref)),cropHeight=Math.max(1,Math.ceil(Math.min(maxHeight,(bounds.top-bounds.bottom+2*bounds.margin)/ref)));
    const originY=cropHeight/2+(bounds.top+bounds.bottom)/(2*ref),result=[];
    for(const im of valid){const pixelSizeUm=im.pixelSizeUm*solution.factor,ratio=pixelSizeUm/ref,chosen=im.points.length?im.points:(im.roughPoints||[]);let matrix=null;
      if(chosen.length){let tx=0,ty=0;for(const p of chosen){tx+=(cropWidth/2+p.mask.x/ref-ratio*(c*p.raw.x-s*p.raw.y))/chosen.length;ty+=(originY+p.mask.y/ref-ratio*(s*p.raw.x+c*p.raw.y))/chosen.length;}matrix=[[ratio*c,-ratio*s,tx-(1-ratio*c+ratio*s)/2],[ratio*s,ratio*c,ty-(1-ratio*s-ratio*c)/2],[0,0,1]];}
      result.push({id:im.id,pixelSizeUm,alignedPixelUm:ref,cropWidth,cropHeight,originCropY:originY,matrix,source:im.points.length?'rectangles':chosen.length?'detection':'none',count:chosen.length});
    }
    return {images:result,alignedPixelUm:ref,cropWidth,cropHeight};
  }
  return {fit,plan};
});

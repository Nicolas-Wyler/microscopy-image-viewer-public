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
  // One physical pixel size and rotation for the entire microscopy session.
  // Per-image translations are eliminated by fit() before the common fit.
  function fitShared(images){
    const result=fit(images.map(image=>({...image,pixelSizeUm:1})));
    if(!result)return null;
    const scales=images.map(image=>image.pixelSizeUm).filter(value=>Number.isFinite(value)&&value>0).sort((a,b)=>a-b);
    const reference=scales.length?scales[Math.floor(scales.length/2)]:null;
    return {...result,pixelSizeUm:result.factor,factor:reference?result.factor/reference:null};
  }
  // Rotate around the image center when no spot gives a translation. The
  // full transformed footprint is retained instead of assuming a mask origin.
  function centered(im,rotation,ref,frame=null){
    const calibrated=Number.isFinite(im.pixelSizeUm)&&im.pixelSizeUm>0;
    const ratio=calibrated?im.pixelSizeUm/ref:1,c=Math.cos(rotation),s=Math.sin(rotation),a=ratio*c,b=-ratio*s,d=ratio*s,e=ratio*c;
    const cropWidth=frame?.cropWidth??Math.max(1,Math.ceil(Math.abs(a)*im.width+Math.abs(b)*im.height)),cropHeight=frame?.cropHeight??Math.max(1,Math.ceil(Math.abs(d)*im.width+Math.abs(e)*im.height));
    const tx=cropWidth/2-a*im.width/2-b*im.height/2,ty=cropHeight/2-d*im.width/2-e*im.height/2;
    const matrix=[[a,b,tx-(1-a-b)/2],[d,e,ty-(1-d-e)/2],[0,0,1]];
    return {id:im.id,pixelSizeUm:calibrated?im.pixelSizeUm:null,alignedPixelUm:calibrated?ref:null,cropWidth,cropHeight,originCropY:frame?.originCropY??cropHeight/2,matrix,source:'centered',count:0};
  }
  function plan(images,solution,bounds){
    const valid=images.filter(im=>im.width>0&&im.height>0),shared=Number.isFinite(solution.pixelSizeUm)&&solution.pixelSizeUm>0?solution.pixelSizeUm:null,scales=(shared?[shared]:valid.filter(im=>Number.isFinite(im.pixelSizeUm)&&im.pixelSizeUm>0).map(im=>im.pixelSizeUm*solution.factor)).sort((a,b)=>a-b);if(!scales.length)return null;
    const ref=scales[Math.floor(scales.length/2)],c=Math.cos(solution.rotation),s=Math.sin(solution.rotation),calibrated=shared?valid:valid.filter(im=>Number.isFinite(im.pixelSizeUm)&&im.pixelSizeUm>0),scaleOf=im=>shared??im.pixelSizeUm*solution.factor,maxWidth=Math.max(...calibrated.map(im=>im.width*scaleOf(im)/ref)),maxHeight=Math.max(...calibrated.map(im=>im.height*scaleOf(im)/ref));
    const cropWidth=Math.ceil(Math.max(maxWidth,2*(bounds.maxX+bounds.margin)/ref)),cropHeight=Math.max(1,Math.ceil(Math.min(maxHeight,(bounds.top-bounds.bottom+2*bounds.margin)/ref)));
    const originY=cropHeight/2+(bounds.top+bounds.bottom)/(2*ref),result=[];
    for(const im of valid){const hasScale=Boolean(shared)||(Number.isFinite(im.pixelSizeUm)&&im.pixelSizeUm>0),pixelSizeUm=hasScale?scaleOf(im):null,chosen=hasScale?(im.points.length?im.points:(im.roughPoints||[])):[];
      if(!chosen.length){result.push(centered({...im,pixelSizeUm},solution.rotation,ref,{cropWidth,cropHeight,originCropY:originY}));continue;}
      const ratio=pixelSizeUm/ref;let tx=0,ty=0;for(const p of chosen){tx+=(cropWidth/2+p.mask.x/ref-ratio*(c*p.raw.x-s*p.raw.y))/chosen.length;ty+=(originY+p.mask.y/ref-ratio*(s*p.raw.x+c*p.raw.y))/chosen.length;}const matrix=[[ratio*c,-ratio*s,tx-(1-ratio*c+ratio*s)/2],[ratio*s,ratio*c,ty-(1-ratio*s-ratio*c)/2],[0,0,1]];
      result.push({id:im.id,pixelSizeUm,alignedPixelUm:ref,cropWidth,cropHeight,originCropY:originY,matrix,source:im.points.length?'rectangles':'detection',count:chosen.length});
    }
    return {images:result,alignedPixelUm:ref,cropWidth,cropHeight};
  }
  // Change only the crop frame: preserve the physical transform and move its
  // origin by the corresponding pixel offset. Shared for restored calibrations.
  function reframe(frame,bounds,pixel) {
    if(!frame?.matrix || !bounds || !(pixel>0))return frame;
    const width=Math.max(1,Math.ceil(2*(bounds.maxX+bounds.margin)/pixel));
    const height=Math.max(1,Math.ceil((bounds.top-bounds.bottom+2*bounds.margin)/pixel));
    const origin=height/2+(bounds.top+bounds.bottom)/(2*pixel);
    const dx=(width-frame.cropWidth)/2,dy=origin-frame.originCropY;
    return {...frame,cropWidth:width,cropHeight:height,originCropY:origin,matrix:frame.matrix.map((row,i)=>i<2?[row[0],row[1],row[2]+(i===0?dx:dy)]:row.slice())};
  }
  return {fit,fitShared,plan,centered,reframe};
});

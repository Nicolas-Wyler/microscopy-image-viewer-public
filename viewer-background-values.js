/* Native intensity subtraction and a fast three-box approximation to Gaussian blur. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ViewerBackgroundValues=api;})(globalThis,function(){
  'use strict';
  function blur(values,width,height,sigma){
    if(!(sigma>0))return values;
    // Three equal-area box filters approximate a Gaussian; edge samples are extended.
    const ideal=Math.sqrt(4*sigma*sigma+1), lower=Math.max(1,Math.floor(ideal/2)*2+1-2*(Math.floor(ideal/2)*2+1>ideal)), upper=lower+2;
    const nLower=Math.max(0,Math.min(3,Math.round((12*sigma*sigma-3*lower*lower-12*lower-9)/(-4*lower-4))));
    let input=values;
    for(let pass=0;pass<3;pass++){
      const radius=((pass<nLower?lower:upper)-1)/2;if(!radius)continue;
      for(const horizontal of [true,false]){
        const output=new Float32Array(width*height),length=horizontal?width:height,lines=horizontal?height:width;
        for(let line=0;line<lines;line++){
          const at=x=>horizontal?line*width+x:x*width+line;let sum=0,count=0;
          for(let j=-radius;j<=radius;j++){const v=input[at(Math.max(0,Math.min(length-1,j)))];if(Number.isFinite(v)){sum+=v;count++;}}
          for(let x=0;x<length;x++){output[at(x)]=count?sum/count:NaN;const left=input[at(Math.max(0,x-radius))],right=input[at(Math.min(length-1,x+radius+1))];if(Number.isFinite(left)){sum-=left;count--;}if(Number.isFinite(right)){sum+=right;count++;}}
        }input=output;
      }
    }return input;
  }
  function subtract(image,bg,sigma,offset){
    if(image.width!==bg.width||image.height!==bg.height)throw new Error(`Background dimensions ${bg.width} × ${bg.height} do not match image ${image.width} × ${image.height}.`);
    if(image.bitsPerSample!==bg.bitsPerSample)throw new Error(`Background bit depth (${bg.bitsPerSample}) does not match image bit depth (${image.bitsPerSample}).`);
    if(image.photometric!=null&&bg.photometric!=null&&image.photometric!==bg.photometric)throw new Error('Background and image have incompatible TIFF photometric interpretations.');
    const base=bg.smoothed?bg.values:blur(bg.values,bg.width,bg.height,sigma),values=new Float32Array(image.values.length);let max=0;
    for(let i=0;i<values.length;i++){const a=image.values[i],b=base[i],value=Number.isFinite(a)&&Number.isFinite(b)?a-b+offset:NaN;values[i]=value;if(value>max)max=value;}
    return {width:image.width,height:image.height,values,max,bitsPerSample:image.bitsPerSample,sampleFormat:image.sampleFormat};
  }
  return {blur,subtract};
});

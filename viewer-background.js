/* Assigned-reference subtraction in native TIFF sample units. */
'use strict';
window.createViewerBackground=function(){
  const cache=new Map(),pending=new Map(),blurCache=new Map();
  const settingsKey=(entry,sigma,scale,offset)=>JSON.stringify([entry.id,entry.backgroundId,sigma,scale,offset]);
  async function background(entry,sigma){
    const key=JSON.stringify([entry.backgroundId,sigma]);if(blurCache.has(key))return blurCache.get(key);
    if(!entry.backgroundFile)throw new Error('No background image is assigned.');
    const data=await window.TiffImage.values(entry.backgroundFile),result={...data,values:window.ViewerBackgroundValues.blur(data.values,data.width,data.height,sigma),smoothed:true};
    blurCache.set(key,result);while(blurCache.size>2)blurCache.delete(blurCache.keys().next().value);return result;
  }
  async function get(entry,sigma,scale,offset){
    const key=settingsKey(entry,sigma,scale,offset);if(cache.has(key)){const value=cache.get(key);cache.delete(key);cache.set(key,value);return value;}if(pending.has(key))return pending.get(key);
    const task=(async()=>{const [image,bg]=await Promise.all([window.TiffImage.values(entry.file),background(entry,sigma)]),result=window.ViewerBackgroundValues.subtract(image,bg,0,offset),pixels=new Uint8ClampedArray(image.width*image.height*4);
      for(let i=0;i<result.values.length;i++){const j=i*4,value=result.values[i];if(!Number.isFinite(value))continue;if(value<0){pixels[j]=255;pixels[j+1]=pixels[j+2]=0;}else{const linear=Math.min(1,value/(result.max||1)),shown=scale==='log'?Math.log1p(100*linear)/Math.log1p(100):linear;pixels[j]=pixels[j+1]=pixels[j+2]=Math.round(shown*255);}pixels[j+3]=255;}
      const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').putImageData(new ImageData(pixels,image.width,image.height),0,0);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('Could not render background-subtracted image.');const value={...result,url:URL.createObjectURL(blob)};cache.set(key,value);while(cache.size>3){const oldest=cache.keys().next().value;URL.revokeObjectURL(cache.get(oldest).url);cache.delete(oldest);}return value;
    })().finally(()=>pending.delete(key));pending.set(key,task);return task;
  }
  window.addEventListener('pagehide',()=>{for(const item of cache.values())URL.revokeObjectURL(item.url);cache.clear();});
  return {get,values:async(...args)=>get(...args)};
};

/* Assigned-reference subtraction in native TIFF sample units. */
'use strict';
window.createViewerBackground=function(){
  const cache=new Map(),pending=new Map(),blurCache=new Map(),valueCache=new Map(),valuePending=new Map();
  const settingsKey=(entry,sigma,scale,offset,region)=>JSON.stringify([entry.id,entry.backgroundId,sigma,scale,offset,entry.backgroundFile?null:region]);
  async function background(entry,sigma){
    const key=JSON.stringify([entry.backgroundId,sigma]);if(blurCache.has(key))return blurCache.get(key);
    if(!entry.backgroundFile)throw new Error('No background image is assigned.');
    const data=await window.TiffImage.values(entry.backgroundFile),result={...data,values:await window.TiffImage.blur(data.values,data.width,data.height,sigma),smoothed:true};
    blurCache.set(key,result);while(blurCache.size>2)blurCache.delete(blurCache.keys().next().value);return result;
  }
  async function values(entry,sigma,scale,offset,region=null){
    const key=settingsKey(entry,sigma,scale,offset,region);
    if(valueCache.has(key)){const value=valueCache.get(key);valueCache.delete(key);valueCache.set(key,value);return value;}
    if(valuePending.has(key))return valuePending.get(key);
    const task=(async()=>{const image=await window.TiffImage.values(entry.file);let result;if(entry.backgroundFile){const bg=await background(entry,sigma);result=window.ViewerBackgroundValues.subtract(image,bg,0,offset);}else{if(!region||!Number.isFinite(region.mean))throw new Error('No background image or sampled region is available.');if(image.bitsPerSample!==region.bitsPerSample||((image.photometric===0)!==(region.photometric===0)))throw new Error('Sampled background and image have incompatible TIFF formats.');result=window.ViewerBackgroundValues.subtractConstant(image,region.mean,offset);}valueCache.set(key,result);while(valueCache.size>2)valueCache.delete(valueCache.keys().next().value);return result;})().finally(()=>valuePending.delete(key));valuePending.set(key,task);return task;
  }
  async function get(entry,sigma,scale,offset,region=null){
    const key=settingsKey(entry,sigma,scale,offset,region);if(cache.has(key)){const value=cache.get(key);cache.delete(key);cache.set(key,value);return value;}if(pending.has(key))return pending.get(key);
    const task=(async()=>{const result=await values(entry,sigma,scale,offset,region),pixels=new Uint8ClampedArray(result.width*result.height*4);
      const show=v=>{const linear=Math.max(0,Math.min(1,v/(result.max||1)));return Math.round((scale==='log'?Math.log1p(100*linear)/Math.log1p(100):linear)*255);};
      for(let i=0;i<result.values.length;i++){const j=i*4,value=result.values[i];if(!Number.isFinite(value))continue;if(value<0&&entry.backgroundFile){pixels[j]=255;pixels[j+1]=pixels[j+2]=0;}else pixels[j]=pixels[j+1]=pixels[j+2]=show(value);pixels[j+3]=255;}
      const canvas=document.createElement('canvas');canvas.width=result.width;canvas.height=result.height;canvas.getContext('2d').putImageData(new ImageData(pixels,result.width,result.height),0,0);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('Could not render background-subtracted image.');const value={...result,url:URL.createObjectURL(blob)};cache.set(key,value);while(cache.size>3){const oldest=cache.keys().next().value;URL.revokeObjectURL(cache.get(oldest).url);cache.delete(oldest);}return value;
    })().finally(()=>pending.delete(key));pending.set(key,task);return task;
  }
  window.addEventListener('pagehide',()=>{for(const item of cache.values())URL.revokeObjectURL(item.url);cache.clear();});
  return {get,values};
};

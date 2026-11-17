/* Native TIFF decoding and background smoothing away from the UI thread. */
'use strict';
self.window=self;
self.__tiffWorkerContext=true;
if(!self.__pixelWorkerBundled)importScripts('vendor/pako-inflate.min.js','vendor/utif.js','tiff-image.js','viewer-background-values.js');
self.onmessage=async event=>{
  const {id,type}=event.data;
  try {
    let result;
    if(type==='values'){
      result=await self.TiffImage.values(event.data.file);
      self.TiffImage.clearCache();
      self.postMessage({id,result},[result.values.buffer]);
    } else if(type==='blur'){
      const {values,width,height,sigma}=event.data;
      result=self.ViewerBackgroundValues.blur(values,width,height,sigma);
      self.postMessage({id,result},[result.buffer]);
    } else throw new Error('Unknown pixel operation');
  } catch(error){self.postMessage({id,error:error.message||String(error)});}
};

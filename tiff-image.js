/* Decode the first TIFF page for display or native-value measurements. */
'use strict';
window.TiffImage = (() => {
  async function raw(file) {
    const buffer = await file.arrayBuffer();
    if (buffer.byteLength < 8) throw new Error('Truncated TIFF file');
    const header = new DataView(buffer), marker = header.getUint16(0, false);
    if (marker !== 0x4949 && marker !== 0x4d4d) throw new Error('Invalid TIFF byte order');
    const magic = header.getUint16(2, marker === 0x4949);
    if (magic === 43) throw new Error('BigTIFF preview is not supported yet');
    if (magic !== 42) throw new Error('Not a classic TIFF file');
    if (!window.UTIF) throw new Error('TIFF decoder is unavailable');
    const ifds = window.UTIF.decode(buffer), image = ifds.find(ifd => ifd.t256 && ifd.t257);
    if (!image) throw new Error('TIFF contains no image');
    const compression = image.t259?.[0] ?? 1;
    if (![1,3,4,5,6,7,8,32773].includes(compression)) throw new Error(`TIFF compression ${compression} is not supported for preview`);
    if (image.t284?.[0] === 2) throw new Error('Planar TIFF preview is not supported yet');
    window.UTIF.decodeImage(buffer, image, ifds);
    if (!image.width || !image.height || !image.data) throw new Error('TIFF image could not be decoded');
    return image;
  }
  // Apply the TIFF orientation to display and native samples in the same coordinate system.
  function oriented(pixels, width, height, channels, orientation) {
    if (orientation === 1) return { pixels, width, height };
    if (!Number.isInteger(orientation) || orientation < 1 || orientation > 8) throw new Error('Invalid TIFF orientation');
    const swap=orientation>=5, outWidth=swap?height:width, outHeight=swap?width:height;
    const out=new pixels.constructor(pixels.length);
    for(let y=0;y<outHeight;y++) for(let x=0;x<outWidth;x++) {
      let sx,sy;
      switch(orientation) {
        case 2: sx=width-1-x;sy=y;break;
        case 3: sx=width-1-x;sy=height-1-y;break;
        case 4: sx=x;sy=height-1-y;break;
        case 5: sx=y;sy=x;break;
        case 6: sx=y;sy=height-1-x;break;
        case 7: sx=width-1-y;sy=height-1-x;break;
        case 8: sx=width-1-y;sy=x;break;
      }
      const from=(sy*width+sx)*channels,to=(y*outWidth+x)*channels;
      for(let c=0;c<channels;c++) out[to+c]=pixels[from+c];
    }
    return {pixels:out,width:outWidth,height:outHeight};
  }
  async function decode(file) {
    const image = await raw(file), rgba = window.UTIF.toRGBA8(image);
    if (!rgba || rgba.length !== image.width * image.height * 4) throw new Error('TIFF image could not be decoded');
    const result=oriented(new Uint8ClampedArray(rgba),image.width,image.height,4,image.t274?.[0]??1);
    return {width:result.width,height:result.height,rgba:result.pixels};
  }
  const cache=new Map();
  let worker, workerFailed=false, nextRequest=0;
  const requests=new Map();
  function workerCall(type, payload, transfer=[]) {
    if(window.__tiffWorkerContext || workerFailed || typeof Worker==='undefined') return Promise.reject(new Error('Pixel worker unavailable'));
    if(!worker){
      try {
        if(window.location?.protocol==='file:' && window.PixelWorkerSource){
          const url=URL.createObjectURL(new Blob([window.PixelWorkerSource],{type:'text/javascript'}));
          try{worker=new Worker(url);}finally{URL.revokeObjectURL(url);}
        } else worker=new Worker('pixel-worker.js');
        worker.onmessage=event=>{const {id,result,error}=event.data,request=requests.get(id);if(!request)return;requests.delete(id);error?request.reject(new Error(error)):request.resolve(result);};
        worker.onerror=()=>{workerFailed=true;worker.terminate();worker=null;for(const request of requests.values())request.reject(new Error('Pixel worker unavailable'));requests.clear();};
      } catch(error){workerFailed=true;return Promise.reject(error);}
    }
    return new Promise((resolve,reject)=>{const id=++nextRequest;requests.set(id,{resolve,reject});try{worker.postMessage({id,type,...payload},transfer);}catch(error){requests.delete(id);reject(error);}});
  }
  async function blur(values,width,height,sigma){
    if(!(sigma>0))return values;
    try { const copy=values.slice();return await workerCall('blur',{values:copy,width,height,sigma},[copy.buffer]); }
    catch(_){return window.ViewerBackgroundValues.blur(values,width,height,sigma);}
  }
  async function values(file) {
    if(cache.has(file)){const value=cache.get(file);cache.delete(file);cache.set(file,value);return value;}
    const task=(async()=>{
      if(!window.__tiffWorkerContext && !workerFailed && typeof Worker!=='undefined') {
        try { return await workerCall('values',{file}); }
        catch(error) { if(!workerFailed) throw error; }
      }
      const image=await raw(file), bits=image.t258?.[0]??1, format=image.t339?.[0]??1, photo=image.t262?.[0]??1, channels=image.t277?.[0]??1, compression=image.t259?.[0]??1;
      if(![8,16].includes(bits)||format!==1||image.t339?.some(v=>v!==1)||![0,1,2].includes(photo)||![1,3,4].includes(channels)||image.t258?.some(v=>v!==bits)||(channels>1&&image.t258?.length!==channels)||(photo===2&&channels<3)||(photo!==2&&channels!==1)||[6,7].includes(compression))throw new Error('Native intensity measurement supports unsigned 8- or 16-bit grayscale and RGB TIFFs with lossless compression.');
      const bytes=bits/8, count=image.width*image.height;if(image.data.length<count*channels*bytes)throw new Error('TIFF pixel data is incomplete.');
      const view=new DataView(image.data.buffer,image.data.byteOffset,image.data.byteLength), output=new Float32Array(count), max=bits===8?255:65535;
      const read=i=>bits===8?view.getUint8(i):view.getUint16(i,true); // UTIF swaps 16-bit big-endian data to little-endian.
      for(let i=0;i<count;i++){const at=i*channels*bytes;if(channels===4&&read(at+3*bytes)!==max){output[i]=NaN;continue;}output[i]=channels===1?read(at):(read(at)+read(at+bytes)+read(at+2*bytes))/3;}
      const result=oriented(output,image.width,image.height,1,image.t274?.[0]??1);
      return {width:result.width,height:result.height,values:result.pixels,bitsPerSample:bits,sampleFormat:'unsigned integer',photometric:photo,channels,max};
    })().catch(error=>{cache.delete(file);throw error;});cache.set(file,task);while(cache.size>2)cache.delete(cache.keys().next().value);return task;
  }
  return {decode,values,blur,clearCache:()=>cache.clear()};
})();

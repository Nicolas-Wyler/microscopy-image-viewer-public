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
  async function decode(file) {
    const image = await raw(file), rgba = window.UTIF.toRGBA8(image);
    if (!rgba || rgba.length !== image.width * image.height * 4) throw new Error('TIFF image could not be decoded');
    return { width: image.width, height: image.height, rgba: new Uint8ClampedArray(rgba) };
  }
  const cache=new Map();
  async function values(file) {
    if(cache.has(file)){const value=cache.get(file);cache.delete(file);cache.set(file,value);return value;}
    const task=(async()=>{
      const image=await raw(file), bits=image.t258?.[0]??1, format=image.t339?.[0]??1, photo=image.t262?.[0]??1, channels=image.t277?.[0]??1, compression=image.t259?.[0]??1;
      if(![8,16].includes(bits)||format!==1||image.t339?.some(v=>v!==1)||![0,1,2].includes(photo)||![1,3,4].includes(channels)||image.t258?.some(v=>v!==bits)||(channels>1&&image.t258?.length!==channels)||(photo===2&&channels<3)||(photo!==2&&channels!==1)||[6,7].includes(compression))throw new Error('Native intensity measurement supports unsigned 8- or 16-bit grayscale and RGB TIFFs with lossless compression.');
      const bytes=bits/8, count=image.width*image.height;if(image.data.length<count*channels*bytes)throw new Error('TIFF pixel data is incomplete.');
      const view=new DataView(image.data.buffer,image.data.byteOffset,image.data.byteLength), output=new Float32Array(count), max=bits===8?255:65535;
      const read=i=>bits===8?view.getUint8(i):view.getUint16(i,true); // UTIF swaps 16-bit big-endian data to little-endian.
      for(let i=0;i<count;i++){const at=i*channels*bytes;if(channels===4&&read(at+3*bytes)!==max){output[i]=NaN;continue;}output[i]=channels===1?read(at):(read(at)+read(at+bytes)+read(at+2*bytes))/3;}
      return {width:image.width,height:image.height,values:output,bitsPerSample:bits,sampleFormat:'unsigned integer',photometric:photo,channels,max};
    })().catch(error=>{cache.delete(file);throw error;});cache.set(file,task);while(cache.size>2)cache.delete(cache.keys().next().value);return task;
  }
  return {decode,values};
})();

/* TIFF header and folder checks. No image pixels are decoded or uploaded. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MicroscopyFolderValidator = api;
})(globalThis, function () {
  'use strict';
  const sidecarName = /^(?:leicametadata|metadata|sidecars?)$/i;
  function safeNumber(n) {
    if (typeof n === 'bigint') {
      if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('TIFF offset is too large');
      n = Number(n);
    }
    if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid TIFF offset');
    return n;
  }
  async function bytes(file, offset, size) {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset + size > file.size) throw new Error('Truncated TIFF');
    const buf = await file.slice(offset, offset + size).arrayBuffer();
    if (buf.byteLength !== size) throw new Error('Truncated TIFF');
    return new DataView(buf);
  }
  async function dimensions(file) {
    const head = await bytes(file, 0, 8);
    const marker = head.getUint16(0, false);
    if (marker !== 0x4949 && marker !== 0x4d4d) throw new Error('Invalid TIFF byte order');
    const le = marker === 0x4949, magic = head.getUint16(2, le);
    let offset, countBytes, entryBytes, valueOffset, inlineBytes, big;
    if (magic === 42) { offset=head.getUint32(4,le); countBytes=2;entryBytes=12;valueOffset=8;inlineBytes=4;big=false; }
    else if (magic === 43) {
      const h=await bytes(file,0,16);
      if(h.getUint16(4,le)!==8 || h.getUint16(6,le)!==0) throw new Error('Invalid BigTIFF header');
      offset=safeNumber(h.getBigUint64(8,le));countBytes=8;entryBytes=20;valueOffset=12;inlineBytes=8;big=true;
    } else throw new Error('Not a TIFF file');
    if (!offset) throw new Error('Missing TIFF image directory');
    const countView=await bytes(file,offset,countBytes);
    const count=safeNumber(big ? countView.getBigUint64(0,le) : countView.getUint16(0,le));
    if (!count || count > 65536) throw new Error('Invalid TIFF image directory');
    const entries=await bytes(file,offset+countBytes,count*entryBytes);
    let width, height;
    for(let i=0;i<count;i++) {
      const p=i*entryBytes, tag=entries.getUint16(p,le);
      if(tag!==256 && tag!==257) continue;
      const type=entries.getUint16(p+2,le);
      const n=safeNumber(big ? entries.getBigUint64(p+4,le) : entries.getUint32(p+4,le));
      const size=type===3?2:type===4?4:big && type===16?8:0;
      if(n!==1 || !size || size>inlineBytes) throw new Error('Invalid TIFF image dimensions');
      const v = size===2 ? entries.getUint16(p+valueOffset,le) : size===4 ? entries.getUint32(p+valueOffset,le) : safeNumber(entries.getBigUint64(p+valueOffset,le));
      if(tag===256) width=v; else height=v;
    }
    if(!width || !height) throw new Error('Missing TIFF image dimensions');
    return {width,height};
  }
  async function validateFolder({files, directories, directoryVisibility = true, selectionKind = 'folder'}, onProgress = () => {}, shouldCancel = () => false) {
    const clean = p => p.replace(/\\/g,'/').replace(/^\/+|\/+$/g,'');
    const normalized=files.map(({path,file})=>({path:clean(path),file}));
    const root=clean(directories[0] || normalized[0]?.path.split('/')[0] || '');
    const isDirect = p => {const bits=p.split('/'); return bits.length===2 && bits[0]===root;};
    if(selectionKind==='files' && normalized.some(({path})=>!isDirect(path) || !/\.tiff?$/i.test(path))) throw new Error('Select only TIFF files (.tif or .tiff).');
    const tiffs=normalized.filter(({path}) => isDirect(path) && !path.split('/').pop().startsWith('._') && /\.tiff?$/i.test(path));
    if(!tiffs.length) throw new Error('No TIFF files found in the selected folder. Choose the folder containing the .tif or .tiff files.');
    const sidecarDirs=new Set((directories || []).map(clean));
    for(const {path} of normalized) {
      const parts=path.split('/');
      for(let i=1;i<parts.length;i++) sidecarDirs.add(parts.slice(0,i).join('/'));
    }
    const sidecars=[...sidecarDirs].filter(path => isDirect(path) && sidecarName.test(path.split('/').pop()));
    let expected;
    for(let i=0;i<tiffs.length;i++) {
      const {path,file}=tiffs[i]; onProgress(i+1,tiffs.length,0,file.size);
      if (shouldCancel()) throw new Error('Folder check cancelled');
      let dim;
      try { dim=await dimensions(file); }
      catch(e) { throw new Error(`Cannot read TIFF “${path.split('/').pop()}”: ${e.message || 'File could not be read'}.`); }
      if(!expected) expected=dim;
      else if(dim.width!==expected.width || dim.height!==expected.height) throw new Error(`TIFF resolution mismatch: “${path.split('/').pop()}” is ${dim.width} × ${dim.height} pixels; expected ${expected.width} × ${expected.height}.`);
      try {
        const chunkSize=4*1024*1024;
        for(let offset=0; offset<file.size; offset+=chunkSize) {
          if(shouldCancel()) throw new Error('Folder check cancelled');
          const length=Math.min(chunkSize,file.size-offset);
          const part=await file.slice(offset,offset+length).arrayBuffer();
          if(part.byteLength!==length) throw new Error('File was truncated while reading');
          onProgress(i+1,tiffs.length,offset+length,file.size);
        }
      } catch(e) { throw new Error(`Cannot read TIFF “${path.split('/').pop()}”: ${e.message || 'File could not be read'}.`); }
    }
    return {folderName:root, count:tiffs.length, width:expected.width, height:expected.height, sidecarFolder:sidecars.length ? sidecars[0].split('/').pop() : null, directoryVisibility, selectionKind};
  }
  return {validateFolder, dimensions};
});

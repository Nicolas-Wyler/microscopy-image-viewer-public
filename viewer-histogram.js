'use strict';
window.createVisibleHistogram = function (canvas, normalized, portableSource) {
  let serial=0, timer=null, originalKey=null, originalData=null, filteredImage=null, filteredData=null;
  async function original(entry,side) {
    if(entry.file)return window.TiffImage.values(entry.file);
    const src=entry.originalSrc;
    if(originalKey===src && originalData) return originalData;
    const image=new Image();image.src=location.protocol==='file:'&&!src.startsWith('blob:')?await portableSource(src):src;await image.decode();
    const c=document.createElement('canvas'); c.width=image.naturalWidth;c.height=image.naturalHeight;
    const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
    const rgba=ctx.getImageData(0,0,c.width,c.height).data, values=new Int16Array(c.width*c.height);
    for(let i=0;i<values.length;i++) values[i]=rgba[4*i];
    originalKey=src; originalData={values,width:c.width,height:c.height,max:255};return originalData;
  }
  function filtered(image) {
    if (filteredImage === image && filteredData) return filteredData;
    const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;
    const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
    const rgba=ctx.getImageData(0,0,c.width,c.height).data, values=new Int16Array(c.width*c.height);
    for(let i=0;i<values.length;i++) values[i]=rgba[4*i];
    filteredImage=image;filteredData={values,width:c.width,height:c.height,max:255};return filteredData;
  }
  function update(snapshot) {
    const id=++serial; clearTimeout(timer);
    canvas.hidden = !snapshot.ready;
    if(canvas.hidden) return;
    const right=20+(snapshot.normalized?Math.max(4,2*snapshot.sigma*snapshot.scale+4):0);
    canvas.style.right=right+'px';
    timer=setTimeout(async()=>{
      try {
        const data=snapshot.filter !== 'image' ? filtered(snapshot.image) : snapshot.normalized ? await normalized.values(snapshot.entry,snapshot.sigma,snapshot.intensityScale,snapshot.zeroOffset) : await original(snapshot.entry,snapshot.side);
        if(id!==serial || !data) return;
        const m=snapshot.matrix, off=[0,0];
        const width=data.width,height=data.height, bins=new Uint32Array(160), norm=Math.max(1,data.max);
        const vw=snapshot.viewportWidth,vh=snapshot.viewportHeight, scale=snapshot.scale;
        const tx=vw/2+snapshot.panX-snapshot.frameWidth*scale/2,ty=vh/2+snapshot.panY-snapshot.frameHeight*scale/2;
        for(let y=0;y<height;y++) {
          const py=y+off[1];
          for(let x=0;x<width;x++) {
            const px=x+off[0], u=m[0][0]*px+m[0][1]*py+m[0][2],v=m[1][0]*px+m[1][1]*py+m[1][2];
            if(u<0||v<0||u>=snapshot.frameWidth||v>=snapshot.frameHeight)continue;
            const sx=tx+u*scale,sy=ty+v*scale;if(sx<0||sy<0||sx>=vw||sy>=vh)continue;
            const value=data.values[y*width+x];if(!Number.isFinite(value))continue; let f=Math.min(1,Math.abs(value)/norm);
            if(value>=0 && snapshot.filter==='image' && snapshot.normalized && snapshot.intensityScale==='log')f=Math.log1p(100*f)/Math.log1p(100);
            const bin=value<0 ? Math.max(0,79-Math.floor(f*79)) : Math.min(159,80+Math.floor(f*79)); bins[bin]++;
          }
        }
        const ctx=canvas.getContext('2d');ctx.clearRect(0,0,160,60);let peak=0;for(const v of bins)peak=Math.max(peak,v);
        if(!peak)return;
        for(let i=0;i<160;i++){const h=60*bins[i]/peak;if(!h)continue;ctx.fillStyle=i<80?'#ff0000':'#ffffff';ctx.fillRect(i,60-h,1,h);}
      } catch(error) {console.warn('Visible pixel histogram unavailable',error);}
    },180);
  }
  return {update};
};

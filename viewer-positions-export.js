/* Calculations for the positions CSV, in the viewer's unnormalized intensity units. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ViewerPositionsExport=api;})(globalThis,function(){
  'use strict';
  function rectangleStats(image,rect){
    const c=Math.cos(rect.angle),s=Math.sin(rect.angle),hx=(Math.abs(c)*rect.width+Math.abs(s)*rect.height)/2,hy=(Math.abs(s)*rect.width+Math.abs(c)*rect.height)/2;
    const x0=Math.max(0,Math.floor(rect.cx-hx)),x1=Math.min(image.width,Math.ceil(rect.cx+hx)),y0=Math.max(0,Math.floor(rect.cy-hy)),y1=Math.min(image.height,Math.ceil(rect.cy+hy));let sum=0,count=0,maximum=-Infinity;
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const dx=x+.5-rect.cx,dy=y+.5-rect.cy,u=c*dx+s*dy,v=-s*dx+c*dy;if(Math.abs(u)>rect.width/2+1e-9||Math.abs(v)>rect.height/2+1e-9)continue;const value=image.values[y*image.width+x];if(!Number.isFinite(value))continue;sum+=value;count++;maximum=Math.max(maximum,value);}
    return count?{count,average:sum/count,maximum}:null;
  }
  function profileMeasurements(detail,position,pixelSize){
    const xs=detail?.positions||[],raw=detail?.values||[],smooth=detail?.smoothed||[];let peak=-1;
    for(let i=0;i<smooth.length;i++)if(Number.isFinite(smooth[i])&&(peak<0||smooth[i]>smooth[peak]))peak=i;
    const sample=x=>{if(!Number.isFinite(x))return null;const index=xs.findIndex(v=>Math.abs(v-x)<1e-9);return index>=0&&Number.isFinite(raw[index])?raw[index]:null;};
    let fwhmUm=null,fwhmPx=null;if(peak>=0&&smooth[peak]>0){const half=smooth[peak]/2;
      function crossing(direction){for(let i=peak;i+direction>=0&&i+direction<smooth.length;i+=direction){const j=i+direction,a=smooth[i],b=smooth[j];if(!Number.isFinite(a)||!Number.isFinite(b))return null;if(a>=half&&b<=half&&a!==b)return xs[i]+(half-a)*(xs[j]-xs[i])/(b-a);}return null;}
      const left=crossing(-1),right=crossing(1);if(left!==null&&right!==null){fwhmPx=Math.abs(right-left);if(Number.isFinite(pixelSize)&&pixelSize>0)fwhmUm=fwhmPx*pixelSize;}
    }
    const left=sample(position?.leftInflection),right=sample(position?.rightInflection),distance=Number.isFinite(position?.leftInflection)&&Number.isFinite(position?.rightInflection)&&Number.isFinite(pixelSize)&&pixelSize>0?Math.abs(position.rightInflection-position.leftInflection)*pixelSize:null;
    return {maximum:peak>=0&&Number.isFinite(raw[peak])?raw[peak]:null,peakCorrected:peak>=0?smooth[peak]:null,inflectionAverage:left!==null&&right!==null?(left+right)/2:null,inflectionDistancePx:Number.isFinite(position?.leftInflection)&&Number.isFinite(position?.rightInflection)?Math.abs(position.rightInflection-position.leftInflection):null,inflectionDistanceUm:distance,fwhmPx,fwhmUm};
  }
  function toCsv(rows,fields){const escape=value=>{const text=value==null?'':String(value);return /[",\r\n]/.test(text)?'"'+text.replaceAll('"','""')+'"':text;};return [fields.join(','),...rows.map(row=>fields.map(key=>escape(row[key])).join(','))].join('\r\n')+'\r\n';}
  function crc32(bytes){let crc=0xffffffff;for(const value of bytes){crc^=value;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^(0xedb88320&-(crc&1));}return (crc^0xffffffff)>>>0;}
  function zipTextFiles(files){
    const encoder=new TextEncoder(),parts=[],central=[];let offset=0;
    const header=(length,writer)=>{const bytes=new Uint8Array(length),view=new DataView(bytes.buffer);writer(view);return bytes;};
    for(const [name,text] of Object.entries(files)){const filename=encoder.encode(name),content=encoder.encode(text),crc=crc32(content),size=content.length;
      const local=header(30,v=>{v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint32(14,crc,true);v.setUint32(18,size,true);v.setUint32(22,size,true);v.setUint16(26,filename.length,true);});parts.push(local,filename,content);
      const entry=header(46,v=>{v.setUint32(0,0x02014b50,true);v.setUint16(4,20,true);v.setUint16(6,20,true);v.setUint16(8,0x800,true);v.setUint32(16,crc,true);v.setUint32(20,size,true);v.setUint32(24,size,true);v.setUint16(28,filename.length,true);v.setUint32(42,offset,true);});central.push(entry,filename);offset+=local.length+filename.length+content.length;
    }
    const centralSize=central.reduce((n,v)=>n+v.length,0),end=header(22,v=>{v.setUint32(0,0x06054b50,true);v.setUint16(8,central.length/2,true);v.setUint16(10,central.length/2,true);v.setUint32(12,centralSize,true);v.setUint32(16,offset,true);});parts.push(...central,end);const output=new Uint8Array(parts.reduce((n,v)=>n+v.length,0));let at=0;for(const part of parts){output.set(part,at);at+=part.length;}return output;
  }
  return {rectangleStats,profileMeasurements,toCsv,crc32,zipTextFiles};
});

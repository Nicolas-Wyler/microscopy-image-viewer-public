/* Leica dimension Length spans N−1 pixel intervals; reject incompatible axes. */
'use strict';
window.SidecarScale={
  read(text,width,height){
    const doc=new DOMParser().parseFromString(text,'application/xml');if(doc.querySelector('parsererror'))return null;
    function axis(id,expected){
      const values=[];for(const node of doc.querySelectorAll(`DimensionDescription[DimID="${id}"]`)){
        const count=Number(node.getAttribute('NumberOfElements')),length=Number(node.getAttribute('Length')),unit=node.getAttribute('Unit');
        const factor={m:1e6,mm:1000,um:1,'µm':1,'μm':1,nm:.001}[unit];
        if(count!==expected||count<2||!Number.isFinite(length)||length<=0||!factor)return null;
        values.push(length*factor/(count-1));
      }
      if(!values.length||values.some(value=>Math.abs(value-values[0])>values[0]*0.002))return null;return values[0];
    }
    const x=axis(1,width),y=axis(2,height);return x&&y&&Math.abs(x-y)<=Math.max(x,y)*0.002?x:null;
  }
};

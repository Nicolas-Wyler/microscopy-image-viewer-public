/* Empty standalone viewer state; image and calibration values are not connected yet. */
'use strict';
(() => {
  const frame={originalSrc:'',croppedSrc:'',sourceFilename:'',sourceSha256:'',sidecarSrc:'',sidecarSha256:'',width:1000,height:750,cropWidth:1000,cropHeight:750,pixelSizeUm:1,objectiveMagnification:null,rawToCrop:[[1,0,0],[0,1,0],[0,0,1]],halfTurn:false,placeholder:true};
  const image={number:1,filename:'Preview',row:0,column:0,dose:null,exposureField:null,top:{...frame},bottom:{...frame}};
  for(const name of Object.keys(frame))Object.defineProperty(image,name,{enumerable:true,get(){return image[window.OM10Session?.get('pictureSide','top')==='bottom'?'bottom':'top'][name];}});
  window.OM10_DATA={exposure:'',mask:'',sourceDirectory:'',previewEmpty:true,images:[image]};
})();

const test=require('node:test');const assert=require('node:assert/strict');
const {findMagnifications}=require('../sidecar-magnification.js');
const sidecar=(name,xml)=>({path:'set/leicametadata/'+name,file:{text:async()=>xml}});
const xml=n=>`<LMSDataContainerHeader><ATLCameraSettingDefinition TotalVideoMag="13.75" Magnification="${n}" ObjectiveName="20x"/></LMSDataContainerHeader>`;
test('matches each TIFF to its own sidecar and extracts objective magnification',async()=>{
 const result=await findMagnifications([{path:'set/Image001.tif'},{path:'set/Image002.TIFF'},{path:'set/Image003.tif'}],[sidecar('Image001.xlif',xml(20)),sidecar('Image002.xlif',xml(50)),sidecar('Image003-extra.xlif',xml(5))]);
 assert.deepEqual(result,['20','50','']);
});
test('missing, malformed, conflicting or unreadable metadata is left blank',async()=>{
 const broken={path:'set/leicametadata/bad.xlif',file:{text:async()=>{throw Error('denied')}}};
 const images=['a.tif','b.tif','bad.tif','missing.tif'].map(f=>({path:'set/'+f}));
 const files=[sidecar('a.xlif','<ATLCameraSettingDefinition TotalVideoMag="13.75"/>'),sidecar('b.xlif',xml(5)+xml(20)),broken];
 assert.deepEqual(await findMagnifications(images,files),['','','','']);
});

const test=require('node:test'),assert=require('node:assert/strict');
const targets=require('../viewer-file-targets.js');
test('refuses to overwrite unless confirmed',async()=>{
 let writes=0;const file={name:'state.json',createWritable:async()=>{writes++;return {write:async()=>{},close:async()=>{},abort:async()=>{}}}};
 const done=await targets.writeFile(file,new Blob(['new']),{exists:true,confirm:()=>false});assert.equal(done,false);assert.equal(writes,0);
 assert.equal(await targets.writeFile(file,new Blob(['new']),{exists:true,confirm:()=>true}),true);assert.equal(writes,1);
});
test('new files do not need overwrite confirmation and failed writes abort',async()=>{
 let aborted=false;const file={name:'new.json',createWritable:async()=>({write:async()=>{throw Error('failure')},close:async()=>{},abort:async()=>{aborted=true}})};
 await assert.rejects(targets.writeFile(file,new Blob(['x']),{exists:false,confirm:()=>{throw Error('unexpected prompt')}}),/failure/);assert.equal(aborted,true);
});
test('paths are relative to chosen folder and cannot escape it',()=>{
 assert.equal(targets.relativePath('Exposures/example/state/x.json','Exposures'),'example/state/x.json');
 for(const path of ['../secret','/tmp/secret','folder/../x','a\\b',''])assert.throws(()=>targets.relativePath(path,'Exposures'));
});

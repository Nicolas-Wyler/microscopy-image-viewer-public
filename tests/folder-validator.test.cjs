const test = require('node:test');
const assert = require('node:assert/strict');
let validateFolder;
try { ({validateFolder} = require('../folder-validator.js')); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
function tiff(width, height, bigEndian = false) {
 const b = new ArrayBuffer(38), v = new DataView(b), le = !bigEndian;
 v.setUint16(0, bigEndian ? 0x4d4d : 0x4949); v.setUint16(2,42,le); v.setUint32(4,8,le); v.setUint16(8,2,le);
 for (const [i,tag,value] of [[0,256,width],[1,257,height]]) { let p=10+i*12;v.setUint16(p,tag,le);v.setUint16(p+2,4,le);v.setUint32(p+4,1,le);v.setUint32(p+8,value,le); }
 return new Blob([b]);
}
const f=(path,blob)=>({path,file:blob});
test('a consistent TIFF folder with sidecars succeeds',async()=>{
 assert.equal(typeof validateFolder,'function');
 const result=await validateFolder({files:[f('set/a.TIF',tiff(3072,2048)),f('set/b.tiff',tiff(3072,2048,true)),f('set/leicametadata/a.xlif',new Blob(['data']))], directories:['set','set/leicametadata']});
 assert.equal(result.count,2);assert.deepEqual([result.width,result.height],[3072,2048]);
});
test('missing TIFF, mismatched size and corrupt TIFF fail',async()=>{
 assert.equal(typeof validateFolder,'function');
 const cases=[
  [{files:[],directories:['set','set/leicametadata']},/no.*tif/i],
  [{files:[f('set/a.tif',tiff(20,30)),f('set/b.tif',tiff(21,30))],directories:['set','set/leicametadata']},/resolution/i],
  [{files:[f('set/a.tif',new Blob(['broken']))],directories:['set','set/leicametadata']},/tiff|invalid|corrupt/i],
 ];
 for(const [input,error] of cases) await assert.rejects(validateFolder(input),error);
});
test('reports TIFFs that fail during full-file reads', async()=>{
 assert.equal(typeof validateFolder,'function');
 const header=tiff(20,30), total=5*1024*1024, full=new Blob([header,new Uint8Array(total-38)]);
 const faulty={size:total,slice(start,end){
   if(start<4*1024*1024)return full.slice(start,end);
   return {arrayBuffer:async()=>{throw new Error('device disconnected')}};
 }};
 await assert.rejects(validateFolder({files:[f('set/problem.tif',faulty)],directories:['set','set/leicametadata']}),/problem\.tif.*device disconnected/i);
});
test('reads BigTIFF dimensions',async()=>{
 const b=new ArrayBuffer(72), v=new DataView(b);
 v.setUint16(0,0x4949);v.setUint16(2,43,true);v.setUint16(4,8,true);v.setBigUint64(8,16n,true);v.setBigUint64(16,2n,true);
 for(const [i,tag,value] of [[0,256,4096n],[1,257,2048n]]){const p=24+i*20;v.setUint16(p,tag,true);v.setUint16(p+2,16,true);v.setBigUint64(p+4,1n,true);v.setBigUint64(p+12,value,true);}
 const result=await validateFolder({files:[f('set/a.tif',new Blob([b]))],directories:['set','set/leicametadata']});
 assert.deepEqual([result.width,result.height],[4096,2048]);
});
test('ignores TIFFs in nested folders',async()=>{
 const result=await validateFolder({files:[f('set/a.tif',tiff(20,30)),f('set/50x/b.tif',tiff(40,50))],directories:['set','set/50x','set/leicametadata']});
 assert.equal(result.count,1);
});

test('allows a folder without sidecars and reports that they are unavailable', async()=>{
 const result=await validateFolder({files:[f('set/a.tif',tiff(20,30))],directories:['set']});
 assert.equal(result.sidecarFolder,null);
});
test('accepts selected TIFF files as an image selection without sidecars',async()=>{
 const result=await validateFolder({files:[f('Selected images/a.tif',tiff(20,30)),f('Selected images/b.TIFF',tiff(20,30))],directories:['Selected images'],selectionKind:'files'});
 assert.equal(result.count,2);assert.equal(result.selectionKind,'files');assert.equal(result.sidecarFolder,null);
});
test('rejects non-TIFF files from direct image selections',async()=>{
 await assert.rejects(validateFolder({files:[f('Selected images/a.tif',tiff(20,30)),f('Selected images/b.png',new Blob(['png']))],directories:['Selected images'],selectionKind:'files'}),/only.*tiff/i);
});

test('folder dimensions use the TIFF orientation',async()=>{
 const b=new ArrayBuffer(50),v=new DataView(b);v.setUint16(0,0x4949);v.setUint16(2,42,true);v.setUint32(4,8,true);v.setUint16(8,3,true);
 for(const [i,tag,value] of [[0,256,300],[1,257,200],[2,274,6]]){const p=10+i*12;v.setUint16(p,tag,true);v.setUint16(p+2,3,true);v.setUint32(p+4,1,true);v.setUint16(p+8,value,true);}
 const {dimensions}=require('../folder-validator.js');assert.deepEqual(await dimensions(new Blob([b])),{width:200,height:300});
});

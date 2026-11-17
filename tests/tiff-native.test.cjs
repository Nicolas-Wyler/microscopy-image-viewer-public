const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..'),scope={window:{},self:{},console};vm.createContext(scope);vm.runInContext(fs.readFileSync(path.join(root,'vendor/pako-inflate.min.js'),'utf8'),scope);scope.self.pako=scope.pako;vm.runInContext(fs.readFileSync(path.join(root,'vendor/utif.js'),'utf8'),scope);scope.window.UTIF=scope.self.UTIF;vm.runInContext(fs.readFileSync(path.join(root,'tiff-image.js'),'utf8'),scope);
function fixture(values,{bits=16,little=true,channels=1,orientation=1,width=2,height=2}={}){const entries=11,ifd=8,bitsOffset=ifd+2+entries*12+4,pixels=bitsOffset+(channels>1?channels*2:0),bytes=bits/8,buf=new ArrayBuffer(pixels+values.length*bytes),v=new DataView(buf);v.setUint16(0,little?0x4949:0x4d4d);v.setUint16(2,42,little);v.setUint32(4,ifd,little);v.setUint16(ifd,entries,little);const fields=[[256,4,1,width],[257,4,1,height],[258,3,channels,channels>1?bitsOffset:bits],[259,3,1,1],[262,3,1,channels===1?1:2],[273,4,1,pixels],[277,3,1,channels],[278,4,1,height],[279,4,1,values.length*bytes],[284,3,1,1],[274,3,1,orientation]];fields.forEach(([tag,type,count,value],i)=>{const p=ifd+2+i*12;v.setUint16(p,tag,little);v.setUint16(p+2,type,little);v.setUint32(p+4,count,little);if(type===3&&count===1)v.setUint16(p+8,value,little);else v.setUint32(p+8,value,little);});if(channels>1)for(let c=0;c<channels;c++)v.setUint16(bitsOffset+c*2,bits,little);values.forEach((value,i)=>bits===8?v.setUint8(pixels+i,value):v.setUint16(pixels+i*2,value,little));return {arrayBuffer:async()=>buf};}
for(const little of [true,false])test(`reads original 16-bit grayscale samples (${little?'little':'big'} endian)`,async()=>{const image=await scope.window.TiffImage.values(fixture([0,257,4097,65535],{little}));assert.deepEqual(Array.from(image.values),[0,257,4097,65535]);assert.equal(image.bitsPerSample,16);});
test('keeps original 8-bit samples unchanged',async()=>{const image=await scope.window.TiffImage.values(fixture([0,7,128,255],{bits:8}));assert.deepEqual(Array.from(image.values),[0,7,128,255]);assert.equal(image.bitsPerSample,8);});

test('averages original 16-bit RGB channels without reducing bit depth',async()=>{const image=await scope.window.TiffImage.values(fixture([300,600,900,1000,2000,3000,99,99,99,65000,65000,65000],{channels:3}));assert.deepEqual(Array.from(image.values),[600,2000,99,65000]);assert.equal(image.bitsPerSample,16);});

test('honors TIFF orientation in both native and display pixels',async()=>{
 const expected={1:[10,20,30,40],2:[20,10,40,30],3:[40,30,20,10],4:[30,40,10,20],5:[10,30,20,40],6:[30,10,40,20],7:[40,20,30,10],8:[20,40,10,30]};
 for(const orientation of [1,2,3,4,5,6,7,8]) {
  const file=fixture([10,20,30,40],{bits:8,orientation}), values=await scope.window.TiffImage.values(file), display=await scope.window.TiffImage.decode(file);
  assert.deepEqual(Array.from(values.values),expected[orientation],`native orientation ${orientation}`);
  assert.deepEqual(Array.from(display.rgba).filter((_,i)=>i%4===0),expected[orientation],`display orientation ${orientation}`);
 }
});

test('90-degree TIFF orientations swap dimensions consistently',async()=>{
 const file=fixture([1,2,3,4,5,6],{bits:8,width:3,height:2,orientation:6});
 const v=await scope.window.TiffImage.values(file),d=await scope.window.TiffImage.decode(file);
 assert.deepEqual([v.width,v.height,d.width,d.height],[2,3,2,3]);
 assert.deepEqual(Array.from(v.values),[4,1,5,2,6,3]);
 assert.deepEqual(Array.from(d.rgba).filter((_,i)=>i%4===0),[4,1,5,2,6,3]);
});

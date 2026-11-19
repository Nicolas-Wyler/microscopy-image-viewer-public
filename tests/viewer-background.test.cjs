const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..'),math=require('../viewer-background-values.js');

test('measurement-only background subtraction avoids generating display images',async()=>{
  const image={width:2,height:2,values:Float32Array.from([1000,3000,6000,9000]),bitsPerSample:16,photometric:1},bg={...image,values:Float32Array.from([100,200,300,400])};
  const file={},backgroundFile={},scope={window:{TiffImage:{values:async f=>f===file?image:bg,blur:async(v,w,h,s)=>math.blur(v,w,h,s)},ViewerBackgroundValues:math,addEventListener(){}},document:{createElement(){throw Error('display image was generated');}},URL};
  vm.createContext(scope);vm.runInContext(fs.readFileSync(path.join(root,'viewer-background.js'),'utf8'),scope);
  const normalized=scope.window.createViewerBackground(),entry={id:'i',backgroundId:'b',file,backgroundFile};
  const [a,b]=await Promise.all([normalized.values(entry,0,'lin',10),normalized.values(entry,0,'lin',10)]);
  assert.strictEqual(a,b);assert.deepEqual(Array.from(a.values),[910,2810,5710,8610]);assert.equal(a.bitsPerSample,16);
});

test('offline worker bundle matches the worker source files',()=>{
  const scope={window:{}};vm.createContext(scope);vm.runInContext(fs.readFileSync(path.join(root,'pixel-worker-source.js'),'utf8'),scope);
  const files=['vendor/pako-inflate.min.js','vendor/utif.js','tiff-image.js','viewer-background-values.js','pixel-worker.js'];
  const expected='self.__pixelWorkerBundled=true;self.window=self;self.__tiffWorkerContext=true;\n'+files.map(name=>fs.readFileSync(path.join(root,name),'utf8')).join('\n;\n');
  assert.equal(scope.window.PixelWorkerSource,expected);
});

test('a shared sampled level subtracts from an image without an assigned background',async()=>{
  const image={width:2,height:1,values:Float32Array.from([100,300]),bitsPerSample:16,photometric:1},scope={window:{TiffImage:{values:async()=>image},ViewerBackgroundValues:math,addEventListener(){}},URL};
  vm.createContext(scope);vm.runInContext(fs.readFileSync(path.join(root,'viewer-background.js'),'utf8'),scope);
  const values=await scope.window.createViewerBackground().values({id:'i',file:{},backgroundId:''},3,'lin',10,{mean:150,bitsPerSample:16,photometric:1});
  assert.deepEqual(Array.from(values.values),[-40,160]);
});

test('a grayscale sampled level can be applied to an RGB image of the same bit depth',async()=>{
  const image={width:1,height:1,values:Float32Array.from([300]),bitsPerSample:16,photometric:2},scope={window:{TiffImage:{values:async()=>image},ViewerBackgroundValues:math,addEventListener(){}},URL};
  vm.createContext(scope);vm.runInContext(fs.readFileSync(path.join(root,'viewer-background.js'),'utf8'),scope);
  const values=await scope.window.createViewerBackground().values({id:'rgb',file:{}},0,'lin',0,{mean:100,bitsPerSample:16,photometric:1});
  assert.equal(values.values[0],200);
});

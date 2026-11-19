const test=require('node:test'),assert=require('node:assert/strict');
const background=require('../viewer-background-values.js');

test('a region averages valid native greyscale intensities',()=>{
  const image={width:3,height:2,values:Float32Array.from([2,12,22,32,42,NaN]),bitsPerSample:16};
  const region=[{x:1,y:0},{x:3,y:0},{x:3,y:2},{x:1,y:2}];
  const result=background.sampleRegion(image,region);
  assert.deepEqual(result,{mean:76/3,count:3});
});

test('constant subtraction preserves signed native intensity and adds zero offset',()=>{
  const image={width:2,height:1,values:Float32Array.from([1000,60000]),bitsPerSample:16,sampleFormat:'unsigned integer'};
  const out=background.subtractConstant(image,3000,10);
  assert.deepEqual(Array.from(out.values),[-1990,57010]);assert.equal(out.bitsPerSample,16);assert.equal(out.max,57010);
  assert.deepEqual(Array.from(background.subtractConstant(image,3000,-10).values),[-2010,56990]);
});

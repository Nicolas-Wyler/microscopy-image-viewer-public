const test=require('node:test'),assert=require('node:assert/strict');
const {rectangleStats,profileMeasurements,toCsv}=require('../viewer-positions-export.js');
test('rectangle statistics use pixel centers in the rotated rectangle and ignore nonfinite values',()=>{
 const image={width:4,height:4,values:Float32Array.from({length:16},(_,i)=>i)};
 const stats=rectangleStats(image,{cx:2,cy:2,width:2,height:2,angle:0});assert.equal(stats.count,4);assert.equal(stats.average,7.5);assert.equal(stats.maximum,10);
 const rotated=rectangleStats(image,{cx:2,cy:2,width:2,height:2,angle:Math.PI/2});assert.deepEqual(rotated,stats);
 image.values[5]=NaN;assert.equal(rectangleStats(image,{cx:2,cy:2,width:2,height:2,angle:0}).count,3);
 assert.equal(rectangleStats(image,{cx:-10,cy:-10,width:1,height:1,angle:0}),null);
});
test('profile values use unnormalized samples and FWHM is interpolated on the corrected profile',()=>{
 const detail={positions:[-2,-1,0,1,2],values:[10,12,14,12,10],smoothed:[0,2,4,2,0]};
 const result=profileMeasurements(detail,{leftInflection:-1,rightInflection:1},.7);
 assert.equal(result.maximum,14);assert.equal(result.inflectionAverage,12);assert.equal(result.inflectionDistanceUm,1.4);assert.equal(result.fwhmUm,1.4);
 assert.equal(profileMeasurements({...detail,smoothed:[4,4,4,4,4]},{},1).fwhmUm,null);
});
test('CSV escapes values and leaves unavailable values empty',()=>{
 assert.equal(toCsv([{name:'a,b',value:4,missing:null}],['name','value','missing']), 'name,value,missing\r\n"a,b",4,\r\n');
});
test('the two-file archive is a valid uncompressed ZIP with checksums',()=>{
 const {zipTextFiles,crc32}=require('../viewer-positions-export.js'),bytes=zipTextFiles({'positions.csv':'a,b\r\n1,2\r\n','positions.metadata.json':'{"version":1}'});
 assert.equal(crc32(new TextEncoder().encode('123456789')),0xcbf43926);assert.equal(new DataView(bytes.buffer,bytes.byteOffset).getUint32(0,true),0x04034b50);assert.equal(new DataView(bytes.buffer,bytes.byteOffset).getUint32(bytes.length-22,true),0x06054b50);assert.match(new TextDecoder().decode(bytes),/positions\.metadata\.json/);
});

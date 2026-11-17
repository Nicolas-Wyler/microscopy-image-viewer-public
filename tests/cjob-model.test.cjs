const {test}=require('node:test');
const assert=require('node:assert/strict');
const {quantity,displacement}=require('../cjob-model.js');
test('wavelength and gap use explicit or documented default units',()=>{
 assert.equal(quantity('3.1 nm','wavelength'),3.1);assert.equal(quantity('0.0031 µm','wavelength'),3.1);
 assert.equal(quantity('2000','gap'),2000);assert.equal(quantity('2 mm','gap'),2000);assert.equal(quantity('2000 um','gap'),2000);assert.equal(quantity('300000 nm','gap'),300);
 assert.equal(quantity('0','gap'),null);assert.equal(quantity('hello','wavelength'),null);
});
test('first-order centre uses exact grating equation and rejects evanescent orders',()=>{
 assert.ok(Math.abs(displacement(3.1,2000,100)-62.0298)<0.0001);
 assert.ok(Math.abs(displacement(13.5,200,24)-136.0672)<0.0001);
 assert.equal(displacement(24,200,24),null);assert.equal(displacement(25,200,24),null);
});
test('repetition expands centred positions using vector plus spacing on each axis',()=>{
 const {expandPlacements}=require('../cjob-model.js');
 const two=expandPlacements([[0,0],[50,20]],[{count:2,vector:[5,10],space:[2,3]}]);
 assert.deepEqual(two.map(p=>[p.x,p.y]),[[-3.5,-6.5],[3.5,6.5],[46.5,13.5],[53.5,26.5]]);
 const grid=expandPlacements([[0,0]],[{count:2,vector:[10,0],space:[2,0]},{count:3,vector:[0,20],space:[0,3]}]);
 assert.deepEqual(grid.map(p=>[p.x,p.y]),[[-6,-23],[-6,0],[-6,23],[6,-23],[6,0],[6,23]]);
 assert.deepEqual(grid.map(p=>p.indices),[[1,1],[1,2],[1,3],[2,1],[2,2],[2,3]]);
 assert.throws(()=>expandPlacements([[0,0]],[{count:1001,vector:[1,0],space:[0,0]}]),/unsupported/);
});

test('wafer prediction mirrors x while leaving the mask design and y unchanged',()=>{
 const {predictedGrating}=require('../cjob-model.js');
 const source={x:120,y:35,width:80,height:70,orientation:'vertical',pitch:44};
 const predicted=predictedGrating(source);assert.equal(predicted.x,-120);assert.equal(predicted.y,35);
 assert.equal(source.x,120);assert.equal(predicted.width,80);assert.equal(predicted.pitch,44);
 const d=displacement(13.5,300,44);
 assert.ok(predicted.x-d<predicted.x);assert.ok(predicted.x+d>predicted.x);
});

const test=require('node:test'),assert=require('node:assert/strict');
const colors=require('../spot-colors.js'),calibration=require('../viewer-recalibration.js');
test('pair palette is deterministic and distinct for typical designs',()=>{
  const p=colors.palette(24);assert.equal(p.length,24);assert.equal(new Set(p).size,24);assert.deepEqual(colors.palette(24),p);
  assert.equal(colors.groupKey([{grating:{id:'a'}}]),colors.groupKey([{grating:{id:'a'}},{grating:{id:'a'}}]));
  assert.notEqual(colors.groupKey([{grating:{id:'a'}}]),colors.groupKey([{grating:{id:'a'}},{grating:{id:'b'}}]));
});
test('reframing preserves mask coordinates while enclosing all spots with margin',()=>{
  const frame={matrix:[[1,0,950],[0,1,440],[0,0,1]],cropWidth:1900,cropHeight:900,originCropY:440};
  const bounds={maxX:220,top:300,bottom:-250,margin:80};const next=calibration.reframe(frame,bounds,0.5);
  assert.equal(next.cropWidth,1200);assert.equal(next.cropHeight,1420);
  assert.equal(next.matrix[0][2]-next.cropWidth/2,frame.matrix[0][2]-frame.cropWidth/2);
  assert.equal(next.matrix[1][2]-next.originCropY,frame.matrix[1][2]-frame.originCropY);
  assert.ok(next.originCropY-bounds.top/.5>=bounds.margin/.5);
  assert.ok(next.cropHeight-(next.originCropY-bounds.bottom/.5)>=bounds.margin/.5);
});

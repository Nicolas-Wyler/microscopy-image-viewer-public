const test=require('node:test');
const assert=require('node:assert/strict');
const {createImageList}=require('../image-table-state.js');
const items=[{id:'a',file:{name:'Image10.tif'}},{id:'b',file:{name:'Image2.tif'}},{id:'c',file:{name:'Image1.tif'}}];
test('the initial image order is natural and identities are preserved',()=>{
 const s=createImageList(items);assert.deepEqual(s.items().map(x=>x.id),['c','b','a']);
});
test('reordering and deleting update the source list and preserve remaining objects',()=>{
 const s=createImageList(items);s.move('a','c',false);assert.deepEqual(s.items().map(x=>x.id),['a','c','b']);
 s.move('a','b',true);assert.deepEqual(s.items().map(x=>x.id),['c','b','a']);
 assert.equal(s.remove('b'),items[1]);assert.deepEqual(s.items().map(x=>x.id),['c','a']);
});
test('names default to the filename without TIFF extension and remain attached after reordering',()=>{
 const s=createImageList([{id:'a',file:{name:'alpha.stack.TIFF'}},{id:'b',file:{name:'beta.tif'}}]);
 assert.deepEqual(s.items().map(x=>x.name),['alpha.stack','beta']);
 s.setName('a','Custom Name');s.move('a','b',true);
 assert.deepEqual(s.items().map(x=>[x.id,x.name]),[['b','beta'],['a','Custom Name']]);
 assert.equal(s.items()[1].file.name,'alpha.stack.TIFF');
});
test('moves multiple selected images as one ordered group and supports restoring name and order snapshots',()=>{
 const list=createImageList([{id:'a',file:{name:'a.tif'}},{id:'b',file:{name:'b.tif'}},{id:'c',file:{name:'c.tif'}},{id:'d',file:{name:'d.tif'}}]);
 const saved=list.snapshot();list.setName('a','Edited');list.moveMany(['a','c'],'d',true);
 assert.deepEqual(list.items().map(x=>x.id),['b','d','a','c']);
 list.restore(saved);assert.deepEqual(list.items().map(x=>x.id),['a','b','c','d']);assert.equal(list.items()[0].name,'a');
});
test('dose series follows table order for selected images and rejects invalid results',()=>{
 const {doseSeries}=require('../image-table-state.js');
 assert.deepEqual(doseSeries([{id:'d'},{id:'c'},{id:'b'},{id:'a'}],['a','d','b'],10,1.58),[['d','10'],['b','15.8'],['a','24.964']]);
 assert.deepEqual(doseSeries([{id:'a'},{id:'b'},{id:'c'}],['a','b','c'],100,0.5),[['a','100'],['b','50'],['c','25']]);
 assert.throws(()=>doseSeries([{id:'a'},{id:'b'}],['a','b'],10,-1));
 assert.throws(()=>doseSeries([{id:'a'},{id:'b'}],['a','b'],1e308,2));
});

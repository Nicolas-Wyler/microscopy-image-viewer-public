const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const scope={window:{ViewerRecalibration:require('../viewer-recalibration.js')},console,btoa,atob,unescape,escape,encodeURIComponent,decodeURIComponent};vm.createContext(scope);vm.runInContext(fs.readFileSync(path.join(__dirname,'..','viewer-spot-placement.js'),'utf8'),scope);const placement=scope.window.ViewerSpotPlacement;
test('a spot can be placed without a sidecar or complete grating geometry',()=>{
 const spot={id:'g:minus',kind:'minus',x:20,y:30,displacement:null,grating:{id:'g',width:null,height:null}},entry={width:1000,height:800,hasCalibration:false};
 scope.window.OM10_DATA={maskDesign:{spots:new Map([[spot.id,spot]])}};const result=placement.placement(entry,{spots:[spot]},[]);
 assert.ok(result.rect);assert.equal(result.rect.cx,500);assert.equal(result.rect.cy,400);assert.ok(result.rect.width>0&&result.rect.height>0);assert.equal(result.manual,true);
});
test('zero-order rectangles estimate rough spot placement without a sidecar',()=>{
 const g1={id:'a',x:0,y:0,width:40,height:40},g2={id:'b',x:100,y:0,width:40,height:40};
 const a={id:'a:zero',kind:'zero',x:0,y:0,grating:g1},b={id:'b:zero',kind:'zero',x:100,y:0,grating:g2},first={id:'a:plus',kind:'plus',x:40,y:0,displacement:40,grating:g1};
 const mask={spots:new Map([[a.id,a],[b.id,b],[first.id,first]])};scope.window.OM10_DATA={maskDesign:mask};
 const rect=(spot,cx)=>({id:placement.definition({members:[spot.id],spots:[spot]}).id,cx,cy:300,width:80,height:80,angle:0,shapeMode:'square'});
 const result=placement.placement({width:1000,height:800,hasCalibration:false},{spots:[first]},[rect(a,300),rect(b,500)]);
 assert.ok(result.anchored);assert.ok(Math.abs(result.rect.cx-380)<1e-8);assert.ok(Math.abs(result.rect.cy-300)<1e-8);assert.equal(result.rect.width,80);
});

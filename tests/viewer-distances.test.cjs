const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
test('combined and individual rectangles for the same order do not duplicate measurements',()=>{
 const grating={id:'g',orientation:'vertical',effectivePitch:32,dose:1},zero={id:'z',kind:'zero',label:'0',grating},first={id:'p',kind:'plus',label:'+1',grating},other={id:'o',kind:'minus',label:'−1',grating:{...grating,id:'h'}};
 const defs=new Map([['z',zero],['p',first],['o',other]]),members={z:['z'],p:['p'],pair:['p','o']};
 const scope={window:{ViewerSpotPlacement:{members:id=>members[id],side:()=> 'left'},GratingGeometry:{viewMatrix:()=>[[1,0,0],[0,1,0],[0,0,1]],transform:(p)=>p}},console};vm.createContext(scope);vm.runInContext(fs.readFileSync(path.join(__dirname,'..','viewer-distances.js'),'utf8'),scope);
 const centres=new Map([['z',{measurementRaw:{x:0,y:0}}],['pair',{measurementRaw:{x:25,y:0}}],['p',{measurementRaw:{x:20,y:0}}]]);
 const pairs=scope.window.ViewerDistances.measure({spots:defs},centres,{hasCalibration:true,alignment:{alignedPixelUm:1},pixelSizeUm:1});assert.equal(pairs.length,1);assert.equal(pairs[0].firstId,'p');assert.equal(pairs[0].distanceUm,20);
});

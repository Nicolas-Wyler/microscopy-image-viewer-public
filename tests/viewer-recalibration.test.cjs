const test=require('node:test'),assert=require('node:assert/strict');const {fit}=require('../viewer-recalibration.js');
test('fits one scale and rotation while removing each image translation',()=>{
 const k=1.023,angle=.075,c=Math.cos(angle),s=Math.sin(angle),images=[{scale:.7,shift:[130,220],points:[[0,0],[140,0],[0,190]]},{scale:1.4,shift:[500,25],points:[[0,30],[90,30],[180,30]]}].map((im,i)=>({id:String(i),pixelSizeUm:im.scale,points:im.points.map(([x,y])=>({mask:{x,y},raw:{x:(c*x+s*y)/(k*im.scale)+im.shift[0],y:(-s*x+c*y)/(k*im.scale)+im.shift[1]}}))}));
 const result=fit(images);assert.ok(result);assert.ok(Math.abs(result.factor-k)<1e-10);assert.ok(Math.abs(result.rotation-angle)<1e-10);assert.equal(result.images,2);assert.equal(result.points,6);assert.ok(result.rmsUm<1e-9);
});
test('does not fit a scale from a single spot or coincident spots',()=>{
 assert.equal(fit([{pixelSizeUm:1,points:[{raw:{x:2,y:2},mask:{x:0,y:0}}]}]),null);
 assert.equal(fit([{pixelSizeUm:1,points:[{raw:{x:2,y:2},mask:{x:0,y:0}},{raw:{x:2,y:2},mask:{x:1,y:1}}]}]),null);
});
test('uses the common scale in each image and aligns different native pixel sizes',()=>{
 const {plan}=require('../viewer-recalibration.js'),result={factor:1.1,rotation:0};const images=[{id:'a',width:1000,height:1000,pixelSizeUm:1,points:[{raw:{x:100,y:200},mask:{x:20,y:30}}]},{id:'b',width:1000,height:1000,pixelSizeUm:2,points:[{raw:{x:250,y:400},mask:{x:20,y:30}}]}];
 const out=plan(images,result,{top:100,bottom:-100,margin:20,maxX:200});assert.ok(out);assert.equal(out.images.length,2);
 const a=out.images[0],b=out.images[1];assert.equal(a.pixelSizeUm,1.1);assert.equal(b.pixelSizeUm,2.2);assert.equal(a.alignedPixelUm,b.alignedPixelUm);
 const G=require('../grating-geometry.js'),ma=G.viewMatrix({rawToCrop:a.matrix},'cropped'),mb=G.viewMatrix({rawToCrop:b.matrix},'cropped'),xa=ma[0][0]*100+ma[0][1]*200+ma[0][2],xb=mb[0][0]*250+mb[0][1]*400+mb[0][2],ya=ma[1][0]*100+ma[1][1]*200+ma[1][2],yb=mb[1][0]*250+mb[1][1]*400+mb[1][2];assert.ok(Math.abs(xa-xb)<1e-9&&Math.abs(ya-yb)<1e-9);
});
test('physical rectangle coordinates use the calibrated raw and aligned pixel scales',()=>{
 const G=require('../grating-geometry.js'),entry={pixelSizeUm:2,width:100,height:100,cropWidth:200,cropHeight:200,alignment:{alignedPixelUm:1},rawToCrop:[[2,0,0],[0,2,0],[0,0,1]]},rect={cx:30,cy:40,width:10,height:15,angle:0};
 const values=G.measurements(rect,entry,'cropped');assert.equal(values.x,59.5);assert.equal(values.y,120.5);assert.equal(values.width,20);assert.equal(values.height,30);
 const moved=G.withMeasurement(rect,entry,'cropped','x',79.5);assert.equal(moved.cx,40);
 const other={...entry,pixelSizeUm:1,alignment:{alignedPixelUm:1},rawToCrop:[[1,0,0],[0,1,0],[0,0,1]]};assert.equal(G.copyToDose(rect,entry,other).width,20);
});
test('corrects rotation and scale even when no zero-order translation exists',()=>{
 const {plan}=require('../viewer-recalibration.js'),G=require('../grating-geometry.js'),rotation=.2,factor=1.1;
 const images=[{id:'measured',width:1000,height:800,pixelSizeUm:1,points:[{raw:{x:100,y:200},mask:{x:0,y:0}}]},{id:'missing',width:1000,height:800,pixelSizeUm:1,points:[],roughPoints:[]},{id:'no-scale',width:1000,height:800,pixelSizeUm:null,points:[],roughPoints:[]}];
 const out=plan(images,{rotation,factor},{top:100,bottom:-100,margin:20,maxX:200});assert.equal(out.images.length,3);
 const missing=out.images.find(x=>x.id==='missing'),noScale=out.images.find(x=>x.id==='no-scale');assert.equal(missing.source,'centered');assert.ok(missing.matrix);assert.equal(missing.pixelSizeUm,1.1);
 const m=G.viewMatrix({rawToCrop:missing.matrix},'cropped'),p=G.transform({x:500,y:400},m);assert.ok(Math.abs(p.x-missing.cropWidth/2)<1e-8);assert.ok(Math.abs(p.y-missing.cropHeight/2)<1e-8);assert.ok(Math.abs(Math.atan2(m[1][0],m[0][0])-rotation)<1e-9);
 assert.equal(missing.cropWidth,out.cropWidth);assert.equal(missing.cropHeight,out.cropHeight);assert.equal(noScale.cropWidth,out.cropWidth);assert.equal(noScale.cropHeight,out.cropHeight);
 const measured=out.images.find(x=>x.id==='measured');for(const i of [missing,noScale])for(const [a,b] of [[0,0],[0,1],[1,0],[1,1]])assert.ok(Math.abs(i.matrix[a][b]-measured.matrix[a][b])<1e-12);
 assert.equal(noScale.source,'centered');assert.ok(noScale.matrix);assert.equal(noScale.pixelSizeUm,null);assert.ok(Math.abs(Math.atan2(noScale.matrix[1][0],noScale.matrix[0][0])-rotation)<1e-9);
});

test('one pixel size is fitted from raw zero-order centers without sidecars and applied to all images',()=>{
 const {fitShared,plan}=require('../viewer-recalibration.js');const pixel=.72,rotation=.08,c=Math.cos(rotation),s=Math.sin(rotation);
 const images=[{id:'measured',width:1000,height:800,pixelSizeUm:null,points:[[0,0],[140,0],[0,100]].map(([x,y])=>({mask:{x,y},raw:{x:500+(c*x+s*y)/pixel,y:300+(-s*x+c*y)/pixel}}))},{id:'one',width:1000,height:800,pixelSizeUm:null,points:[{raw:{x:400,y:350},mask:{x:0,y:0}}]},{id:'none',width:1000,height:800,pixelSizeUm:null,points:[]}];
 const fit=fitShared(images);assert.ok(fit);assert.ok(Math.abs(fit.pixelSizeUm-pixel)<1e-10);assert.ok(Math.abs(fit.rotation-rotation)<1e-10);assert.equal(fit.images,1);assert.equal(fit.factor,null);
 const out=plan(images,fit,{top:100,bottom:-100,margin:20,maxX:200});assert.equal(out.images.length,3);
 for(const p of out.images){assert.ok(Math.abs(p.pixelSizeUm-pixel)<1e-10);assert.ok(Math.abs(p.alignedPixelUm-pixel)<1e-10);assert.equal(p.cropWidth,out.cropWidth);assert.equal(p.cropHeight,out.cropHeight);for(const [i,j,v] of [[0,0,c],[0,1,-s],[1,0,s],[1,1,c]])assert.ok(Math.abs(p.matrix[i][j]-v)<1e-10);}
 assert.equal(out.images[2].source,'centered');
});

const test=require('node:test'),assert=require('node:assert/strict');
const {wavelengths,bins}=require('../viewer-wavelength-histogram.js');
test('calculates wavelength for every valid zero-to-first-order measurement',()=>{
 const pairs=[{distanceUm:1000,pitch:24},{distanceUm:500,pitch:28},{distanceUm:800,pitch:0},{distanceUm:NaN,pitch:24}];
 const values=wavelengths(pairs,2300);assert.equal(values.length,2);
 assert.ok(Math.abs(values[0]-24*1000/Math.hypot(2300,1000))<1e-12);
 assert.ok(Math.abs(values[1]-28*500/Math.hypot(2300,500))<1e-12);
 assert.deepEqual(wavelengths(pairs,0),[]);
});
test('histogram includes every measurement including endpoints and degenerate single-value data',()=>{
 for(const values of [[3,3,3],[0,1,2,3,4],[5]]){const chart=bins(values);assert.ok(chart.min<chart.max);assert.equal(chart.counts.reduce((a,b)=>a+b,0),values.length);}
 assert.equal(bins([]),null);
});
test('reports mean, median and sample standard deviation',()=>{
 const {statistics}=require('../viewer-wavelength-histogram.js');
 const s=statistics([2,4,4,4,5,5,7,9]);assert.equal(s.mean,5);assert.equal(s.median,4.5);assert.ok(Math.abs(s.sd-Math.sqrt(32/7))<1e-12);
 assert.deepEqual(statistics([5]),{mean:5,median:5,sd:null});assert.equal(statistics([]),null);
});
test('gap sensitivity recomputes the mean and sample SD from each distance at every gap',()=>{
 const {gapSensitivity}=require('../viewer-wavelength-histogram.js');
 const pairs=[{distanceUm:1000,pitch:24},{distanceUm:800,pitch:28}],points=gapSensitivity(pairs,2300);
 assert.equal(points.length,101);assert.equal(points[0].offset,-50);assert.equal(points[50].offset,0);assert.equal(points[100].offset,50);
 for(const p of [points[0],points[50],points[100]]){const a=24*1000/Math.hypot(2300+p.offset,1000),b=28*800/Math.hypot(2300+p.offset,800);assert.ok(Math.abs(p.mean-(a+b)/2)<1e-12);assert.ok(Math.abs(p.sd-Math.abs(a-b)/Math.sqrt(2))<1e-12);}
 assert.equal(gapSensitivity([{distanceUm:100,pitch:24}],2300)[50].sd,null);
 assert.equal(gapSensitivity(pairs,20)[0].mean,null);
 assert.equal(gapSensitivity([],2300).length,0);
});
test('parses image numbers and ranges safely',()=>{
 const {parseImages}=require('../viewer-wavelength-histogram.js');
 assert.equal(parseImages('   ',12),null);
 assert.deepEqual([...parseImages('1, 4, 6-11',12)],[1,4,6,7,8,9,10,11]);
 assert.deepEqual([...parseImages('3–5,3',12)],[3,4,5]);
 for(const bad of ['0','13','6-14','4-2','2,','1--3','1 2','1.5','-1','999999999999999999999'])assert.throws(()=>parseImages(bad,12),bad);
});
test('filters diffraction order, grating side and physical pitch/e-dose combinations independently',()=>{
 const {combinationKey,matchesFilters,combinations}=require('../viewer-wavelength-histogram.js');
 const entries=[{pitch:33,electronDose:1234,side:'left',order:-1},{pitch:33,electronDose:2345,side:'right',order:1},{pitch:44,electronDose:null,side:'unknown',order:-1}];
 const options=combinations([{effectivePitch:33,dose:2345},{effectivePitch:33,dose:1234},{effectivePitch:33,dose:1234},{effectivePitch:44,dose:null}]);
 assert.equal(options.length,3);assert.match(options[0].label,/33 nm · e0/);assert.match(options[1].label,/33 nm · e1/);assert.match(options[2].label,/unknown/);assert.ok(options.every(option=>!option.label.includes('µC')));assert.equal(combinations([{effectivePitch:32,dose:5000}])[0].label,'32 nm · e0');
 const excluded=new Set([combinationKey(33,2345)]);assert.equal(matchesFilters(entries[0],{order:'all',side:'all',excluded}),true);assert.equal(matchesFilters(entries[1],{order:'all',side:'all',excluded}),false);assert.equal(matchesFilters(entries[0],{order:'1',side:'all',excluded:new Set()}),false);assert.equal(matchesFilters(entries[0],{order:'-1',side:'left',excluded:new Set()}),true);assert.equal(matchesFilters(entries[2],{order:'all',side:'left',excluded:new Set()}),false);
});
test('plot axes use rounded, evenly spaced values over the full range',()=>{
 const {niceAxis}=require('../viewer-wavelength-histogram.js');
 for(const [low,high] of [[12.744,12.851],[12.5225,13.0771],[.000123,.000157],[-50,50],[0,9]]){
  const axis=niceAxis(low,high);assert.ok(axis.min<=low&&axis.max>=high);assert.ok(axis.ticks.length>=3&&axis.ticks.length<=8);const ratio=axis.step/10**Math.floor(Math.log10(axis.step));assert.ok([1,2.5,5,10].some(x=>Math.abs(x-ratio)<1e-8));for(let i=1;i<axis.ticks.length;i++)assert.ok(Math.abs(axis.ticks[i]-axis.ticks[i-1]-axis.step)<axis.step*1e-7);
 }
});

test('axis increments use only 0.1, 0.25 or 0.5 times powers of ten and counts stay integral',()=>{const {niceAxis}=require('../viewer-wavelength-histogram.js');assert.equal(niceAxis(0,.65).step,.25);assert.equal(niceAxis(0,10,4,true).step,5);assert.ok(niceAxis(0,2,4,true).ticks.every(Number.isInteger));});
test('manual histogram bin width is exact, counts all values and rejects unrenderable widths',()=>{
 const {bins}=require('../viewer-wavelength-histogram.js');const chart=bins([12.75,12.751,12.76,12.78],.01);
 assert.equal(chart.width,.01);assert.ok(Math.abs(chart.min-12.75)<1e-10);assert.equal(chart.counts.reduce((a,b)=>a+b,0),4);assert.deepEqual(chart.counts,[2,1,0,1]);
 assert.throws(()=>bins([0,10],0));assert.throws(()=>bins([0,10],1e-6));assert.ok(bins([1,2],null));
});
test('gap sensitivity uses the specified symmetric range',()=>{
 const {gapSensitivity}=require('../viewer-wavelength-histogram.js');const p=gapSensitivity([{distanceUm:100,pitch:24}],2300,125);
 assert.equal(p.length,101);assert.equal(p[0].offset,-125);assert.equal(p[50].offset,0);assert.equal(p[100].offset,125);assert.throws(()=>gapSensitivity([{distanceUm:100,pitch:24}],2300,0));
});

test('two-pitch comparison eliminates the gap and rejects nonphysical ratios',()=>{
 const {comparisonWavelength,comparisonValues}=require('../viewer-wavelength-histogram.js');const lambda=13,gap=300,r=p=>gap*lambda/Math.sqrt(p*p-lambda*lambda);
 const a={pitch:32,distanceUm:r(32),imageId:'a'},b={pitch:44,distanceUm:r(44),imageId:'a'},other={...b,imageId:'b'};
 assert.ok(Math.abs(comparisonWavelength(a,b)-lambda)<1e-10);assert.ok(Math.abs(comparisonWavelength(b,a)-lambda)<1e-10);
 assert.equal(comparisonWavelength(a,{...b,distanceUm:r(32)}),null);assert.equal(comparisonWavelength(a,{...b,pitch:32}),null);assert.equal(comparisonWavelength(a,{...b,distanceUm:0}),null);
 const same=comparisonValues([a],[b,other]);assert.equal(same.values.length,1);assert.equal(same.attempted,1);
 const bad=comparisonValues([a],[{...b,distanceUm:r(32)}]);assert.equal(bad.rejected,1);assert.equal(bad.values.length,0);
});

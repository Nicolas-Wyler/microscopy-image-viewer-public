/* Image intensity integrated across the two horizontal sides, in raw pixel coordinates. */
'use strict';
window.createIntegralProfiles = function (redraw) {
  let source = null, canvas = null, signed = null, pending = null, pendingPromise = null, failed = null;
  const profiles = new Map();
  function ensure(context) {
    const key = context.intensitySource;
    if (!key) return false;
    if (source === key && (canvas || signed)) return true;
    if (pending === key || failed === key) return false;
    source = key; canvas = null; signed = null; profiles.clear(); pending = key;
    if (context.loadIntensityValues) {
      pendingPromise = context.loadIntensityValues().then(data => {
        if (source !== key) return;
        if (!data) throw new Error('Corrected values unavailable');
        signed = { ...data, offset: context.intensityOffset }; pending = null; redraw();
      }).catch(error => { if (source === key) { pending = null; failed = key; console.warn('Corrected integral profile unavailable', error); } });
      return false;
    }
    pendingPromise = context.loadIntensityImage().then(image => {
      if (source !== key) return;
      const next = document.createElement('canvas'); next.width = image.naturalWidth; next.height = image.naturalHeight;
      next.getContext('2d', {willReadFrequently:true}).drawImage(image, 0, 0);
      canvas = next; pending = null; redraw();
    }).catch(error => { if (source === key) { pending = null; failed = key; console.warn('Integral profile image unavailable', error); } });
    return false;
  }
  function details(rect, context, fraction = 0.75, smoothingSigma = 0) {
    if (!ensure(context)) return null;
    const key = [rect.cx,rect.cy,rect.width,rect.height,rect.angle,fraction,smoothingSigma].join(',');
    if (profiles.has(key)) return profiles.get(key);
    const c=Math.cos(rect.angle), s=Math.sin(rect.angle), w=rect.width, h=rect.height;
    const corners = [-1,1].flatMap(x=>[-1,1].map(y=>({x:rect.cx+c*x*w/2-s*y*h/2,y:rect.cy+s*x*w/2+c*y*h/2})));
    const offset = signed?.offset || [0, 0], imageWidth = signed?.width ?? canvas.width, imageHeight = signed?.height ?? canvas.height;
    const x0=Math.max(0,Math.floor(Math.min(...corners.map(p=>p.x))-offset[0])), y0=Math.max(0,Math.floor(Math.min(...corners.map(p=>p.y))-offset[1]));
    const x1=Math.min(imageWidth,Math.ceil(Math.max(...corners.map(p=>p.x))-offset[0])), y1=Math.min(imageHeight,Math.ceil(Math.max(...corners.map(p=>p.y))-offset[1]));
    if (x1<=x0 || y1<=y0) return null;
    const pixels=signed ? null : canvas.getContext('2d',{willReadFrequently:true}).getImageData(x0,y0,x1-x0,y1-y0), bw=x1-x0;
    const nx=Math.max(2,Math.min(256,Math.ceil(w))), ny=Math.max(1,Math.min(512,Math.ceil(h))), values=[], sampleCounts=[];
    for(let i=0;i<nx;i++) {
      const u=w*((i+.5)/nx-.5); let sum=0, count=0;
      for(let j=0;j<ny;j++) {
        const v=h*((j+.5)/ny-.5), x=Math.floor(rect.cx+c*u-s*v-offset[0])-x0, y=Math.floor(rect.cy+s*u+c*v-offset[1])-y0;
        if(x<0||y<0||x>=bw||y>=y1-y0) continue;
        if (signed) {const value=signed.values[(y+y0)*imageWidth+x+x0];if(!Number.isFinite(value))continue;sum+=value;}
        else { const q=(y*bw+x)*4; sum+=(pixels.data[q]+pixels.data[q+1]+pixels.data[q+2])/3; }
        count++;
      }
      values.push(count ? sum/count : null); sampleCounts.push(count);
    }
    // Fit both outside regions together; retain signed residuals after subtraction.
    let count=0, left=0, right=0, sx=0, sy=0, sxx=0, sxy=0;
    values.forEach((value, i) => {
      const x=(i+.5)/nx-.5;
      if (value===null || Math.abs(x)<fraction/2) return;
      count++; if (x<0) left++; else right++; sx+=x; sy+=value; sxx+=x*x; sxy+=x*value;
    });
    const denominator=count*sxx-sx*sx;
    if (!left || !right || denominator<=1e-12) return null;
    const slope=(count*sxy-sx*sy)/denominator, intercept=(sy-slope*sx)/count;
    const corrected=values.map((value,i)=>value===null ? null : value-(intercept+slope*((i+.5)/nx-.5)));
    // Smooth the background-subtracted signed profile along X, before normalization.
    const sigmaSamples = smoothingSigma * nx / w;
    const smoothed = sigmaSamples > 0 ? corrected.map((value,i) => {
      if (value===null) return null;
      let sum=0, weight=0;
      const radius=Math.min(nx-1,Math.ceil(4*sigmaSamples));
      for(let j=Math.max(0,i-radius);j<=Math.min(nx-1,i+radius);j++) {
        if(corrected[j]===null) continue;
        const q=(j-i)/sigmaSamples, k=Math.exp(-.5*q*q);
        sum+=k*corrected[j]; weight+=k;
      }
      return weight ? sum/weight : value;
    }) : corrected.slice();
    const finite=smoothed.filter(value=>value!==null); if(!finite.length) return null;
    const maximum=Math.max(...finite);
    const result=smoothed.map(value=>value===null ? null : maximum>1e-9 ? value/maximum : 0);
    const detail={ normalized:result, values, corrected, smoothed, smoothingSigma, sampleCounts, sampleCountAcross:ny, fraction, intercept, slope, maximum,
      backgroundCount:count, backgroundLeftCount:left, backgroundRightCount:right,
      positions:values.map((_,i)=>w*((i+.5)/nx-.5)),
      fitted:values.map((value,i)=>value===null ? null : intercept+slope*((i+.5)/nx-.5)) };
    if (profiles.size>=100) profiles.clear(); profiles.set(key,detail); return detail;
  }
  function profile(rect, context, fraction = 0.75, smoothingSigma = 0) { return details(rect, context, fraction, smoothingSigma)?.normalized ?? null; }
  async function ready(context) { if (ensure(context)) return true; if (pendingPromise) await pendingPromise; return source===context.intensitySource && Boolean(canvas || signed); }
  return { profile, details, ready };
};

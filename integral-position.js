'use strict';
// Derivatives and inflection locations are computed from the displayed, smoothed curve.
window.integralPosition = function (detail, method = 'maximum') {
  if (!detail || !(detail.maximum > 1e-9)) return null;
  const y=detail.normalized, x=detail.positions, n=y.length;
  let peak=-1;
  for(let i=0;i<n;i++) if(y[i]!==null && (peak<0 || y[i]>y[peak])) peak=i;
  if(peak<0) return null;
  const derivative=new Array(n).fill(null);
  for(let i=1;i<n-1;i++) if(y[i-1]!==null && y[i+1]!==null && y[i]!==null && x[i+1]>x[i-1]) derivative[i]=(y[i+1]-y[i-1])/(x[i+1]-x[i-1]);
  // The sample positions are evenly spaced cell centers across the rectangle.
  const width=n>1 ? (x[n-1]-x[0])*n/(n-1) : 0;
  const halfSignal=width*detail.fraction/2;
  let maxIndex=-1, minIndex=-1;
  for(let i=0;i<n;i++) {
    const d=derivative[i];
    if(d===null || !Number.isFinite(d) || Math.abs(x[i])>halfSignal+1e-10) continue;
    if(maxIndex<0 || d>derivative[maxIndex]) maxIndex=i;
    if(minIndex<0 || d<derivative[minIndex]) minIndex=i;
  }
  const usable=maxIndex>=0 && minIndex>=0 && maxIndex!==minIndex && derivative[maxIndex]-derivative[minIndex]>1e-12;
  const maxPosition=usable?x[maxIndex]:null, minPosition=usable?x[minIndex]:null;
  const left=usable?Math.min(maxPosition,minPosition):null, right=usable?Math.max(maxPosition,minPosition):null;
  const position=method==='inflection' ? (usable ? (maxPosition+minPosition)/2 : null) : x[peak];
  let curveValue=null;
  if(position!==null) {
    let j=0;while(j<n-1 && x[j+1]<position)j++;
    const k=Math.min(n-1,j+1), t=x[k]===x[j]?0:(position-x[j])/(x[k]-x[j]);
    if(y[j]!==null && y[k]!==null) curveValue=y[j]+t*(y[k]-y[j]);
  }
  return {method,position,curveValue,peakIndex:peak,peakPosition:x[peak],leftInflection:left,rightInflection:right,derivativeMaximumPosition:maxPosition,derivativeMinimumPosition:minPosition,derivative};
};

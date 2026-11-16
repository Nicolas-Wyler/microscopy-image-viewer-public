/* On-demand worker and a six-image cache. No edge work runs at startup. */
'use strict';
window.createEdgeViews = function () {
  const cache = new Map(), pending = new Map();
  let worker, workerUrl, unavailable = false, sequence = 0;
  function getWorker() {
    if (worker || unavailable) return worker;
    try {
      const source = `${window.gaussianWeights.toString()}\n${window.processEdges.toString()}\nself.onmessage = event => {
        try { const result = processEdges(event.data); self.postMessage({ id: event.data.id, result }, [result.rgba.buffer]); }
        catch (error) { self.postMessage({ id: event.data.id, error: error.message }); }
      };\n//# sourceURL=om10-edge-worker.js`;
      workerUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      worker = new Worker(workerUrl, { name: 'OM10 edge views' });
      worker.onmessage = ({ data }) => {
        const request = pending.get(data.id); if (!request) return;
        pending.delete(data.id);
        data.error ? request.reject(new Error(data.error)) : request.resolve(data.result);
      };
      worker.onerror = () => {
        unavailable = true; worker.terminate(); worker = null;
        for (const request of pending.values()) request.reject(new Error('Worker unavailable.'));
        pending.clear();
      };
    } catch (_) { unavailable = true; }
    return worker;
  }
  async function make(image, mode, settings) {
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0);
    const input = () => ({ rgba: context.getImageData(0, 0, canvas.width, canvas.height).data,
      width: canvas.width, height: canvas.height, mode, settings });
    let result;
    try {
      const engine = getWorker(); if (!engine) throw new Error('Worker unavailable.');
      result = await new Promise((resolve, reject) => {
        const pixels = input(), id = ++sequence;
        pending.set(id, { resolve, reject }); engine.postMessage({ ...pixels, id }, [pixels.rgba.buffer]);
      });
    } catch (_) {
      // Direct file opening remains usable when a browser restricts workers.
      await new Promise(resolve => setTimeout(resolve, 0));
      result = window.processEdges(input());
    }
    context.putImageData(new ImageData(result.rgba, result.width, result.height), 0, 0);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Could not render edge image.');
    return URL.createObjectURL(blob);
  }
  return { async get(image, source, mode, settings) {
    const key = JSON.stringify([source,mode,settings.sigma,settings.cannyThreshold,settings.cannyLowRatio,settings.edgeGain,settings.edgeGamma]);
    if (cache.has(key)) { const saved = cache.get(key); cache.delete(key); cache.set(key, saved); return saved; }
    const url = await make(image, mode, settings);
    if (cache.has(key)) { URL.revokeObjectURL(url); return cache.get(key); }
    cache.set(key, url);
    while (cache.size > 6) { const oldest = cache.keys().next().value; URL.revokeObjectURL(cache.get(oldest)); cache.delete(oldest); }
    return url;
  } };
};

/* OM10 viewer — no dependencies. data.js owns data; styles.css owns appearance.
 * Rendering, image selection, and zoom/pan are kept separate below.
 * Images are loaded on demand. There is no network service or background work.
 */
'use strict';

(async () => {
  if(document.getElementById('folder-loader') && !document.getElementById('folder-loader').hidden)return;
  try { await window.OM13Storage.ready; } catch (error) {
    const status = document.getElementById('image-status');
    status.hidden = false; status.textContent = 'Could not open project storage; existing data has been preserved.';
    return;
  }
  if(window.ViewerProject)await window.ViewerProject.ready;
  const data = window.OM10_DATA;
  const byId = id => document.getElementById(id);
  if(byId('viewer-project-title'))byId('viewer-project-title').textContent=data?.projectTitle||'New Project 1';
  const viewport = byId('viewport');
  const imageFrame = byId('image-frame');
  const status = byId('image-status');
  let image = byId('micrograph');
  let preferredView = 'cropped';
  const state = { index: 0, view: 'cropped', filter: 'image', ready: false, scale: 1, fit: true, x: 0, y: 0, request: 0, drag: null };
  state.pictureSide = window.OM10Session.get('pictureSide', 'top') === 'bottom' ? 'bottom' : 'top';
  state.cleanImage = window.OM10Session.get('cleanImage', false) === true;
  state.backgroundMode=window.OM10Session.get('backgroundMode','original')==='normalized'?'normalized':'original';
  state.backgroundSigma=Number(window.OM10Session.get('backgroundSigma',3));if(!Number.isFinite(state.backgroundSigma)||state.backgroundSigma<0||state.backgroundSigma>100)state.backgroundSigma=3;
  state.zeroOffset=Number(window.OM10Session.get('zeroOffset',0));if(!Number.isFinite(state.zeroOffset)||state.zeroOffset<0)state.zeroOffset=0;
  state.intensityScale=window.OM10Session.get('intensityScale','lin')==='log'?'log':'lin';
  const normalizedView=window.createViewerBackground();
  const histogram=window.createVisibleHistogram(byId('visible-histogram'),normalizedView,portableSource);
  const isNormalized=entry=>state.backgroundMode==='normalized'&&Boolean(entry?.backgroundFile)&&!entry.backgroundError;

  const edgeViews = window.createEdgeViews();
  const filterLabels = byId('filter-scharr') ? { image: 'Image', scharr: 'Edge contrast', canny: 'Canny' } : { image: 'Image', canny: 'Canny' };
  const numericDose = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const doseFormat = {format: value => value == null ? 'Unknown' : numericDose.format(value)};
  const pad = value => String(value).padStart(2, '0');
  const buttons = [];let visibleIndices=[];
  let lastPointer = null;
  let displayedFrame = null; // Last decoded image, even if another dose is still loading.
  let previousDose = null; // Previous distinct image that actually reached the screen.
  let queuedCopy = null, copySequence = 0;
  let filterRefreshPending=false, filterRefreshRunning=false, filtersAdjusting=false, filterIdleTimer;
  let midpointMask = null; // One native Canny frame, shared across views of the current dose.
  let doseHold = null;
  let consumedClick = null;
  let cameraSaveTimer = 0;
  const sidecarViewer = window.createSidecarViewer(() => displayedFrame?.entry || data.images[state.index]);

  if (!data || !Array.isArray(data.images) || !data.images.length) {
    status.textContent = 'Image metadata could not be loaded. Keep data.js beside index.html.';
    console.error('OM10_DATA is missing or empty. Check data.js.');
    return;
  }

  const grayscaleButton = byId('toggle-grayscale');
  function showGrayscale(enabled) {
    imageFrame.classList.toggle('grayscale', enabled);
    grayscaleButton.setAttribute('aria-pressed', String(enabled));
  }
  showGrayscale(window.OM10Session.get('grayscale', false));
  grayscaleButton.addEventListener('click', () => {
    const enabled = !imageFrame.classList.contains('grayscale');
    showGrayscale(enabled);
    window.OM10Session.set('grayscale', enabled);
  });

  const ordered = data.importedProject ? window.ViewerSpotPlacement.definitions(data) : window.rectangleSpotDefinitions();
  const project = byId('project-csv');
  let initial;
  if (project && !data.importedProject) {
    try {
      initial = window.readRectangleCsv(JSON.parse(project.textContent), data, ordered);
    } catch (error) {
      status.textContent = 'Could not open this project. ' + error.message;
      return;
    }
  }
  const store = window.createGratingStore({ data, mask: window.OM10_MASK,
    scope: window.OM10Session.scope, startingRectangles: initial?.groups,
    startingRecords: window.OM11SessionSnapshot?.rectangles });
  const compare = byId('compare-tab') ? window.createSpotCompare(doseFormat, entry => {
    const index = data.images.indexOf(entry);
    if (index !== state.index) selectImage(index);
  }, () => state.cleanImage, store, resolveBatchPairs) : null;
  if (initial && compare) {
    try {
      const comparisons = compare.prepareImport(initial.groups, initial.comparisons);
      for (const [filename, entries] of comparisons) {
        window.OM10Session.defaults.set('comparisons:' + filename, [...entries.values()]);
      }
    } catch (error) {
      status.textContent = 'Could not open this project. ' + error.message;
      return;
    }
  }
  window.setupViewerSidebars(compare?.setActive);
  let spotOverview, rectangleList, maskPicker, analysisCalculator;
  let scheduleWavelengthAnalysis = () => {};
  let updateAnalysisImageNotice = () => {};
  let previewWavelengthAnalysis = () => {}, endWavelengthPreview = () => {};
  const notifyCalculator = (method, ...args) => {
    try { analysisCalculator?.[method](...args); }
    catch (error) { console.warn('Analysis calculator:', error); if(byId('analysis-calc-status'))byId('analysis-calc-status').textContent='Calculation unavailable.'; }
  };
  const updateAnalysis = window.createDistanceAnalysis?.(window.OM10_MASK);
  const grating = window.createGratingOverlay({ store, viewport, onRectanglePreview(context,items,centres) { previewWavelengthAnalysis(context,items,centres); }, onRectanglePreviewEnd() { endWavelengthPreview(); }, onPositionMethodChange() { compare?.invalidate(data.images[state.index].filename); scheduleWavelengthAnalysis(); }, onSavedRectangles(name, items, changed = true) {
    compare?.invalidate(name); compare?.reconcile(name, items); notifyCalculator('remember', name, items); updateMapCount(name,items.size); if(changed)scheduleWavelengthAnalysis();
  }, onDuplicate(source) {
    maskPicker?.open(source);
  }, onDistances(pairs, context) {
    updateAnalysis?.(pairs, context);
    compare?.update(pairs, context);
    notifyCalculator('update', pairs, context);
  },
    getFieldEdit: () => rectangleList?.fieldEdit(), onChange: snapshot => {
    spotOverview?.update(snapshot); rectangleList?.update(snapshot); updateMapCount(snapshot.entry.filename,snapshot.active.length);
  }, getContext: () => {
    const entry = data.images[state.index];
    // Profiles use signed, unfiltered sensor-grid values when reference subtraction is active.
    const intensitySrc = entry.renderUrl || entry.originalSrc, pictureSide = state.pictureSide, normalized=isNormalized(entry),sigma=state.backgroundSigma,offset=state.zeroOffset,intensityScale=state.intensityScale;
    const loadIntensityImage = async () => {
      const image = new Image(); image.decoding = 'async';
      image.src = location.protocol === 'file:' && !intensitySrc.startsWith('blob:') ? await portableSource(intensitySrc) : intensitySrc;
      await image.decode(); return image;
    };
    return { entry, pictureSide, intensitySource: entry.placeholder ? null : intensitySrc+(normalized?`|background|${entry.backgroundId}|${sigma}|${offset}`:'|original'),
      intensityOffset:[0,0], backgroundMode:normalized?'normalized':'original',gaussianSigma:sigma,zeroOffset:offset,intensityScale,loadIntensityValues:normalized?()=>normalizedView.values(entry,sigma,intensityScale,offset):entry.file?()=>window.TiffImage.values(entry.file):null,loadIntensityImage,
      view: state.view, ready: state.ready, scale: state.scale, panX: state.x, panY: state.y,
      cleanImage: state.cleanImage, filter: state.filter, getMidpointMask, pickerRects: maskPicker?.guideRects,
      loadSnapMask: () => getMidpointMask() || midpointMask?.promise,
      width: state.view === 'cropped' ? entry.cropWidth : entry.width,
      height: state.view === 'cropped' ? entry.cropHeight : entry.height };
  } });
  try { if(window.createAnalysisCalculator) analysisCalculator = window.createAnalysisCalculator({data, mask:window.OM10_MASK, store}); }
  catch (error) { console.warn('Analysis calculator:', error); byId('analysis-calc-status').textContent='Calculator unavailable.'; }
  spotOverview = window.createSpotOverview({ onToggle: spot => grating.toggleSpot(spot) });
  maskPicker = window.createMaskPicker(viewport, imageFrame, spotOverview,
    () => !state.cleanImage && state.ready && displayedFrame,
    (spot,source) => source ? grating.duplicateSpot(spot,source) : grating.toggleSpot(spot), grating.render, beginPan);
  rectangleList = window.createRectangleList({ ordered, onSelect: grating.select, onEdit: grating.editMeasurement, onPreview: grating.render,
    getRectangles: (entry, side = state.pictureSide) => side === state.pictureSide
      ? grating.rectanglesForExport(entry) : store.load(entry.filename, side).items,
    onImportLegacy(groups){
      const incoming=new Map();let imported=0,conflicts=0;
      for(const [filename,items] of groups){const entry=data.images.find(item=>item.filename===filename);if(!entry)throw new Error('An image is no longer in this project.');const existing=grating.rectanglesForExport(entry),safe=new Map(),occupied=new Set([...existing.keys()].flatMap(id=>window.ViewerSpotPlacement.members(id)));for(const [id,rect] of items){if(existing.has(id)||window.ViewerSpotPlacement.members(id).some(member=>occupied.has(member))){conflicts++;continue;}safe.set(id,rect);imported++;}if(safe.size)incoming.set(filename,safe);}
      if(incoming.size)grating.importRectangles(incoming);return {imported,conflicts};
    },
    getComparisons: compare?.exportRows || (() => []), prepareProfiles: prepareExportProfiles,
    getExportSettings: () => ({mode:state.backgroundMode,sigma:state.backgroundSigma,offset:state.zeroOffset,scale:state.intensityScale, defaultSignalRange: window.OM10Session.get('integralDummyPercent',75), gapUm:Number.isFinite(data.nominalGapUm)?data.nominalGapUm+(byId('gap-correction-button')?Number(window.OM10Session.get('gapCorrectionUm',0)):0):null}), onImport: parsed => {
      // Validate both sides and construct every write before changing saved data.
      const planned = [], comparisonPlans = [], oldRectangles = [], oldComparisons = [];
      for (const side of ['top', 'bottom']) {
        const groups = parsed.groupsBySide.get(side), rows = parsed.comparisonsBySide.get(side);
        if (!compare && rows.length) throw new Error('This viewer no longer imports comparison records; rectangle-only CSV files are supported.');
        const comparisons = compare ? compare.prepareImport(groups, rows, side) : new Map();
        const changes = [];
        for (const [filename, incoming] of groups) {
          const existing = store.load(filename, side);
          const items = window.OM10SpotColors.apply(new Map([...existing.items, ...incoming]));
          changes.push({filename, items, selected: existing.selected.length ? existing.selected : [incoming.keys().next().value]});
          const key = store.keyFor(filename, side);
          oldRectangles.push({key, value: window.OM13Storage.getItem(key)});
        }
        for (const name of comparisons.keys()) {
          const key = 'comparisons:' + name;
          oldComparisons.push({key, side, value: window.OM10Session.getForSide(key, side, null)});
        }
        planned.push({side, changes}); comparisonPlans.push({side, comparisons});
      }
      try {
        for (const {side, changes} of planned) if (changes.length) store.saveBatch(changes, side);
        for (const {side, comparisons} of comparisonPlans) if (comparisons.size) compare?.importEntries(comparisons, side);
      } catch (error) {
        // Restore previous values if any side failed, rather than leaving a partial import.
        for (const {key, value} of oldRectangles) if (value === null) window.OM13Storage.removeItem(key);
        for (const {key, value} of oldRectangles) if (value !== null) window.OM13Storage.setItem(key, value);
        for (const {key, side, value} of oldComparisons) {
          if (value === null) window.OM10Session.removeForSide(key, side);
          else window.OM10Session.setForSide(key, side, value);
        }
        throw error;
      }
      grating.clearPictureSide();
      notifyCalculator('resetSide');
      scheduleWavelengthAnalysis();
      compare?.refreshSide();
      data.images.forEach(refreshMapCount);
      grating.render();
    } });

  const cleanButton = byId('clean-image');
  const footer = document.querySelector('.viewer-footer');
  function applyCleanImage() {
    const clean = state.cleanImage;
    viewport.classList.toggle('clean-image', clean);
    cleanButton.setAttribute('aria-pressed', String(clean));
    byId('show-distances').disabled = clean;
    if (clean) footer.prepend(status);
    else viewport.append(status);
  }
  cleanButton.addEventListener('click', () => {
    grating.finish();
    maskPicker.close();
    queuedCopy = null;
    copySequence++;
    state.cleanImage = !state.cleanImage;
    applyCleanImage();
    window.OM10Session.set('cleanImage', state.cleanImage);
    renderTransform();
  });
  applyCleanImage();
  viewport.addEventListener('contextmenu', event => {
    if (state.cleanImage) event.preventDefault();
  }, true);

  function updateMapCount(filename, count) {
    const index=data.images.findIndex(entry=>entry.filename===filename), button=buttons[index];
    if (!button || data.importedProject) return;
    const entry=data.images[index], known=Number.isInteger(count) && count>=0;
    button.classList.toggle('has-rectangles',known && count>0);
    const status=known ? (count===1?'1 rectangle':`${count} rectangles`) : 'rectangle status unavailable';
    button.title=`${entry.filename} · ${doseFormat.format(entry.dose)} mJ/cm² · ${status}`;
    button.setAttribute('aria-label',`Image ${pad(entry.number)}, ${doseFormat.format(entry.dose)} mJ/cm², ${status}`);
  }
  function refreshMapCount(entry) {
    try { updateMapCount(entry.filename,store.load(entry.filename).items.size); }
    catch(error) { updateMapCount(entry.filename,null); console.warn('Could not read rectangle status for '+entry.filename,error); }
  }
  window.addEventListener('storage',event=>{
    if(event.key===null) data.images.forEach(refreshMapCount);
    else {const entry=data.images.find(item=>store.keyFor(item.filename)===event.key);if(entry)refreshMapCount(entry);}
  });
  function buildMap() {
    const body=byId('viewer-image-list').querySelector('tbody'),doseFilter=byId('viewer-dose-filter'),zoneFilter=byId('viewer-zone-filter'),empty=byId('viewer-list-empty');
    const doseKey=entry=>entry.dose===null?'__none__':String(entry.dose),zoneKey=entry=>entry.zoneId||'__everything__';
    const entries=data.previewEmpty?[]:data.images;
    const doses=[...new Set(entries.map(doseKey))].sort((a,b)=>a==='__none__'?1:b==='__none__'?-1:Number(a)-Number(b));
    for(const value of doses)doseFilter.add(new Option(value==='__none__'?'None':value,value));
    const zones=new Map();for(const entry of entries)zones.set(zoneKey(entry),entry.zoneName);for(const [value,label] of zones)zoneFilter.add(new Option(label,value));
    doseFilter.disabled=doses.length<=1;zoneFilter.disabled=zones.size<=1;
    if(doses.length===1)doseFilter.value=doses[0];
    if(zones.size===1)zoneFilter.value=zones.keys().next().value;
    if(!doseFilter.disabled){const saved=window.OM10Session.get('viewerDoseFilter','__all__');if([...doseFilter.options].some(option=>option.value===saved))doseFilter.value=saved;}
    if(!zoneFilter.disabled){const saved=window.OM10Session.get('viewerZoneFilter','__all__');if([...zoneFilter.options].some(option=>option.value===saved))zoneFilter.value=saved;}
    doseFilter.title=!entries.length?'No images loaded':doseFilter.disabled?'All images have the same dose':'';
    zoneFilter.title=!entries.length?'No images loaded':zoneFilter.disabled?'All images have the same zone':'';
    function updateList(){
      visibleIndices=[];buttons.length=0;body.replaceChildren();
      for(const [index,entry] of entries.entries()){
        if(doseFilter.value!=='__all__'&&doseFilter.value!==doseKey(entry))continue;
        if(zoneFilter.value!=='__all__'&&zoneFilter.value!==zoneKey(entry))continue;
        visibleIndices.push(index);const row=document.createElement('tr'),number=document.createElement('td'),name=document.createElement('td'),dose=document.createElement('td'),zone=document.createElement('td'),button=document.createElement('button');
        number.className='viewer-image-number';number.textContent=String(entry.number);name.className='viewer-image-name';dose.className='viewer-image-dose';zone.className='viewer-image-zone';button.type='button';button.textContent=entry.name||'(Unnamed)';button.setAttribute('aria-label',`Open ${entry.name||'unnamed image'}`);button.addEventListener('click',()=>selectImage(index));name.append(button);dose.textContent=entry.dose===null?'None':String(entry.dose);zone.textContent=entry.zoneName;row.classList.toggle('is-current',state.ready&&state.index===index);row.addEventListener('click',event=>{if(!event.target.closest('button'))selectImage(index);});row.append(number,name,dose,zone);body.append(row);buttons[index]=button;
      }
      byId('viewer-image-count').textContent=String(visibleIndices.length);empty.hidden=visibleIndices.length>0;empty.textContent=entries.length?'No images match these filters.':'No images loaded.';
    }
    function applyFilters(){window.OM10Session.set('viewerDoseFilter',doseFilter.value);window.OM10Session.set('viewerZoneFilter',zoneFilter.value);updateList();updateAnalysisImageNotice();stopDoseHold();if(!visibleIndices.length){state.request++;state.ready=false;displayedFrame=null;byId('image-frame').hidden=true;status.hidden=false;status.textContent=entries.length?'No images match these filters.':'No image loaded.';byId('image-title').textContent=entries.length?'No matching images':'No image loaded';byId('image-counter').textContent='0 / 0';for(const id of ['selected-number','dose-value','source-name','exposure-field','magnification','resolution','resolution-um','pixel-size'])if(byId(id))byId(id).textContent='—';byId('open-sidecar').disabled=true;grayscaleButton.disabled=true;byId('previous-image').disabled=true;byId('next-image').disabled=true;return;}if(!visibleIndices.includes(state.index)||!state.ready)selectImage(visibleIndices[0]);else renderMetadata(data.images[state.index]);}
    doseFilter.addEventListener('change',applyFilters);zoneFilter.addEventListener('change',applyFilters);updateList();return applyFilters;
  }
  function adjacentIndex(direction){const i=visibleIndices.indexOf(state.index);return i<0?undefined:visibleIndices[i+direction];}

  function renderMetadata(entry) {
    const cropped = state.view === 'cropped';
    const geometry = window.GratingGeometry;
    const rawToCrop = geometry.viewMatrix(entry, 'cropped');
    const centre = geometry.inverseTransform({ x: entry.cropWidth / 2, y: entry.cropHeight / 2 }, rawToCrop);
    const um = pixels => (pixels * entry.pixelSizeUm).toFixed(2);
    const bottomY = entry.height - centre.y;
    const angle = Math.atan2(rawToCrop[1][0], rawToCrop[0][0]) * 180 / Math.PI;
    byId('crop-centre').textContent = `(${um(centre.x)}, ${um(bottomY)}) µm`;
    byId('crop-centre').title = `(${centre.x.toFixed(2)}, ${bottomY.toFixed(2)}) px from the original bottom-left edge`;
    const cropPixel=entry.alignment?.alignedPixelUm??entry.pixelSizeUm;
    byId('crop-size').textContent = `${(entry.cropWidth*cropPixel).toFixed(2)} × ${(entry.cropHeight*cropPixel).toFixed(2)} µm`;
    byId('crop-size').title = `${entry.cropWidth} × ${entry.cropHeight} native pixels`;
    byId('crop-angle').textContent = Math.abs(angle).toFixed(2) + '° ' + (angle < 0 ? 'CCW' : 'CW');
    byId('image-title').textContent = `Picture ${pad(entry.number)} · ${state.pictureSide === 'top' ? 'Top' : 'Bottom'}`;
    byId('source-name').textContent = entry.sourceFilename || entry.filename;
    byId('selected-number').textContent = pad(entry.number);
    byId('dose-value').textContent = doseFormat.format(entry.dose);
    if(byId('exposure-field'))byId('exposure-field').textContent = entry.exposureField ?? 'Unknown';
    byId('viewer-background-name').textContent=entry.backgroundName||'None';updateBackgroundControls(entry);
    byId('magnification').textContent = Number.isFinite(entry.objectiveMagnification) ? `${entry.objectiveMagnification}×` : '—';
    byId('magnification').title = entry.objectiveName || 'Objective magnification from the Leica sidecar';
    window.OM10Filters.setPixelSize(entry.hasCalibration===false ? null : entry.pixelSizeUm);
    sidecarViewer.update(entry);
    const viewWidth = entry.width, viewHeight = entry.height;
    byId('resolution').textContent = `${viewWidth} × ${viewHeight} px`;
    byId('resolution-um').textContent = `${um(viewWidth)} × ${um(viewHeight)} µm`;
    byId('pixel-size').textContent = `${Number(entry.pixelSizeUm.toPrecision(7))} µm`;
    byId('image-version').textContent = (cropped ? (entry.alignment?.recalibrated?'RECALIBRATED':'ROUGHLY ALIGNED') : 'ORIGINAL TIFF') + (state.filter === 'image' ? '' : ' · ' + filterLabels[state.filter].toUpperCase());
    byId('image-channels').textContent = '8-bit grayscale';
    for (const mode of Object.keys(filterLabels)) byId('filter-' + mode).setAttribute('aria-pressed', String(state.filter === mode));
    if(data.importedProject){byId('view-cropped').disabled=!entry.alignment;byId('view-cropped').title=entry.alignment?(entry.alignment.recalibrated?'Recalibrated from zero-order centers':'Rough alignment from zero-order spots'):(entry.alignmentError||'Finding zero-order spots');}
    byId('view-cropped').setAttribute('aria-pressed', String(cropped));
    byId('view-original').setAttribute('aria-pressed', String(!cropped));
    const visiblePosition=visibleIndices.indexOf(state.index);
    byId('image-counter').replaceChildren(document.createTextNode(`${pad(visiblePosition+1)} `));
    const total = document.createElement('span');
    total.textContent = `/ ${visibleIndices.length}`;
    byId('image-counter').append(total);
    byId('orientation-note').textContent = cropped ? '180° rotation corrected by the GIF alignment.' : 'Original TIFF orientation (180° relative to the other images).';
    byId('orientation-note').hidden = !entry.halfTurn;
    byId('previous-image').disabled = adjacentIndex(-1)===undefined;
    byId('next-image').disabled = adjacentIndex(1)===undefined;
    buttons.forEach((button,index)=>{button.setAttribute('aria-pressed',String(index===state.index));button.closest('tr').classList.toggle('is-current',index===state.index);});
    if(data.importedProject){byId('image-title').textContent=entry.name;if(!entry.hasCalibration){byId('resolution-um').textContent='—';byId('pixel-size').textContent='—';}else byId('pixel-size').title=entry.alignment?.recalibrated?'Pixel spacing after zero-order recalibration':'Initial pixel spacing from Leica sidecar';byId('image-channels').textContent='';document.title=entry.name+' · Image viewer';}
    if(data.previewEmpty){byId('image-title').textContent='No image loaded';byId('source-name').textContent='—';byId('selected-number').textContent='—';byId('resolution').textContent='—';byId('resolution-um').textContent='—';byId('pixel-size').textContent='—';byId('image-version').textContent='NO IMAGE';byId('image-channels').textContent='';byId('image-counter').textContent='0 / 0';document.title='Image viewer';}
    else if(!data.importedProject) document.title = `Image ${pad(entry.number)} · Image viewer`;
  }

  // Store the point under the viewport centre in the shared aligned crop frame.
  // Original TIFF centres differ between doses, and Image019 is turned by 180°.
  function cropCamera() {
    if (!displayedFrame || state.fit) return null;
    const centre = { x: displayedFrame.width / 2 - state.x / state.scale,
      y: displayedFrame.height / 2 - state.y / state.scale };
    return { scale: state.scale, centre: displayedFrame.view === 'cropped' ? centre
      : window.GratingGeometry.transform(centre, window.GratingGeometry.viewMatrix(displayedFrame.entry, 'cropped')) };
  }
  function flushCamera() {
    if (!cameraSaveTimer || !displayedFrame) return;
    clearTimeout(cameraSaveTimer);
    cameraSaveTimer = 0;
    window.OM10Session.set('view', { filename: displayedFrame.entry.filename, view: displayedFrame.view,
      filter: displayedFrame.filter, camera: cropCamera(), previousFilename: previousDose?.filename });
  }

  function applyCamera(camera, frame) {
    const previous = displayedFrame;
    displayedFrame = frame;
    if (!camera) { fitImage(); return; }
    const centre = frame.view === 'cropped' ? camera.centre
      : window.GratingGeometry.inverseTransform(camera.centre, window.GratingGeometry.viewMatrix(frame.entry, 'cropped'));
    state.fit = false;
    state.scale = camera.scale;
    const x = (frame.width / 2 - centre.x) * state.scale;
    const y = (frame.height / 2 - centre.y) * state.scale;
    if (!previous || (previous.view === frame.view && (frame.view === 'cropped' || previous.entry === frame.entry))) {
      state.x = x; state.y = y; renderTransform(); // Identical bounds: keep the exact viewport, including its margins.
    } else panTo(x, y); // Respect the pan boundary if the new image cannot cover the same region.
  }

  // Direct-file browsers can display a neighbour PNG but deny canvas pixel reads.
  // The portable wrapper supplies those same PNG bytes as a readable data URL.
  function portableCanny(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.onload = () => { script.remove(); resolve(script.pngUrl); };
      script.onerror = () => { script.remove(); reject(new Error('Missing portable Canny image: ' + src)); };
      script.src = src + '.js';
      document.head.append(script);
    });
  }

  const portableSourceCache=new Map(), portableSourcePending=new Map();
  function portableSource(src) {
    if (portableSourceCache.has(src)) return Promise.resolve(portableSourceCache.get(src));
    if (portableSourcePending.has(src)) return portableSourcePending.get(src);
    const job=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.onload=()=>{const value=script.pngUrl;script.remove();
        if(typeof value!=='string'||!value.startsWith('data:image/png;base64,')) {reject(new Error('Invalid local image wrapper'));return;}
        portableSourceCache.set(src,value);
        while(portableSourceCache.size>3) portableSourceCache.delete(portableSourceCache.keys().next().value);
        resolve(value);};
      script.onerror=()=>{script.remove();reject(new Error('Missing local image wrapper: '+src));};
      script.src=src+'.js';document.head.append(script);
    }).finally(()=>portableSourcePending.delete(src));
    portableSourcePending.set(src,job);return job;
  }
  async function prepareExportProfiles(entry, side, items, settings = {}) {
    const result = new Map(), integral = [...items].filter(([, rect]) => rect.shapeMode === 'integral');
    if (!integral.length) return result;
    if (side !== 'top' && side !== 'bottom') throw new Error('Unknown picture side');
    if (entry[side].placeholder) throw new Error('Image pixels unavailable in this image-free fork');
    const source = entry.file ? await window.ViewerProject.imageUrl(entry) : entry[side].originalSrc;
    const normalized=(settings.mode??state.backgroundMode)==='normalized'&&Boolean(entry.backgroundFile)&&!entry.backgroundError;
    const sigma=settings.sigma??state.backgroundSigma,offset=settings.offset??state.zeroOffset,scale=settings.scale??state.intensityScale;
    const context = { intensitySource: source+(normalized?`|background|${entry.backgroundId}|${sigma}|${offset}`:'|original'), intensityOffset: [0,0],
      loadIntensityValues:normalized?()=>normalizedView.values(entry,sigma,scale,offset):entry.file?()=>window.TiffImage.values(entry.file):null,
      loadIntensityImage: async () => {
        const image = new Image(); image.decoding = 'async';
        image.src = location.protocol === 'file:'&&!source.startsWith('blob:') ? await portableSource(source) : source;
        await image.decode(); return image;
      } };
    const profiles = window.createIntegralProfiles(() => {});
    if (!(await profiles.ready(context))) throw new Error('Original image intensity unavailable');
    for (const [id, rect] of integral) {
      const fraction = (rect.signalRange ?? settings.defaultSignalRange ?? 75) / 100;
      const detail = profiles.details(rect, context, fraction, rect.smoothingSigma ?? 0);
      const position = detail && window.integralPosition(detail, rect.positionMethod || 'maximum');
      const u = position?.position;
      const point = u == null || position.curveValue == null ? null :
        { x: rect.cx + Math.cos(rect.angle)*u, y: rect.cy + Math.sin(rect.angle)*u };
      result.set(id, { detail, position, point });
    }
    return result;
  }
  // The analysis reads the same raw centers and diffraction distances as the viewer.
  // Cache each image independently so editing one rectangle does not decode every TIFF again.
  if (byId('wavelength-histogram')) {
    const panel=byId('analysis-panel'), chart=byId('wavelength-histogram'), message=byId('wavelength-status'), progress=byId('wavelength-progress'), stats=byId('wavelength-statistics'), gapSection=byId('wavelength-gap-section'), gapPlot=byId('wavelength-gap-plot'), gapCaption=byId('wavelength-gap-caption'), includeInput=byId('include-images'), includeError=byId('include-images-error'), imageExclusion=byId('analysis-image-exclusion'), orderInput=byId('analysis-orders'), sideInput=byId('analysis-side'), combinationsNode=byId('analysis-combinations'), binInput=byId('wavelength-bin-width'), binError=byId('wavelength-bin-error'), rangeInput=byId('wavelength-gap-range'), rangeError=byId('wavelength-gap-error'), cache=new Map();
    let revision=0,timer=0,running=false,initialized=false,livePreview=null,liveDirty=false,liveTimer=0,liveVersion=0,lastPlotData=null;
    scheduleWavelengthAnalysis=(delay=120)=>{
      const requested=++revision;clearTimeout(timer);
      timer=setTimeout(()=>run(requested).catch(error=>{if(requested===revision){running=false;initialized=true;progress.hidden=true;chart.replaceChildren();gapSection.hidden=true;stats.hidden=true;message.textContent='Could not calculate wavelengths: '+(error.message||error);}}),delay);
    };
    previewWavelengthAnalysis=(context,items,centres)=>{
      if(panel.hidden||!data.importedProject)return;
      try{const selected=window.ViewerWavelengthHistogram.parseImages(includeInput.value,data.images.length);if(selected&&!selected.has(context.entry.number))return;}catch(_){return;}
      const points=new Map();for(const [id,item] of centres)if(item.measurementRaw)points.set(id,{measurementRaw:{...item.measurementRaw}});
      livePreview={entryId:context.entry.id,signature:JSON.stringify([...items]),centres:points,version:++liveVersion};
      if(running){liveDirty=true;return;}
      if(!liveTimer)liveTimer=setTimeout(()=>{liveTimer=0;liveDirty=false;scheduleWavelengthAnalysis(0);},80);
    };
    endWavelengthPreview=()=>{livePreview=null;liveDirty=false;clearTimeout(liveTimer);liveTimer=0;};
    binInput.value=window.OM10Session.get('analysisHistogramBinWidth','');
    rangeInput.value=window.OM10Session.get('analysisGapErrorRange','50');
    function plotValue(input,fallback,label){
      if(input.validity.badInput)throw new Error(`${label} must be a positive number.`);
      if(input.value.trim()==='')return fallback;
      const value=input.valueAsNumber;if(!Number.isFinite(value)||value<=0)throw new Error(`${label} must be a positive number.`);return value;
    }
    function renderAnalysisPlots(){
      if(!lastPlotData)return;
      const {values,measurements,gap,summary}=lastPlotData;
      try{const width=plotValue(binInput,null,'Bin width');window.ViewerWavelengthHistogram.draw(chart,values,width);binInput.removeAttribute('aria-invalid');binError.hidden=true;}
      catch(error){chart.replaceChildren();binInput.setAttribute('aria-invalid','true');binError.textContent=error.message;binError.hidden=false;}
      gapSection.hidden=!summary;if(!summary)return;
      try{const range=plotValue(rangeInput,50,'Gap error');const sweep=window.ViewerWavelengthHistogram.gapSensitivity(measurements,gap,range);window.ViewerWavelengthHistogram.drawGap(gapPlot,sweep);gapCaption.textContent=(summary.sd===null?'Mean · SD unavailable for one measurement':'Mean ± sample SD')+(gap<=range?' · nonpositive gaps omitted':'');rangeInput.removeAttribute('aria-invalid');rangeError.hidden=true;}
      catch(error){gapPlot.replaceChildren();rangeInput.setAttribute('aria-invalid','true');rangeError.textContent=error.message;rangeError.hidden=false;}
    }
    for(const [input,key,fallback,label] of [[binInput,'analysisHistogramBinWidth',null,'Bin width'],[rangeInput,'analysisGapErrorRange',50,'Gap error']])input.addEventListener('input',()=>{
      try{plotValue(input,fallback,label);window.OM10Session.set(key,input.value);}catch(_){}
      renderAnalysisPlots();
    });
    const filterKey='analysisFilters:'+String(data.maskDesign?.fingerprint||data.maskDesign?.id||'none');
    const savedFilters=window.OM10Session.get(filterKey,{}),excluded=new Set(Array.isArray(savedFilters.excluded)?savedFilters.excluded:[]);
    orderInput.value=['all','-1','1'].includes(savedFilters.order)?savedFilters.order:'all';
    sideInput.value=['all','left','right'].includes(savedFilters.side)?savedFilters.side:'all';
    const available=window.ViewerWavelengthHistogram.combinations([...(data.maskDesign?.spots?.values()||[])].map(spot=>spot.grating));
    for(const option of available){const label=document.createElement('label'),input=document.createElement('input'),text=document.createElement('span');input.type='checkbox';input.value=option.key;input.checked=!excluded.has(option.key);text.textContent=option.label;label.append(input,text);combinationsNode.append(label);}
    if(!available.length){const empty=document.createElement('p');empty.className='rectangle-note';empty.textContent='No pitch / electron dose combinations available.';combinationsNode.append(empty);}
    const filterSettings=()=>({order:orderInput.value,side:sideInput.value,excluded:new Set([...combinationsNode.querySelectorAll('input:not(:checked)')].map(input=>input.value))});
    function updateFilters(){const next=filterSettings();window.OM10Session.set(filterKey,{order:next.order,side:next.side,excluded:[...next.excluded]});lastPlotData=null;chart.replaceChildren();gapSection.hidden=true;stats.hidden=true;message.textContent='Updating wavelengths…';scheduleWavelengthAnalysis();}
    orderInput.addEventListener('change',updateFilters);sideInput.addEventListener('change',updateFilters);combinationsNode.addEventListener('change',updateFilters);
    includeInput.value=window.OM10Session.get('analysisIncludedImages','');
    updateAnalysisImageNotice=()=>{
      let selected;try{selected=window.ViewerWavelengthHistogram.parseImages(includeInput.value,data.previewEmpty?0:data.images.length);}catch(_){imageExclusion.hidden=true;return;}
      const entry=data.images[state.index],excluded=Boolean(selected&&entry&&visibleIndices.includes(state.index)&&!selected.has(entry.number));
      imageExclusion.hidden=!excluded;if(excluded)imageExclusion.textContent=`Image ${entry.number} is not included in Analysis.`;
    };
    includeInput.addEventListener('input',()=>{
      try{window.ViewerWavelengthHistogram.parseImages(includeInput.value,data.previewEmpty?0:data.images.length);window.OM10Session.set('analysisIncludedImages',includeInput.value);includeInput.removeAttribute('aria-invalid');includeError.hidden=true;}
      catch(_){/* Show the validation message without saving an incomplete selection. */}
      updateAnalysisImageNotice();lastPlotData=null;chart.replaceChildren();gapSection.hidden=true;stats.hidden=true;message.textContent='Updating wavelengths…';scheduleWavelengthAnalysis();
    });
    const settings=()=>({mode:state.backgroundMode,sigma:state.backgroundSigma,offset:state.zeroOffset,scale:state.intensityScale,defaultSignalRange:window.OM10Session.get('integralDummyPercent',75)});
    async function run(requested){
      if(requested!==revision)return;
      if(data.importedProject&&!alignmentReady)return;
      running=true;initialized=true;progress.hidden=true;
      let selected;try{selected=window.ViewerWavelengthHistogram.parseImages(includeInput.value,data.previewEmpty?0:data.images.length);includeInput.removeAttribute('aria-invalid');includeError.hidden=true;}
      catch(error){running=false;chart.replaceChildren();gapSection.hidden=true;stats.hidden=true;includeInput.setAttribute('aria-invalid','true');includeError.textContent=error.message;includeError.hidden=false;message.textContent='';return;}
      if(!data.importedProject||!data.maskDesign){running=false;chart.replaceChildren();gapSection.hidden=true;stats.hidden=true;message.textContent='Load images and a mask design to calculate wavelengths.';return;}
      const gap=data.nominalGapUm;
      if(!(Number.isFinite(gap)&&gap>0)){running=false;chart.replaceChildren();gapSection.hidden=true;stats.hidden=true;message.textContent='Set the gap in the import menu to calculate wavelengths.';return;}
      const filtered=selected?data.images.filter(entry=>selected.has(entry.number)):data.images;
      if(!filtered.length){running=false;chart.replaceChildren();gapSection.hidden=true;stats.hidden=true;message.textContent='No images loaded.';return;}
      message.textContent='Calculating wavelengths…';progress.max=filtered.length;progress.value=0;progress.hidden=panel.hidden;const options=settings(),analysisFilters=filterSettings(),side=state.pictureSide,values=[],measurements=[];let unavailable=0,hasPairs=false;
      for(const [index,entry] of filtered.entries()){
        progress.value=index;message.textContent=`Calculating wavelengths… ${index+1} / ${filtered.length} images`;
        if(requested!==revision)return;
        let all;try{all=grating.rectanglesForExport(entry,side);}catch(_){unavailable++;continue;}
        const membership=new Map();
        for(const [id] of all)for(const member of window.ViewerSpotPlacement.members(id)){
          const spot=data.maskDesign.spots.get(member);if(!spot)continue;
          let row=membership.get(spot.grating.id);if(!row){row={grating:spot.grating,zeros:new Set(),firsts:new Map()};membership.set(spot.grating.id,row);}
          if(spot.kind==='zero')row.zeros.add(id);else if(spot.kind==='minus'||spot.kind==='plus')row.firsts.set(id+'|'+spot.kind,{id,spot});
        }
        const ids=new Set(),expected=[];
        for(const row of membership.values())if(row.zeros.size&&row.firsts.size){for(const id of row.zeros)ids.add(id);for(const {id,spot} of row.firsts.values()){ids.add(id);const g=row.grating;expected.push({pitch:g.effectivePitch??g.pitch,electronDose:g.dose??null,side:window.ViewerSpotPlacement.side(data.maskDesign,g)||'unknown',order:spot.kind==='minus'?-1:1});}}
        if(!expected.length)continue;hasPairs=true;
        const items=new Map([...all].filter(([id])=>ids.has(id)).map(([id,r])=>[id,{...r}]));
        const currentPreview=livePreview?.entryId===entry.id&&livePreview.signature===JSON.stringify([...all])?livePreview:null;
        const key=JSON.stringify([side,[...items],entry.hasCalibration,entry.pixelSizeUm,entry.rawToCrop,Boolean(entry.alignment),entry.alignment?.alignedPixelUm,options,entry.backgroundId,entry.backgroundError,currentPreview?.version??null]);
        let decoded=false,result=cache.get(entry.id);if(!result||result.key!==key){
          const storageKey=`wavelength-centres-v1:${side}:${entry.id}`,saved=window.OM10Session.get(storageKey,{}),centres=new Map(),needed=new Map(),keys=new Map();
          if(currentPreview){for(const id of items.keys()){const point=currentPreview.centres.get(id);if(point)centres.set(id,point);}}
          else for(const [id,rect] of items){
            if(rect.shapeMode!=='integral'){centres.set(id,{measurementRaw:{x:rect.cx,y:rect.cy}});continue;}
            const normalized=options.mode==='normalized'&&Boolean(entry.backgroundFile)&&!entry.backgroundError;
            const centerKey=JSON.stringify(['native-intensity-v1',rect.cx,rect.cy,rect.width,rect.height,rect.angle,rect.positionMethod||'maximum',rect.signalRange??options.defaultSignalRange,rect.smoothingSigma??0,normalized?['background',entry.backgroundId,options.sigma,options.offset]:'original']);
            keys.set(id,centerKey);const prior=saved[id];
            if(prior?.key===centerKey&&Number.isFinite(prior.point?.x)&&Number.isFinite(prior.point?.y))centres.set(id,{measurementRaw:prior.point});
            else needed.set(id,rect);
          }
          let changed=false;
          if(needed.size&&entry.hasCalibration&&entry.alignment)try{
            decoded=true;const profiles=await prepareExportProfiles(entry,side,needed,options);
            for(const [id,profile] of profiles){const point=profile?.point;if(point&&Number.isFinite(point.x)&&Number.isFinite(point.y)){saved[id]={key:keys.get(id),point};centres.set(id,{measurementRaw:point});changed=true;}}
          }catch(_){}
          if(changed)window.OM10Session.set(storageKey,saved);
          if(requested!==revision)return;
          const pairs=window.ViewerDistances.measure(data.maskDesign,centres,entry),valid=pairs.filter(p=>Number.isFinite(p.pitch)&&p.pitch>0&&Number.isFinite(p.distanceUm));
          result={key,pairs:valid,expected};cache.set(entry.id,result);
        }
        const matches=pair=>window.ViewerWavelengthHistogram.matchesFilters(pair,analysisFilters),included=result.pairs.filter(matches);
        values.push(...window.ViewerWavelengthHistogram.wavelengths(included,gap));measurements.push(...included);unavailable+=Math.max(0,result.expected.filter(matches).length-included.length);
        if(decoded||index%40===39)await new Promise(resolve=>setTimeout(resolve,0));
      }
      if(requested!==revision)return;
      progress.value=filtered.length;progress.hidden=true;running=false;
      const summary=window.ViewerWavelengthHistogram.statistics(values),format=v=>v===null?'—':Number(v.toPrecision(5)).toString();
      stats.hidden=!summary;if(summary){stats.textContent=`Mean ${format(summary.mean)} · Median ${format(summary.median)} · SD ${format(summary.sd)} nm`;stats.title='SD is the sample standard deviation (n − 1).';}
      lastPlotData={values,measurements,gap,summary};renderAnalysisPlots();
      if(values.length)message.textContent=`${values.length} measurement${values.length===1?'':'s'} · gap ${gap} µm`+(unavailable?` · ${unavailable} unavailable`:'');
      else message.textContent=unavailable?`No usable distances · ${unavailable} unavailable.`:hasPairs?'No measurements match the selected filters.':'Add matching 0 and ±1 rectangles to calculate wavelengths.';
      if(liveDirty&&livePreview){liveDirty=false;scheduleWavelengthAnalysis(0);}
    }
    new MutationObserver(()=>{progress.hidden=panel.hidden||!running;if(!panel.hidden&&!initialized)scheduleWavelengthAnalysis();}).observe(panel,{attributes:true,attributeFilter:['hidden']});
    scheduleWavelengthAnalysis();
  }

  async function resolveBatchPairs(entry, side, items, view) {
    const settings = {mode:state.backgroundMode,sigma:state.backgroundSigma,offset:state.zeroOffset,scale:state.intensityScale,defaultSignalRange: window.OM10Session.get('integralDummyPercent', 75) };
    const profiles = await prepareExportProfiles(entry, side, items, settings);
    const actual = { ...entry, ...entry[side] }, matrix = window.GratingGeometry.viewMatrix(actual, view);
    const centres = new Map(); let unresolved = 0;
    for (const [id, rect] of items) {
      const integral = rect.shapeMode === 'integral';
      const rawPoint = integral ? profiles.get(id)?.point : {x: rect.cx, y: rect.cy};
      if (!rawPoint) { unresolved++; continue; }
      const point = window.GratingGeometry.transform(rawPoint, matrix);
      centres.set(id, {raw:rect, xUm:point.x * (view==='cropped'?(actual.alignment?.alignedPixelUm??actual.pixelSizeUm):actual.pixelSizeUm), usesMaximum:integral, measurementRaw:rawPoint});
    }
    return {pairs:window.createDistanceMeasurements(window.OM10_MASK)(centres), unresolved};
  }

  async function decodeFrame(entry, view, filter) {
    const frame = new Image(); frame.id='micrograph'; frame.draggable=false; frame.decoding='async';
    frame.alt=`${entry.filename}, dose ${doseFormat.format(entry.dose)} mJ/cm², ${view === 'cropped' ? 'native aligned crop' : 'original TIFF pixels'}, ${filterLabels[filter]}`;
    if (entry.placeholder) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${entry.width}" height="${entry.height}"><rect width="100%" height="100%" fill="#25292a"/></svg>`;
      frame.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      await frame.decode();
      return frame;
    }
    const original=entry.file ? await window.ViewerProject.imageUrl(entry) : entry.originalSrc, settings=window.OM10Filters.get();if(entry.file)entry.renderUrl=original;
    let source=original;if(isNormalized(entry))try{source=(await normalizedView.get(entry,state.backgroundSigma,state.intensityScale,state.zeroOffset)).url;}catch(error){entry.backgroundError=error.message||'Background subtraction failed.';source=original;}

    if(filter==='image') {frame.src=source;await frame.decode();return frame;}
    const defaults=settings.sigma===1 && (filter==='canny'
      ? settings.cannyThreshold===1 && settings.cannyLowRatio===.4
      : settings.edgeGain===1 && settings.edgeGamma===.65);
    if(defaults && !entry.filterOnDemand && !isNormalized(entry)) {
      const src=source.replace('images/',`images/${filter}/`);
      try { frame.src=location.protocol==='file:' && filter==='canny' ? await portableCanny(src) : src;
        await frame.decode(); return frame; } catch { /* Generate if the prepared image is unavailable. */ }
    }
    const readable=new Image();readable.decoding='async';
    readable.src=location.protocol==='file:' && !source.startsWith('blob:') ? await portableSource(source) : source;
    await readable.decode();frame.src=await edgeViews.get(readable,source,filter,settings);
    await frame.decode();return frame;
  }

  function getMidpointMask() {
    if (data.images[state.index].placeholder) return null;
    if (filtersAdjusting) return null;
    // Called only during a rectangle edit. Browsing RGB or Scharr needs no extra decode.
    if (midpointMask) return midpointMask.image;
    const entry = data.images[state.index];
    const pending = midpointMask = { entry, image: null };
    pending.promise = decodeFrame(entry, 'original', 'canny').then(mask => {
      if (midpointMask !== pending) return;
      pending.image = mask;
      // Read the current edit again: the rectangle may have moved or been released.
      if (state.ready) grating.render();
      return mask;
    }, error => {
      if (midpointMask !== pending) return;
      console.warn('Could not load the midpoint guide for ' + entry.filename, error);
      // Let a later edit retry without issuing a new request on every pointer move.
      setTimeout(() => { if (midpointMask === pending) midpointMask = null; }, 1000);
    });
    return null;
  }

  async function selectImage(index, prepared = null, camera = cropCamera()) {
    if (index < 0 || index >= data.images.length) return;
    byId('image-frame').hidden=false;maskPicker.close();
    if (!prepared) stopDoseHold();
    grating.finish();
    if(data.importedProject)state.view=preferredView==='cropped'&&data.images[index].alignment?'cropped':'original';
    const view = state.view;
    const request = ++state.request;
    queuedCopy = null;
    state.index = index;
    state.ready = false;
    state.drag = null;
    viewport.classList.remove('is-panning');
    const entry = data.images[index];
    if (midpointMask?.entry !== entry) midpointMask = null;
    const filter = state.filter;
    // Leave the last complete image, metadata and annotations on screen until the swap.
    // On first launch there is no previous frame to show.
    status.hidden = Boolean(displayedFrame);
    if (!displayedFrame) status.textContent = `Loading ${entry.filename}…`;
    viewport.setAttribute('aria-busy', 'true');
    try {
      const nextImage = prepared || await decodeFrame(entry, view, filter);
      if (request !== state.request) return; // A newer selection always wins.
      image.replaceWith(nextImage);
      image = nextImage;
      if (filter === 'canny') midpointMask = { entry, image };
      if (displayedFrame && displayedFrame.entry !== entry) previousDose = displayedFrame.entry;
      state.ready = true;
      updateAnalysisImageNotice();
      if(data.previewEmpty)grayscaleButton.disabled=true;
      if(data.importedProject){grayscaleButton.disabled=entry.isGrayscale===true;grayscaleButton.title=entry.isGrayscale?'Image is already greyscale':'Convert image to greyscale';showGrayscale((entry.isGrayscale||isNormalized(entry))?false:window.OM10Session.get('grayscale',false));}
      renderMetadata(entry);
      applyCamera(camera, { entry, view, filter, matrix: window.GratingGeometry.viewMatrix(entry, view),
        width: view === 'cropped' ? entry.cropWidth : entry.width, height: view === 'cropped' ? entry.cropHeight : entry.height });
      // Start persisting the chosen picture immediately; pagehide is too late
      // for a newly started IndexedDB transaction to be relied upon.
      flushCamera();
      status.hidden = true;
      byId('view-status').textContent = entry.placeholder ? 'No image loaded'  : (filter === 'image' ? (data.importedProject?(view==='cropped'?(entry.alignment?.recalibrated?'Recalibrated · zero-order centers':'Roughly aligned · check zero-order positions'):entry.hasCalibration?(entry.alignment?.recalibrated?'Original TIFF · recalibrated pixel scale':'Original TIFF · sidecar pixel scale'):'Original TIFF · calibration unavailable'):'Roughly aligned · overlay provisional') : `${filterLabels[filter]} · ${data.importedProject?(entry.hasCalibration?(entry.alignment?.recalibrated?'recalibrated':'sidecar pixel scale'):'calibration unavailable'):'overlay position provisional'}`);
      if(state.backgroundMode==='normalized')byId('view-status').textContent=entry.backgroundError||(!entry.backgroundFile?'No background assigned · showing original':`Background: ${entry.backgroundName} · Gaussian σ ${state.backgroundSigma} px`);
      if (queuedCopy) {
        const { resnap } = queuedCopy;
        queuedCopy = null;
        copyPreviousDose(resnap);
      }
    } catch (error) {
      if (request !== state.request) return;
      const source = entry.originalSrc;
      status.hidden = false;
      status.replaceChildren(document.createTextNode(filter === 'image'
        ? `Could not open ${source}. Keep the images folder beside index.html.`
        : `Could not prepare ${filterLabels[filter].toLowerCase()}. Try again or switch to Image.`));
      const retry = document.createElement('button');
      retry.className = 'text-button';
      retry.textContent = 'Try again';
      retry.addEventListener('click', () => selectImage(state.index, null, camera));
      status.append(retry);
      byId('view-status').textContent = 'Image unavailable';
      console.error(`Unable to load ${source}`, error);
    } finally {
      if (request === state.request) viewport.setAttribute('aria-busy', 'false');
    }
  }

  function updatePictureSideButtons() {
    byId('side-top').setAttribute('aria-pressed', String(state.pictureSide === 'top'));
    byId('side-bottom').setAttribute('aria-pressed', String(state.pictureSide === 'bottom'));
  }
  for (const side of ['top', 'bottom']) {
    byId(side === 'top' ? 'side-top' : 'side-bottom').addEventListener('click', () => {
      if (state.pictureSide === side) return;
      const camera = cropCamera();
      grating.finish();
      maskPicker.close();
      state.pictureSide = side;
      window.OM10Session.set('pictureSide', side);
      spotOverview.refreshSide();
      midpointMask = null;
      previousDose = null;
      ++copySequence;
      updatePictureSideButtons();
      grating.clearPictureSide();
      notifyCalculator('resetSide');
      scheduleWavelengthAnalysis();
      compare?.refreshSide();
      data.images.forEach(refreshMapCount);
      selectImage(state.index, null, camera);
    });
  }
  updatePictureSideButtons();

  function fitScale() {
    return Math.min(1, Math.max(1, viewport.clientWidth - 56) / displayedFrame.width,
      Math.max(1, viewport.clientHeight - 72) / displayedFrame.height);
  }

  function renderTransform() {
    if (!state.ready) return;
    const { width, height, matrix } = displayedFrame;
    const [[a, c, tx], [b, d, ty]] = matrix;
    imageFrame.style.width = `${width * state.scale}px`;
    imageFrame.style.height = `${height * state.scale}px`;
    imageFrame.style.transform = `translate(-50%, -50%) translate(${state.x}px, ${state.y}px)`;
    image.style.width = `${image.naturalWidth * state.scale}px`;
    image.style.height = `${image.naturalHeight * state.scale}px`;
    image.style.transform = `matrix(${a}, ${b}, ${c}, ${d}, ${tx * state.scale}, ${ty * state.scale})`;
    image.classList.toggle('magnified-pixels', state.scale > 1);
    const entry=data.images[state.index],normalized=isNormalized(entry);
    histogram.update({ready:state.ready&&!entry.placeholder,image,filter:state.filter,normalized,side:state.pictureSide,sigma:state.backgroundSigma,intensityScale:state.intensityScale,zeroOffset:state.zeroOffset,entry,matrix,scale:state.scale,panX:state.x,panY:state.y,frameWidth:width,frameHeight:height,viewportWidth:viewport.clientWidth,viewportHeight:viewport.clientHeight});
    const marker=byId('gaussian-radius'),radius=state.backgroundSigma*state.scale*Math.hypot(matrix[0][0],matrix[1][0]);marker.toggleAttribute('hidden',!normalized);const diameter=Math.max(4,2*radius+4);marker.setAttribute('width',diameter);marker.setAttribute('height',diameter);const circle=marker.querySelector('circle');circle.setAttribute('cx',diameter/2);circle.setAttribute('cy',diameter/2);circle.setAttribute('r',radius);

    if (!state.cleanImage) {
      window.renderPitchRuler(viewport, displayedFrame, state.scale, state.x, state.y);
      window.renderPixelGrid(viewport, displayedFrame, state.scale, state.x, state.y);
    }
    renderScaleBar();
    byId('zoom-value').textContent = `${Math.round(state.scale * 100)}%`;
    byId('fit-image').setAttribute('aria-pressed', String(state.fit));
    byId('actual-size').setAttribute('aria-pressed', String(!state.fit && Math.abs(state.scale - 1) < .001));
    viewport.classList.add('can-pan');
    grating.render();
    if (!cameraSaveTimer) cameraSaveTimer = setTimeout(flushCamera, 100);
  }

  // Both versions have the same physical pixel calibration. Adapt the labelled
  // distance to the screen zoom; do not round the CSS width of the scale line.
  function renderScaleBar() {
    if(data.previewEmpty || data.images[state.index].hasCalibration===false){byId('scale-bar').hidden=true;return;}
    const current=data.images[state.index],pixelSize=state.view==='cropped'?(current.alignment?.alignedPixelUm??current.pixelSizeUm):current.pixelSizeUm;
    const available = Math.min(160, viewport.clientWidth * .25);
    const distances = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1];
    const lengthUm = distances.find(length => length / pixelSize * state.scale <= available) || 1;
    const lengthPx = lengthUm / pixelSize * state.scale;
    byId('scale-line').style.width = `${lengthPx}px`;
    byId('scale-label').textContent = `${lengthUm} µm`;
    byId('scale-bar').setAttribute('aria-label', `Scale bar: ${lengthUm} micrometres`);
    byId('scale-bar').style.bottom = viewport.clientWidth < 480 ? '72px' : '18px';
    byId('scale-bar').hidden = false;
  }

  const bgPanel=byId('background-parameters'),bgToggle=byId('background-parameters-toggle');
  function closeBgPanel(){bgPanel.hidden=true;bgToggle.setAttribute('aria-expanded','false');}
  bgToggle.addEventListener('click',()=>{bgPanel.hidden=!bgPanel.hidden;bgToggle.setAttribute('aria-expanded',String(!bgPanel.hidden));if(!bgPanel.hidden){const anchor=bgToggle.getBoundingClientRect();bgPanel.style.left=Math.max(8,Math.min(anchor.left,innerWidth-bgPanel.offsetWidth-8))+'px';bgPanel.style.top=Math.max(8,Math.min(anchor.bottom+8,innerHeight-bgPanel.offsetHeight-8))+'px';}});
  byId('background-parameters-close').addEventListener('click',()=>{closeBgPanel();bgToggle.focus();});
  document.addEventListener('pointerdown',event=>{if(!bgPanel.hidden&&!bgPanel.contains(event.target)&&!bgToggle.contains(event.target))closeBgPanel();},true);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!bgPanel.hidden){closeBgPanel();bgToggle.focus();event.preventDefault();event.stopPropagation();}},true);
  const gaussianInput=byId('background-sigma'),zeroOffsetInput=byId('zero-offset');gaussianInput.value=state.backgroundSigma;zeroOffsetInput.value=state.zeroOffset;
  function updateBackgroundControls(entry=data.images[state.index]){
    const available=Boolean(entry?.backgroundFile&&!entry.backgroundError),active=isNormalized(entry);
    byId('background-normalized').disabled=!available;byId('background-normalized').title=entry?.backgroundError||(!entry?.backgroundFile?'Assign a background in the import menu':`Subtract ${entry.backgroundName}`);
    byId('background-original').setAttribute('aria-pressed',String(!active));byId('background-normalized').setAttribute('aria-pressed',String(active));
    for(const scale of ['lin','log']){byId('intensity-'+scale).setAttribute('aria-pressed',String(state.intensityScale===scale));byId('intensity-'+scale).disabled=!available;}
    gaussianInput.disabled=!available;zeroOffsetInput.disabled=!available;
  }
  function refreshBackground(){scheduleWavelengthAnalysis();midpointMask=null;compare?.refreshSide();for(const entry of data.images)compare?.invalidate(entry.filename);updateBackgroundControls();selectImage(state.index);}
  for(const mode of ['original','normalized'])byId('background-'+mode).addEventListener('click',()=>{if(state.backgroundMode===mode)return;state.backgroundMode=mode;window.OM10Session.set('backgroundMode',mode);refreshBackground();});
  for(const scale of ['lin','log'])byId('intensity-'+scale).addEventListener('click',()=>{if(state.intensityScale===scale)return;state.intensityScale=scale;window.OM10Session.set('intensityScale',scale);refreshBackground();});
  for(const [input,key,max] of [[gaussianInput,'backgroundSigma',100],[zeroOffsetInput,'zeroOffset',Infinity]]){
    let editTimer=0;
    function commit(){clearTimeout(editTimer);const n=input.valueAsNumber;if(!input.checkValidity()||!Number.isFinite(n)||n<0||n>max)return;if(state[key]===n&&state.backgroundMode==='normalized')return;state[key]=n;state.backgroundMode='normalized';window.OM10Session.set(key,n);window.OM10Session.set('backgroundMode','normalized');refreshBackground();}
    input.addEventListener('input',()=>{clearTimeout(editTimer);editTimer=setTimeout(commit,250);});
    input.addEventListener('change',commit);
    input.addEventListener('keydown',event=>{if(event.key!=='Enter')return;event.preventDefault();event.stopPropagation();if(input.reportValidity())commit();});
  }

  function setView(view) {
    preferredView=view;if(data.importedProject)window.OM10Session.set('alignmentPreference',view);
    if (view === state.view) return;
    state.view = view; // Global: preserved when selecting any other dose.
    selectImage(state.index);
  }

  function fitImage() {
    if (!state.ready) return;
    state.fit = true;
    state.scale = fitScale();
    state.x = state.y = 0;
    renderTransform();
  }

  function panTo(x, y) {
    if (!state.ready) return;
    const pan = limitMicrographPan(x, y, displayedFrame.width * state.scale, displayedFrame.height * state.scale,
      viewport.clientWidth, viewport.clientHeight);
    state.x = pan.x;
    state.y = pan.y;
    renderTransform();
  }

  function zoomTo(scale, pointer = lastPointer) {
    if (!state.ready) return;
    const bounds = viewport.getBoundingClientRect();
    const cursorX = pointer ? pointer.clientX - bounds.left - viewport.clientLeft - viewport.clientWidth / 2 : 0;
    const cursorY = pointer ? pointer.clientY - bounds.top - viewport.clientTop - viewport.clientHeight / 2 : 0;
    // In the margin, use the nearest image point. On the image, anchor exactly at the cursor.
    const halfW = displayedFrame.width * state.scale / 2, halfH = displayedFrame.height * state.scale / 2;
    const anchorX = Math.max(state.x - halfW, Math.min(state.x + halfW, cursorX));
    const anchorY = Math.max(state.y - halfH, Math.min(state.y + halfH, cursorY));
    const next = Math.max(Math.min(.05, fitScale()), Math.min(64, scale));
    const ratio = next / state.scale;
    state.x = anchorX - (anchorX - state.x) * ratio;
    state.y = anchorY - (anchorY - state.y) * ratio;
    state.scale = next;
    state.fit = false;
    renderTransform();
  }

  const HOLD_DELAY_MS = 300;
  const FRAME_PERIOD_MS = 100;
  function stopDoseHold() {
    if (!doseHold) return;
    clearTimeout(doseHold.timer);
    doseHold = null;
  }

  async function playDoses(hold) {
    let due = performance.now();
    while (doseHold === hold) {
      const index = adjacentIndex(hold.direction), request = state.request;
      if (index===undefined) break;
      try {
        // Decode one frame ahead while the current one is still displayed.
        const frame = await decodeFrame(data.images[index], state.view, state.filter);
        const wait = due - performance.now();
        if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
        if (doseHold !== hold || request !== state.request) break;
        due = performance.now() + FRAME_PERIOD_MS;
        if (hold.pointerId !== undefined) consumedClick = hold.button;
        await selectImage(index, frame);
        if (hold.fromMap) buttons[index].focus({ preventScroll: true });
      } catch (error) {
        // Use the normal navigator's retry and on-screen error handling.
        if (doseHold === hold && request === state.request) selectImage(index);
        break;
      }
    }
    if (doseHold === hold) stopDoseHold();
  }

  function startDoseHold(hold) {
    stopDoseHold();
    doseHold = hold;
    hold.timer = setTimeout(() => playDoses(hold), HOLD_DELAY_MS);
  }
  function keyboardDoseStep(event, button, direction) {
    event.preventDefault();
    if (event.repeat || adjacentIndex(direction)===undefined) return;
    const fromMap = event.target.classList.contains('map-cell');
    selectImage(adjacentIndex(direction));
    if (fromMap) buttons[state.index].focus({ preventScroll: true });
    startDoseHold({ button, direction, key: event.key, fromMap });
  }
  for (const [id, direction] of [['previous-image', -1], ['next-image', 1]]) {
    const button = byId(id);
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !event.isPrimary || button.disabled) return;
      consumedClick = null;
      button.setPointerCapture(event.pointerId);
      startDoseHold({ button, direction, pointerId: event.pointerId });
    });
    button.addEventListener('keydown', event => {
      if (event.key === 'Enter') keyboardDoseStep(event, button, direction);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      button.addEventListener(type, event => {
        if (doseHold?.button === button && doseHold.pointerId === event.pointerId) stopDoseHold();
      });
    }
    button.addEventListener('click', event => {
      const alreadyStepped = event.detail > 0 && consumedClick === button;
      consumedClick = null;
      if (!alreadyStepped && adjacentIndex(direction)!==undefined) selectImage(adjacentIndex(direction));
    });
  }
  window.addEventListener('keyup', event => {
    if (doseHold?.key === event.key) stopDoseHold();
  });
  window.addEventListener('blur', stopDoseHold);
  window.addEventListener('pagehide', stopDoseHold);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopDoseHold(); });
  function setFilter(mode) {
    if (state.filter === mode) return;
    grating.finish(); state.filter = mode;
    selectImage(state.index);
  }
  const filterModes = Object.keys(filterLabels);
  for (const mode of filterModes) byId('filter-' + mode).addEventListener('click', () => setFilter(mode));
  function queueFilteredRefresh() {
    filterRefreshPending=true;
    if (!filterRefreshRunning) void runFilteredRefresh();
  }
  async function runFilteredRefresh() {
    if(filterRefreshRunning)return; filterRefreshRunning=true;
    try {
      while(filterRefreshPending) {
        if(!state.ready || !displayedFrame || state.filter==='image') break;
        filterRefreshPending=false;
        const entry=data.images[state.index], mode=state.filter, view=state.view, request=state.request;
        try {
          byId('view-status').textContent=`Updating ${filterLabels[mode]}…`;
          const next=await decodeFrame(entry,view,mode);
          if(request!==state.request || entry!==data.images[state.index] || mode!==state.filter || view!==state.view) continue;
          image.replaceWith(next);image=next;
          if(mode==='canny' && !filtersAdjusting && !filterRefreshPending) midpointMask={entry,image};
          renderTransform();
          byId('view-status').textContent=filterRefreshPending ? `Updating ${filterLabels[mode]}…` : `${filterLabels[mode]} · native pixels`;
        } catch(error) { if(request===state.request) byId('view-status').textContent=`Could not update ${filterLabels[mode]}.`; console.error('Filter update failed',error); }
      }
    } finally { filterRefreshRunning=false; if(filterRefreshPending && state.ready && state.filter!=='image') void runFilteredRefresh(); }
  }
  window.OM10Filters.subscribe((settings,changed)=>{
    const cannyChanged=['sigma','cannyThreshold','cannyLowRatio'].some(k=>changed.has(k));
    const contrastChanged=['sigma','edgeGain','edgeGamma'].some(k=>changed.has(k));
    const midpointChanged=changed.has('midpointRadius');
    if(cannyChanged || midpointChanged) grating.finish();
    if(cannyChanged){midpointMask=null;filtersAdjusting=true;clearTimeout(filterIdleTimer);
      filterIdleTimer=setTimeout(()=>{filtersAdjusting=false;if(state.ready)grating.render();},300);}
    if((state.filter==='canny'&&cannyChanged)||(state.filter==='scharr'&&contrastChanged)) queueFilteredRefresh();
    else if((cannyChanged||midpointChanged)&&state.ready) grating.render();
  });
  byId('view-cropped').addEventListener('click', () => setView('cropped'));
  byId('view-original').addEventListener('click', () => setView('original'));
  byId('fit-image').addEventListener('click', fitImage);
  byId('actual-size').addEventListener('click', () => zoomTo(1));
  byId('zoom-out').addEventListener('click', () => zoomTo(state.scale / 1.25));
  byId('zoom-in').addEventListener('click', () => zoomTo(state.scale * 1.25));
  viewport.addEventListener('wheel', event => {
    if (event.target.closest('.zoom-toolbar, #gap-correction-menu')) return;
    event.preventDefault();
    if (grating.isDragging()) return;
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
    lastPointer = { clientX: event.clientX, clientY: event.clientY };
    zoomTo(state.scale * Math.exp(-Math.max(-150, Math.min(150, delta)) * .006), lastPointer);
  }, { passive: false });
  viewport.addEventListener('pointerdown', event => {
    if (!state.ready || event.button !== 0 || event.ctrlKey || event.target.closest('button, .zoom-toolbar, #gap-correction-menu')) return;
    beginPan(event);
  });
  function beginPan(event) {
    viewport.focus({ preventScroll: true });
    state.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: state.x, startY: state.y, moved: false,
      compareLayer: !!compare && !!event.target.closest('#compare-layer'), compareSpot: compare ? event.target.closest('#compare-layer [data-spot]')?.dataset.spot : null,
      frame: displayedFrame };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add('is-panning');
  }
  viewport.addEventListener('pointermove', event => {
    if (!event.target.closest('.zoom-toolbar')) lastPointer = { clientX: event.clientX, clientY: event.clientY };
    const drag = state.drag;
    if (!drag || drag.id !== event.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 3) return;
    drag.moved = true;
    state.fit = false;
    panTo(drag.startX + event.clientX - drag.x, drag.startY + event.clientY - drag.y);
  });
  function endDrag(event) {
    if (state.drag?.id !== event.pointerId) return;
    const drag = state.drag;
    const blankClick = event.type === 'pointerup' && !drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 3;
    state.drag = null;
    viewport.classList.remove('is-panning');
    if (!blankClick || state.cleanImage) return;
    if (drag.compareLayer) {
      if (drag.frame === displayedFrame && drag.compareSpot) compare?.pick(drag.compareSpot);
    } else if (!maskPicker.guideRects) grating.select(null);
  }
  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('pointercancel', endDrag);
  viewport.addEventListener('lostpointercapture', endDrag);
  document.addEventListener('click', event => {
    if (state.cleanImage || !state.ready || !event.detail || event.button !== 0 ||
        event.target.closest('#viewport, [data-draggable-popup], [data-rectangle-id], button, input, label, select, textarea, summary, a, [role="separator"], [contenteditable="true"]')) return;
    grating.select(null);
  });

  function replayEdit(event, forward) {
    const field = document.activeElement;
    if (state.cleanImage) return;
    if (field?.isContentEditable || (field?.matches('input, textarea') && !field.matches('.rectangle-input'))) return;
    event.preventDefault();
    stopDoseHold();
    if (field?.matches('.rectangle-input')) {
      const invalid = !field.validity.valid;
      field.blur(); // Commit a valid draft so a single undo restores its starting value.
      if (invalid) return;
    }
    const filenames = grating.replayEdit(forward);
    if (filenames.length && !filenames.includes(data.images[state.index].filename)) {
      selectImage(data.images.findIndex(entry => entry.filename === filenames[0]));
    } else if (filenames.length) byId('view-status').textContent = forward ? 'Redid rectangle edit.' : 'Undid rectangle edit.';
  }
  document.addEventListener('beforeinput', event => {
    if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
      replayEdit(event, event.inputType === 'historyRedo');
    }
  });
  async function copyPreviousDose(resnap) {
    stopDoseHold();
    if (!state.ready) {
      // Right followed immediately by Space should work before the new PNG decodes.
      if (viewport.getAttribute('aria-busy') === 'true') queuedCopy = { resnap };
      return;
    }
    const feedback = byId('view-status'), request = state.request, sequence = ++copySequence;
    const stillCurrent = () => request === state.request && sequence === copySequence;
    if (!previousDose) { feedback.textContent = 'View another EUV dose first to copy its rectangles.'; return; }
    try {
      const message = await grating.duplicateFrom(previousDose, resnap, stillCurrent);
      await window.OM13Storage.flush();
      if (stillCurrent()) feedback.textContent = message;
    } catch (error) {
      if (stillCurrent()) feedback.textContent = 'Could not copy rectangles: ' + error.message;
    }
  }
  // In Position mode, select every rectangle in the currently displayed image.
  document.addEventListener('keydown', event => {
    if (!document.getElementById('folder-loader').hidden) return;
    if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.isComposing ||
        event.key.toLowerCase() !== 'a' || !state.ready || state.cleanImage || byId('position-panel').hidden ||
        event.target.isContentEditable || event.target.closest?.('input, textarea, select, [contenteditable], #rectangle-menu, #sidecar-dialog, #gap-correction-menu, #analysis-calc-settings, #compare-histogram-settings')) return;
    event.preventDefault(); event.stopPropagation();
    if (!event.repeat && !grating.isDragging()) grating.selectAll();
  }, true);
  // These are workspace shortcuts, even when the last click focused a spot or a handle.
  // Text fields and the open context menu retain their native editing shortcuts.
  document.addEventListener('keydown', event => {
    if (!document.getElementById('folder-loader').hidden) return;
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.target.isContentEditable ||
        event.target.closest?.('input, textarea, select, #rectangle-menu, #filter-parameters, #filter-parameters-toggle, #sidecar-dialog, #open-sidecar, #analysis-calculator, #analysis-calc-settings, #compare-histogram-settings, .compare-histogram-gear')) return;
    if (event.target.closest?.('#right-sidebar-tabs')) return;
    if (event.key === ' ' && (event.target === cleanButton || (state.cleanImage && event.target.closest('button')))) return;
    if (!event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.stopPropagation();
      const next = event.key === 'ArrowRight';
      keyboardDoseStep(event, byId(next ? 'next-image' : 'previous-image'), next ? 1 : -1);
    } else if (!event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat && !grating.isDragging()) {
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setFilter(filterModes[(filterModes.indexOf(state.filter) + step + filterModes.length) % filterModes.length]);
      }
    } else if (event.code === 'Space' || event.key === ' ') {
      event.preventDefault(); event.stopPropagation();
      if (!state.cleanImage && !event.repeat && !grating.isDragging()) copyPreviousDose(event.shiftKey);
    } else if (!event.shiftKey) {
      const command = { c:'canny', m:'midpoint', r:'remove', backspace:'remove', delete:'remove' }[event.key.toLowerCase()];
      if (!command) return;
      event.preventDefault(); event.stopPropagation();
      if (!state.cleanImage && !event.repeat) grating.selectionCommand(command);
    }
  }, true);
  document.addEventListener('keydown', event => {
    if (event.target.closest?.('#sidecar-dialog, #open-sidecar, #analysis-calculator, #analysis-calc-settings, #compare-histogram-settings')) return;
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'z') {
      replayEdit(event, event.shiftKey);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable) return;
    if (event.key.toLowerCase() === 'f') { event.preventDefault(); fitImage(); }
    else if (event.key === '1') { event.preventDefault(); zoomTo(1); }
    else if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomTo(state.scale * 1.25); }
    else if (event.key === '-') { event.preventDefault(); zoomTo(state.scale / 1.25); }
  });
  new ResizeObserver(() => state.fit ? fitImage() : panTo(state.x, state.y)).observe(viewport);
  // Fit only explicit zero-order measurements; rough detections supply translations
  // for other images and never affect the common scale or rotation.
  const recalibrateButton=byId('recalibrate'), recalibrationStatus=byId('recalibration-status');
  let alignmentReady=false;
  function calibrationSignature(){
    const mask=data.maskDesign;
    return JSON.stringify({version:1,side:state.pictureSide,mask:mask?.id,fingerprint:mask?.fingerprint,
      spots:mask?[...mask.spots.values()].map(s=>[s.id,s.x,s.y,s.kind,s.grating.width,s.grating.height]):[],
      zones:mask?.zones,images:data.images.map(e=>[e.id,e.width,e.height,e.basePixelSizeUm,e.zoneId])});
  }
  function zeroSnapshots(){
    return data.images.map(entry=>{
      const items=grating.rectanglesForExport(entry,state.pictureSide), zero=new Map(),seen=new Set();
      for(const [id,rect] of items){const members=window.ViewerSpotPlacement.members(id),spots=members.map(key=>data.maskDesign.spots.get(key));
        if(spots.length!==1||spots[0]?.kind!=='zero'||seen.has(spots[0].grating.id))continue;
        const g=spots[0].grating;if(!Number.isFinite(g.x)||!Number.isFinite(g.y))continue;
        seen.add(g.id);zero.set(id,{...rect});
      }
      return {entry,zero};
    });
  }
  const snapshotKey=snaps=>JSON.stringify(snaps.map(s=>[s.entry.id,[...s.zero]]));
  function calibrationBounds(){
    const footprints=[];
    for(const entry of data.images)for(const group of window.ViewerMask.forImage(data.maskDesign,entry).groups)for(const spot of group.spots){
      const g=spot.grating;if(!(Number.isFinite(g.x)&&Number.isFinite(g.y)&&g.width>0&&g.height>0))continue;
      footprints.push({x:g.x,y:g.y,width:g.width,height:g.height});
      if(Number.isFinite(spot.x)&&Number.isFinite(spot.y))footprints.push({x:spot.x,y:spot.y,width:g.width,height:g.height});
    }
    if(!footprints.length)return null;
    return {top:Math.max(...footprints.map(p=>p.y+p.height/2)),bottom:Math.min(...footprints.map(p=>p.y-p.height/2)),margin:Math.max(...footprints.map(p=>p.height))/2,maxX:Math.max(...footprints.map(p=>Math.abs(p.x)+p.width/2))};
  }
  function applyCalibration(record){
    const plans=new Map(record.plan.images.map(p=>[p.id,p]));
    for(const entry of data.images){const p=plans.get(entry.id);if(!p)continue;
      for(const frame of [entry.top,entry.bottom]){
        frame.pixelSizeUm=p.pixelSizeUm;
        if(p.matrix){frame.rawToCrop=p.matrix;frame.cropWidth=p.cropWidth;frame.cropHeight=p.cropHeight;
          frame.alignment={...(frame.alignment||{}),angle:-record.fit.rotation,originCropY:p.originCropY,alignedPixelUm:p.alignedPixelUm,recalibrated:true,translationSource:p.source};
        }else{frame.rawToCrop=[[1,0,0],[0,1,0],[0,0,1]];frame.cropWidth=frame.width;frame.cropHeight=frame.height;frame.alignment=null;}
      }
      entry.alignmentError=p.matrix?'':'No zero-order center available for translation';
    }
    const rect=record.plan.images.filter(p=>p.source==='rectangles').length,auto=record.plan.images.filter(p=>p.source==='detection').length,missing=data.images.length-rect-auto;
    recalibrationStatus.textContent=`${record.fit.points} centers · ×${record.fit.factor.toFixed(5)} · ${(record.fit.rotation*180/Math.PI).toFixed(3)}° · RMS ${record.fit.rmsUm.toFixed(2)} µm. ${rect} measured, ${auto} detected${missing?`, ${missing} unavailable`:''}.`;recalibrationStatus.title=`${record.fit.points} zero-order centers from ${record.fit.images} images; ${rect} images aligned from rectangles, ${auto} from detection, ${missing} unavailable.`;
    byId('viewer-alignment-status').textContent='Recalibrated from zero-order rectangles';
    for(const entry of data.images)compare?.invalidate(entry.filename);
    compare?.refreshSide();notifyCalculator('resetSide');midpointMask=null;scheduleWavelengthAnalysis();
  }
  recalibrateButton?.addEventListener('click',async()=>{
    if(!alignmentReady||!data.maskDesign)return;
    recalibrateButton.disabled=true;recalibrationStatus.textContent='Reading zero-order centers…';
    try{
      grating.finish();const signature=calibrationSignature(),snapshots=zeroSnapshots(),before=snapshotKey(snapshots),settings={mode:state.backgroundMode,sigma:state.backgroundSigma,offset:state.zeroOffset,scale:state.intensityScale,defaultSignalRange:window.OM10Session.get('integralDummyPercent',75)},side=state.pictureSide;
      const observations=[];let skipped=0;
      for(let i=0;i<snapshots.length;i++){
        const {entry,zero}=snapshots[i],points=[];let profiles=new Map();
        if([...zero.values()].some(rect=>rect.shapeMode==='integral'))try{profiles=await prepareExportProfiles(entry,side,zero,settings);}catch(_){skipped += [...zero.values()].filter(rect=>rect.shapeMode==='integral').length;}
        for(const [id,rect] of zero){const spot=data.maskDesign.spots.get(window.ViewerSpotPlacement.members(id)[0]);const raw=rect.shapeMode==='integral'?profiles.get(id)?.point:{x:rect.cx,y:rect.cy};
          if(!raw||!Number.isFinite(raw.x)||!Number.isFinite(raw.y)){if(rect.shapeMode==='integral'&&profiles.size)skipped++;continue;}
          points.push({raw,mask:{x:spot.grating.x,y:-spot.grating.y}});
        }
        const roughPoints=(entry.roughMatches||entry.alignment?.matches||[]).map(m=>{const spot=data.maskDesign.spots.get(m.id+':zero');return spot?{raw:{x:m.x,y:m.y},mask:{x:spot.grating.x,y:-spot.grating.y}}:null;}).filter(p=>p&&[p.raw.x,p.raw.y,p.mask.x,p.mask.y].every(Number.isFinite));
        observations.push({id:entry.id,width:entry.width,height:entry.height,pixelSizeUm:entry.basePixelSizeUm,points,roughPoints});
        if(i%8===0){recalibrationStatus.textContent=`Reading zero-order centers… ${i+1} / ${snapshots.length}`;await new Promise(resolve=>setTimeout(resolve,0));}
      }
      if(side!==state.pictureSide||signature!==calibrationSignature()||before!==snapshotKey(zeroSnapshots())||JSON.stringify(settings)!==JSON.stringify({mode:state.backgroundMode,sigma:state.backgroundSigma,offset:state.zeroOffset,scale:state.intensityScale,defaultSignalRange:window.OM10Session.get('integralDummyPercent',75)}))throw new Error('Measurements or settings changed during recalibration. Please run it again.');
      const fit=window.ViewerRecalibration.fit(observations);if(!fit)throw new Error('At least one image needs two distinct usable zero-order rectangle centers and a sidecar pixel size.');
      const bounds=calibrationBounds();if(!bounds)throw new Error('The mask design needs grating positions and dimensions.');
      const plan=window.ViewerRecalibration.plan(observations,fit,bounds);if(!plan)throw new Error('No calibrated image is available.');
      const record={version:1,signature,fit,plan};window.OM10Session.set('recalibration-v1',record);await window.OM13Storage.flush();
      applyCalibration(record);if(skipped)recalibrationStatus.textContent+=` ${skipped} integral center(s) unavailable.`;
      await selectImage(state.index,null,null);
    }catch(error){recalibrationStatus.textContent='Recalibration failed: '+(error.message||error);}
    finally{recalibrateButton.disabled=!alignmentReady;}
  });

  function savedStateAlignment(){
    if(!data.importedProject||!data.maskDesign)return null;
    return {version:1,signature:calibrationSignature(),images:data.images.map(entry=>({id:entry.id,error:entry.alignmentError||'',roughMatches:entry.roughMatches||[],frames:[entry.top,entry.bottom].map(frame=>({pixelSizeUm:frame.pixelSizeUm,rawToCrop:frame.rawToCrop,cropWidth:frame.cropWidth,cropHeight:frame.cropHeight,alignment:frame.alignment}))}))};
  }
  function restoreStateAlignment(record){
    if(record?.version!==1||record.signature!==calibrationSignature()||!Array.isArray(record.images)||record.images.length!==data.images.length)return false;
    const entries=new Map(record.images.map(item=>[item.id,item]));
    for(const entry of data.images){const item=entries.get(entry.id);if(!item||!Array.isArray(item.frames)||item.frames.length!==2)return false;
      for(const frame of item.frames){if(!Number.isFinite(frame.pixelSizeUm)||frame.pixelSizeUm<=0||!Number.isFinite(frame.cropWidth)||frame.cropWidth<1||!Number.isFinite(frame.cropHeight)||frame.cropHeight<1||!Array.isArray(frame.rawToCrop)||frame.rawToCrop.length!==3||!frame.rawToCrop.every(row=>Array.isArray(row)&&row.length===3&&row.every(Number.isFinite)))return false;}}
    for(const entry of data.images){const item=entries.get(entry.id);entry.alignmentError=item.error||'';entry.roughMatches=Array.isArray(item.roughMatches)?item.roughMatches:[];[entry.top,entry.bottom].forEach((frame,index)=>{const value=item.frames[index];frame.pixelSizeUm=value.pixelSizeUm;frame.rawToCrop=value.rawToCrop;frame.cropWidth=value.cropWidth;frame.cropHeight=value.cropHeight;frame.alignment=value.alignment;});}return true;
  }
  window.setupPositionsExport?.({data,finish:grating.finish,getRectangles:(entry,side)=>grating.rectanglesForExport(entry,side),background:normalizedView,getProcessing:()=>({backgroundMode:state.backgroundMode,backgroundSigma:state.backgroundSigma,zeroOffset:state.zeroOffset,intensityScale:state.intensityScale,displayFilter:state.filter,filters:window.OM10Filters.get(),defaultSignalRange:window.OM10Session.get('integralDummyPercent',75),pictureSide:state.pictureSide})});
  window.setupViewerState?.({data,alignmentSnapshot:savedStateAlignment,beforeSave:async()=>{
    if(data.importedProject&&data.maskDesign&&!alignmentReady)throw new Error('Wait for image alignment to finish before saving.');
    grating.finish();flushCamera();window.OM10Session.set('viewerDoseFilter',byId('viewer-dose-filter').value);window.OM10Session.set('viewerZoneFilter',byId('viewer-zone-filter').value);
  }});

  if(data.importedProject&&data.maskDesign)byId('import-rectangles').disabled=false;
  window.addEventListener('pagehide', flushCamera);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushCamera(); });
  const applyInitialFilters=buildMap();
  const saved = window.OM10Session.get('view', {});
  preferredView = data.importedProject ? window.OM10Session.get('alignmentPreference','cropped') : saved.view === 'original' ? 'original' : 'cropped';
  state.view = data.importedProject ? 'original' : preferredView;
  if(data.importedProject){byId('view-cropped').disabled=true;byId('view-cropped').title='Alignment is not available yet';}
  state.filter = Object.hasOwn(filterLabels, saved.filter) ? saved.filter : 'image';
  const index = Math.max(0, data.images.findIndex(entry => entry.filename === saved.filename));
  previousDose = data.images.find(entry => entry.filename === saved.previousFilename && entry !== data.images[index]) || null;
  const camera = saved.camera;
  const validCamera = Number.isFinite(camera?.scale) && camera.scale > 0 && camera.scale <= 64 &&
    Number.isFinite(camera.centre?.x) && Number.isFinite(camera.centre?.y);
  const restoredStateAlignment=Boolean(data.importedProject&&data.maskDesign&&restoreStateAlignment(window.OM10Session.get('stateRestoreAlignment',null)));
  if(data.importedProject&&!visibleIndices.length){applyInitialFilters();window.restoreViewerPanels();}
  else selectImage(visibleIndices.includes(index)||!data.importedProject?index:visibleIndices[0], null, validCamera ? camera : null).then(() => {if(window.viewerProjectError){status.hidden=false;status.textContent='Could not restore project: '+window.viewerProjectError;}window.restoreViewerPanels();});
  if(data.importedProject&&data.maskDesign){const notice=byId('viewer-alignment-status'),restored=restoredStateAlignment;notice.textContent=restored?'Restoring saved alignment…':'Finding zero-order spots…';(restored?Promise.resolve({aligned:data.images.filter(e=>e.alignment).length,total:data.images.length}):window.ViewerAlignment.run(data,(n,total)=>{notice.textContent=`Finding zero-order spots… ${n} / ${total}`;})).then(result=>{notice.textContent=`Rough alignment: ${result.aligned} / ${result.total} images`+(result.aligned<result.total?' · unavailable images stay original':'');const savedCalibration=window.OM10Session.get('recalibration-v1',null);if(savedCalibration?.version===1&&savedCalibration.signature===calibrationSignature())applyCalibration(savedCalibration);else if(savedCalibration)recalibrationStatus.textContent='Saved calibration does not match this project; recalibrate again.';scheduleWavelengthAnalysis();if(!restored&&visibleIndices.includes(state.index))selectImage(state.index);}).catch(error=>{notice.textContent='Rough alignment failed: '+error.message;}).finally(()=>{alignmentReady=true;recalibrateButton.disabled=false;scheduleWavelengthAnalysis();});}
})();

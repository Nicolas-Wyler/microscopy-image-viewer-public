/* Editable coloured spot outlines, in raw TIFF coordinates, grouped by dose. */
'use strict';
window.createGratingOverlay = function ({ store, viewport, getContext, getFieldEdit, onChange, onDistances, onSavedRectangles, onDuplicate, onPositionMethodChange, onRectanglePreview, onRectanglePreviewEnd }) {
  const G = window.GratingGeometry;
  const layer = document.getElementById('grating-overlay');
  const editLayer = document.getElementById('grating-edit-overlay');
  const template = document.getElementById('grating-shape').cloneNode(true);
  layer.replaceChildren();
  const doses = new Map(), selected = new Map(), nodes = new Map();
  const history = window.createRectangleHistory(window.OM10Session);
  const saveStates = new Map();
  const integralProfiles = window.createIntegralProfiles(() => render());
  const saveStatus = document.getElementById('rectangle-save-status');
  let lastSaveState = null;
  function updateSaveStatus() {
    if (!lastSaveState) return;
    const storageError = window.OM13Storage.error;
    saveStatus.textContent = storageError ? 'Save failed: export your work before closing this page.' : window.OM13Storage.pending ? 'Saving…' : drag ? 'Editing…' : lastSaveState.text;
    saveStatus.classList.toggle('save-error', Boolean(storageError || lastSaveState.error));
    saveStatus.hidden = !(storageError || lastSaveState.error);
    saveStatus.title = storageError ? String(storageError) : lastSaveState.error || 'Rectangles are saved in this browser for this app address.';
  }
  window.addEventListener('om13-storage-status', updateSaveStatus);
  const drawDistances = window.createDistanceGuides(document.getElementById('distance-guides'));
  const measureDistances = window.createDistanceMeasurements(window.OM10_MASK);
  const drawMidpoints = window.createCannyMidpointGuide();
  const distanceButton = document.getElementById('show-distances');
  let drag = null, keyEdit = null, distancesPinned = window.OM10Session.get('showDistances') === true;
  let snapEpoch = 0;
  const feedback = document.getElementById('view-status');
  const menu = window.createRectangleMenu({ layer, select, render, snap,
    exportIntegral: id => {
      const context=getContext(), rect=rectangles(context).get(id);
      const spot=(window.OM10_DATA.importedProject?window.ViewerSpotPlacement.definitions(window.OM10_DATA):window.rectangleSpotDefinitions()).find(item=>item.id===id);
      if (!rect || !spot || rect.shapeMode!=='integral') return 'Select an Integral rectangle.';
      const fraction=menu.fraction('integral',id), detail=integralProfiles.details(rect,context,fraction,rect.smoothingSigma ?? 0);
      if (!detail) return 'Curve unavailable: check signal range and image loading.';
      window.exportIntegralCsv({entry:context.entry,context,spot,rect,detail,signalRange:fraction*100});
      return 'CSV downloaded.';
    },
    getPositionMethod: id => rectangles().get(id)?.positionMethod || 'maximum',
    setPositionMethod: (id, method) => {
      const context=getContext(), items=rectangles(context), rect=items.get(id); if (!rect || rect.positionMethod === method) return;
      const before=new Map([[id,rect]]);items.set(id,{...rect,positionMethod:method});
      save(context);recordGroup(context,before);onPositionMethodChange?.();
    },
    getMode: id => rectangles().get(id)?.shapeMode || 'square',
    getSmoothing: id => rectangles().get(id)?.smoothingSigma ?? 0,
    setSmoothing: (id, value) => {
      const context=getContext(), items=rectangles(context), rect=items.get(id); if (!rect) return;
      const before=new Map([[id,rect]]); items.set(id,{...rect,smoothingSigma:value});
      save(context); recordGroup(context,before);
    },
    getSignalRange: id => rectangles().get(id)?.signalRange ?? window.OM10Session.get('integralDummyPercent', 75),
    setSignalRange: (id, value) => {
      const context = getContext(), items = rectangles(context), rect = items.get(id);
      if (!rect) return;
      const before = new Map([[id, rect]]);
      items.set(id, { ...rect, signalRange: value });
      save(context); recordGroup(context, before);
    },
    applyMode: mode => {
      const context = getContext(), items = rectangles(context), before = snapshot(context);
      for (const id of before.keys()) items.set(id, { ...items.get(id), shapeMode: mode });
      save(context); recordGroup(context, before); onPositionMethodChange?.();
    },
    remove: () => remove(expandPairs(rectangles(), selection())),
    duplicate: id => {
      const context=getContext(), rect=rectangles(context).get(id);
      if (context.ready && rect) onDuplicate?.({filename:context.entry.filename,rect:{...rect}});
    } });
  distanceButton.setAttribute('aria-pressed', String(distancesPinned));
  distanceButton.addEventListener('click', () => {
    distancesPinned = !distancesPinned;
    window.OM10Session.set('showDistances', distancesPinned);
    distanceButton.setAttribute('aria-pressed', String(distancesPinned));
    render();
    if(!distancesPinned && window.OM10_DATA.importedProject && feedback)feedback.textContent='Distances hidden.';
  });
  const key = context => context.entry.filename;
  const mapping = context => G.viewMatrix(context.entry, context.view);
  const degrees = angle => G.normalize(angle) * 180 / Math.PI;
  const matrixAngle = matrix => Math.atan2(matrix[1][0], matrix[0][0]);
  const attrs = (element, values) => Object.entries(values).forEach(([name, value]) => element.setAttribute(name, value));
  function rectangles(context = getContext()) {
    if (!doses.has(key(context))) {
      try {
        const saved = store.load(key(context));
        doses.set(key(context), window.OM10SpotColors.apply(saved.items));
        selected.set(key(context), saved.selected);
        onSavedRectangles(context.entry.filename, saved.items, false);
        saveStates.set(key(context), { text: saved.saved ? 'Saved locally' : 'Autosave on' });
      } catch (error) {
        doses.set(key(context), new Map());
        saveStates.set(key(context), { text: 'Autosave unavailable', error: error.message, readError: true });
        console.warn('Could not restore rectangles for ' + key(context), error);
      }
    }
    const items = doses.get(key(context));
    for (const [id, rect] of items) { const color=window.OM10SpotColors.forSpot(id); if(color && rect.color!==color) items.set(id,{...rect,color}); }
    return items;
  }
  function save(context = getContext()) {
    try {
      store.save(key(context), rectangles(context), selected.get(key(context)));
      onSavedRectangles(context.entry.filename, rectangles(context));
      saveStates.set(key(context), { text: 'Saved locally' });
    } catch (error) {
      saveStates.set(key(context), { ...saveStates.get(key(context)), text: 'Not saved locally', error: error.message });
      console.warn('Could not save rectangles for ' + key(context), error);
    }
  }
  function recordEdit(context, id, before) {
    recordGroup(context, new Map([[id, before]]));
  }
  function selection(context = getContext()) {
    rectangles(context); // Load the dose and its selection together.
    return selected.get(key(context)) || [];
  }
  function snapshot(context, ids = selection(context)) {
    const items = rectangles(context);
    return new Map(ids.filter(id => items.has(id)).map(id => [id, items.get(id)]));
  }
  function expandPairs(items, ids) {
    const expanded=new Set(ids), pairs=window.OM10RectangleUnion.innerPairs(window.OM10_MASK,items);
    for (const id of ids) for (const partner of pairs.get(id)?.ids || []) expanded.add(partner);
    return [...expanded];
  }
  function recordGroup(context, before) {
    const items = rectangles(context);
    history.record(Array.from(before, ([id, rect]) => ({ filename: key(context), id, before: rect, after: items.get(id) })));
  }
  function applyGroup(items, before, anchorId, next, action) {
    const anchor = before.get(anchorId);
    for (const [id, rect] of before) items.set(id, G.peerEdit(anchor, next, rect, action));
  }
  function screenToRaw(clientX, clientY, context) {
    const bounds = viewport.getBoundingClientRect();
    return G.inverseTransform({
      x: (clientX - bounds.left - viewport.clientLeft - viewport.clientWidth / 2 - context.panX) / context.scale + context.width / 2,
      y: (clientY - bounds.top - viewport.clientTop - viewport.clientHeight / 2 - context.panY) / context.scale + context.height / 2,
    }, mapping(context));
  }
  function nodeFor(id) {
    if (nodes.has(id)) return nodes.get(id);
    const node = template.cloneNode(true);
    for (const element of [node, ...node.querySelectorAll('[id]')]) element.id += '-' + id;
    node.dataset.outlineId = id;
    nodes.set(id, node); layer.append(node);
    return node;
  }
  function render() {
    const context = getContext(), storedItems = rectangles(context), ids = selection(context);
    const field = getFieldEdit();
    let items = storedItems;
    if (field && ids.includes(field.id)) {
      const rect = storedItems.get(field.id), next = G.withMeasurement(rect, context.entry, context.view, field.name, field.value);
      if (next) { items = new Map(storedItems); applyGroup(items, snapshot(context), field.id, next); }
    }
    const saved = saveStates.get(key(context));
    lastSaveState = saved;
    updateSaveStatus();
    onChange?.({ ready: context.ready && !context.cleanImage, entry: context.entry, view: context.view,
      active: [...items].map(([id, rect]) => ({ id, ...rect, selected: ids.includes(id) })) });
    layer.toggleAttribute('hidden', !context.ready || items.size === 0);
    editLayer.setAttribute('hidden', ''); editLayer.replaceChildren();
    for (const [id, node] of nodes) if (!items.has(id)) { node.remove(); nodes.delete(id); }
    const centres = new Map();
    if (!context.ready || !items.size) {
      if(context.ready&&window.OM10_DATA.importedProject&&distancesPinned&&feedback)feedback.textContent=context.entry.hasCalibration&&context.entry.alignment?'Place a zero-order and a first-order rectangle for the same grating to show distances.':'A sidecar pixel size and rough alignment are needed to show distances.';
      drawMidpoints(context.pickerRects || [], context, viewport); drawDistances([], null, false); onDistances([], context); return;
    }
    const matrix = mapping(context), rectScale=context.scale*Math.hypot(matrix[0][0],matrix[1][0]),displayPixel=context.view==='cropped'?(context.entry.alignment?.alignedPixelUm??context.entry.pixelSizeUm):context.entry.pixelSizeUm;
    const unionPairs = window.OM10RectangleUnion.innerPairs(window.OM10_MASK, items);
    const editingId = drag?.outlineId || keyEdit?.id || field?.id || menu.target?.id;
    const pairBoundaries = new Map();
    const editing = drag || keyEdit;
    const activelyEdited = editing ? [...editing.before.keys()] : field ? [field.id] : [];
    const invertedIds = new Set(editing?.linkedIds || activelyEdited);
    for (const id of activelyEdited) for (const member of unionPairs.get(id)?.ids || []) invertedIds.add(member);
    const guideIds = new Set(expandPairs(items, [...ids, ...(editingId ? [editingId] : [])]));
    const guideRects = [...(context.pickerRects || [])];
    const guidedPairs = new Set();
    const originX = viewport.clientWidth / 2 + context.panX, originY = viewport.clientHeight / 2 + context.panY;
    for (const [id, rect] of items) {
      const centre = G.transform({ x: rect.cx, y: rect.cy }, matrix);
      const angle = rect.angle + matrixAngle(matrix);
      const x = originX + (centre.x - context.width / 2) * context.scale;
      const y = originY + (centre.y - context.height / 2) * context.scale;
      const detail = rect.shapeMode === 'integral' ? integralProfiles.details(rect, context, menu.fraction('integral', id), rect.smoothingSigma ?? 0) : null;
      const values = detail?.normalized;
      const positionMethod = rect.positionMethod || 'maximum';
      const result = detail ? window.integralPosition(detail, positionMethod) : null;
      const useIntegral = rect.shapeMode === 'integral';
      if (useIntegral && menu.target?.id === id) menu.positionStatus(id,
        detail && positionMethod === 'inflection' && result?.position == null ? 'Derivative extrema unavailable in the signal range. Try smoothing or widening the range.' : '');
      if (!useIntegral || (result?.position != null && result.curveValue != null)) {
        const u = useIntegral ? result.position : 0;
        const point = G.transform({ x:rect.cx + Math.cos(rect.angle)*u, y:rect.cy + Math.sin(rect.angle)*u }, matrix);
        const px=originX+(point.x-context.width/2)*context.scale, py=originY+(point.y-context.height/2)*context.scale;
        centres.set(id, { x:px, y:py, boxX:x, boxY:y, raw:rect, width:rect.width*rectScale, height:rect.height*rectScale,
          angle:degrees(angle), xUm:point.x*displayPixel, color:rect.color, label:rect.label, usesMaximum:useIntegral,
          measurementRaw:{x:rect.cx+Math.cos(rect.angle)*u,y:rect.cy+Math.sin(rect.angle)*u} });
      }
      if (context.cleanImage) continue;
      if (context.pickerRects || guideIds.has(id)) {
        const guidePair=unionPairs.get(id);
        if (rect.shapeMode === 'integral') guideRects.push({boundarySides: window.CannySampling.sides(rect).filter(side => side.name === 'top' || side.name === 'bottom')});
        else if (!guidePair) guideRects.push(rect);
        else if (!guidedPairs.has(guidePair)) {
          guidedPairs.add(guidePair);
          const boundary=window.OM10RectangleUnion.pairBoundary(...guidePair.rects,1,guidePair.union);
          if (boundary) guideRects.push({boundarySides:boundary.segments});
        }
      }
      const shape = nodeFor(id), outline = shape.querySelector('[data-action="move"]');
      const w = rect.width * rectScale, h = rect.height * rectScale;
      const integral = rect.shapeMode === 'integral';
      shape.classList.toggle('integral-outline', integral);
      const curve = shape.querySelector('.integral-profile');
      const maxLine = shape.querySelector('.integral-maximum'), maxCross = shape.querySelector('.integral-maximum-cross');
      // Both curves share one plotting area, with their own display ranges:
      // intensity and its derivative have different units.
      const signalValues=(values||[]).filter(Number.isFinite),signalMin=signalValues.length?Math.min(...signalValues):0,signalMax=signalValues.length?Math.max(...signalValues):1;
      const signalDisplay=value=>signalMax>signalMin?(value-signalMin)/(signalMax-signalMin):0;
      const profileGap=8*rectScale, profileHeight=32*rectScale;
      const showMarker = integral && result?.position != null && result.curveValue != null;
      maxLine.toggleAttribute('hidden', !showMarker); maxCross.toggleAttribute('hidden', !showMarker);
      if (showMarker) {
        const markerX=result.position*rectScale, markerY=-h/2-profileGap-profileHeight*signalDisplay(result.curveValue);
        maxLine.setAttribute('d', `M${markerX} ${markerY}V0`);
        maxCross.setAttribute('d', `M${markerX-4} 0H${markerX+4} M${markerX} -4V4`);
      }
      const derivativePath=shape.querySelector('.integral-derivative');
      const showDerivative=integral && positionMethod==='inflection' && result?.derivative;
      derivativePath.toggleAttribute('hidden', !showDerivative);
      const derivativeMax=shape.querySelector('.derivative-maximum'), derivativeMin=shape.querySelector('.derivative-minimum');
      const showExtrema=Boolean(showDerivative && result.derivativeMaximumPosition !== null && result.derivativeMinimumPosition !== null);
      derivativeMax.toggleAttribute('hidden', !showExtrema); derivativeMin.toggleAttribute('hidden', !showExtrema);
      if (showDerivative) {
        const validDerivative=result.derivative.filter(Number.isFinite), dMin=validDerivative.length?Math.min(...validDerivative):0,dMax=validDerivative.length?Math.max(...validDerivative):0; const derivativeDisplay=value=>dMax>dMin?(value-dMin)/(dMax-dMin):0; let pen=false;
        const path=result.derivative.map((value,i)=>{
          if(value===null){pen=false;return '';}
          const dx=detail.positions[i]*rectScale, dy=-h/2-profileGap-profileHeight*derivativeDisplay(value);
          const command=pen?'L':'M';pen=true;return `${command}${dx} ${dy}`;
        }).join(' ');
        derivativePath.setAttribute('d',path);
        if (showExtrema) {
          for (const [marker, position] of [[derivativeMax,result.derivativeMaximumPosition],[derivativeMin,result.derivativeMinimumPosition]]) {
            const index=detail.positions.indexOf(position), value=result.derivative[index];
            marker.setAttribute('cx', position*rectScale);
            marker.setAttribute('cy', -h/2-profileGap-profileHeight*derivativeDisplay(value));
            marker.setAttribute('r', 2 * rectScale);
          }
        }
      }
      curve.toggleAttribute('hidden', !values);
      if (values) {
        const gap = profileGap, amplitude = profileHeight; let pen = false;
        const path = values.map((value, i) => {
          if (value === null) { pen = false; return ''; }
          const x = detail.positions[i] * rectScale, y = -h / 2 - gap - amplitude * signalDisplay(value);
          const command = pen ? 'L' : 'M'; pen = true; return `${command}${x} ${y}`;
        }).join(' ');
        curve.setAttribute('d', path);
      }
      const integralEdges = shape.querySelector('.integral-edges'), integralCentre = shape.querySelector('.integral-centre');
      integralEdges.toggleAttribute('hidden', !integral); integralCentre.toggleAttribute('hidden', !integral);
      if (integral) { integralEdges.setAttribute('d', `M${-w/2} ${-h/2}H${w/2} M${-w/2} ${h/2}H${w/2}`); integralCentre.setAttribute('d', `M${-w/2} 0H${w/2}`); }
      const pair=unionPairs.get(id), index=pair?.ids.indexOf(id);
      const segments=pair && (index===0 ? pair.union.first : pair.union.second);
      const interior=pair && (index===0 ? pair.union.firstInterior : pair.union.secondInterior);
      const unionOutline = shape.querySelector('.grating-union'), interiorOutline=shape.querySelector('.grating-interior');
      const pathFor = parts => parts.map(segment =>
        `M${segment.x1 * rectScale} ${segment.y1 * rectScale}L${segment.x2 * rectScale} ${segment.y2 * rectScale}`).join(' ');
      outline.classList.toggle('union-hidden', Boolean(segments));
      unionOutline.toggleAttribute('hidden', integral || !segments);
      if (segments) unionOutline.setAttribute('d', pathFor(segments));
      interiorOutline.toggleAttribute('hidden', integral || !interior?.length);
      if (interior?.length) interiorOutline.setAttribute('d',pathFor(interior));
      const ticks = shape.querySelector('.snap-ticks');
      const pairIndex=pair?.ids.indexOf(id) ?? -1;
      ticks.removeAttribute('hidden');
      const fraction = menu.fraction(integral ? 'integral' : 'square', id), halfTick = Math.min(4, Math.min(w, h) / 9);
      const marks = [];
      if (!integral && pairIndex >= 0 && pair.rects.every(item => item.shapeMode !== 'integral')) {
        if (!pairBoundaries.has(pair)) pairBoundaries.set(pair, window.OM10RectangleUnion.pairBoundary(...pair.rects, fraction, pair.union));
        const boundary = pairBoundaries.get(pair);
        if (boundary) for (const tick of boundary.ticks[pairIndex]) marks.push(
          `M${tick.x*rectScale-tick.nx*halfTick} ${tick.y*rectScale-tick.ny*halfTick}l${2*tick.nx*halfTick} ${2*tick.ny*halfTick}`);
      } else for (const side of [-1, 1]) for (const end of [-1, 1]) {
        marks.push(`M${end*fraction*w/2} ${side*h/2-halfTick}v${2*halfTick}`);
        if (!integral) marks.push(`M${side*w/2-halfTick} ${end*fraction*h/2}h${2*halfTick}`);
      }
      for (const path of ticks.children) path.setAttribute('d', marks.join(' '));
      attrs(shape, { transform: `translate(${x} ${y}) rotate(${degrees(angle)})`, 'data-width-px': rect.width,
        'data-height-px': rect.height, 'data-raw-cx': rect.cx, 'data-raw-cy': rect.cy, 'data-raw-angle': rect.angle });
      shape.classList.toggle('selected-outline', ids.includes(id));
      shape.style.setProperty('--outline-color', rect.color);
      const inverted = invertedIds.has(id);
      shape.style.opacity = inverted ? '0' : '1';
      attrs(outline, { x: -w / 2, y: -h / 2, width: w, height: h,
        'aria-pressed': ids.includes(id), 'aria-label': `Move ${rect.label}, ${(rect.width * context.entry.pixelSizeUm).toFixed(1)} by ${(rect.height * context.entry.pixelSizeUm).toFixed(1)} micrometres` });
      const handleScale = Math.min(1, Math.min(w, h) / 60);
      const stem = 24 * handleScale;
      attrs(shape.querySelector('.rotation-stem'), { x1: 0, x2: 0, y1: integral ? h / 2 : -h / 2, y2: integral ? h / 2 + stem : -h / 2 - stem });
      const placements = { 'top-left': [-w / 2, -h / 2], 'top-right': [w / 2, -h / 2],
        'bottom-left': [-w / 2, h / 2], 'bottom-right': [w / 2, h / 2],
        left: [-w / 2, 0], right: [w / 2, 0], top: [0, -h / 2], bottom: [0, h / 2],
        rotate: [0, integral ? h / 2 + stem : -h / 2 - stem] };
      for (const [name, [hx, hy]] of Object.entries(placements)) {
        shape.querySelector(`[data-action="${name}"]`).setAttribute('transform', `translate(${hx} ${hy}) scale(${handleScale})`);
      }
      if (inverted) {
        // A separate blended SVG inverts the pixels beneath the edited selection.
        // The original SVG retains pointer capture and focus throughout the edit.
        const editing = shape.cloneNode(true);
        for (const element of [editing, ...editing.querySelectorAll('[id], [tabindex]')]) {
          element.removeAttribute('id'); element.removeAttribute('tabindex');
        }
        editing.removeAttribute('data-outline-id');
        editing.style.opacity = '1'; editing.style.setProperty('--outline-color', '#fff');
        editLayer.append(editing); editLayer.removeAttribute('hidden');
      }
    }
    const selectedId = ids.at(-1);
    const generic=window.OM10_DATA.importedProject;
    const pairs = generic ? window.ViewerDistances.measure(window.OM10_DATA.maskDesign,centres,context.entry) : measureDistances(centres);
    if(generic&&distancesPinned&&feedback){if(!pairs.length)feedback.textContent=context.entry.hasCalibration&&context.entry.alignment?'Place a zero-order and a first-order rectangle for the same grating to show distances.':'A sidecar pixel size and rough alignment are needed to show distances.';else if(feedback.textContent.startsWith('Place a zero-order')||feedback.textContent.startsWith('A sidecar pixel size'))feedback.textContent='Distances shown in µm.';}
    drawMidpoints(guideRects, context, viewport);
    if (!context.cleanImage) drawDistances(pairs, editingId, distancesPinned);
    onDistances(generic ? [] : pairs, context);
    if(drag?.moved)onRectanglePreview?.(context,items,centres);
    const activeNode = nodes.get(selectedId);
    if (activeNode && layer.lastElementChild !== activeNode) {
      if (layer.moveBefore) layer.moveBefore(activeNode, null);
      else if (!activeNode.contains(document.activeElement)) layer.append(activeNode);
    }
  }
  function finish(cancel = false) {
    snapEpoch++;
    menu.close();
    endKeyEdit();
    if (!drag) return;
    const previous = drag;
    if (cancel) for (const [id, rect] of previous.before) rectangles(previous.context).set(id, rect);
    drag = null; onRectanglePreviewEnd?.(); layer.classList.remove('dragging');
    if (layer.hasPointerCapture(previous.id)) layer.releasePointerCapture(previous.id);
    save(previous.context);
    if (!cancel) recordGroup(previous.context, previous.before);
    render();
  }
  function remove(ids) {
    finish();
    const context = getContext(), items = rectangles(context);
    const before = snapshot(context, ids);
    if (!before.size) return;
    for (const id of before.keys()) items.delete(id);
    selected.set(key(context), selection(context).filter(id => !before.has(id)));
    save(context);
    recordGroup(context, before);
    render();
    feedback.textContent = `Removed ${before.size} rectangle${before.size === 1 ? '' : 's'}.`;
  }
  function fitOnImage(rect, mode, fraction, image) {
    return window.fitRectangleToCanny(rect, mode, fraction, image.naturalWidth, image.naturalHeight, window.CannySampling.raster(image));
  }
  function fitPairOnImage(pair, mode, fraction, image) {
    return window.fitRectanglePairToCanny(...pair.rects,mode,fraction,image.naturalWidth,image.naturalHeight,window.CannySampling.raster(image));
  }
  async function snap(target, mode, fraction) {
    const context = getContext(), items = rectangles(context);
    const selectedIds = selection(context), expanded = new Set(selectedIds);
    for (const id of selectedIds) if (items.get(id)?.shapeMode !== 'integral') {
      for (const partner of expandPairs(items, [id])) if (items.get(partner)?.shapeMode !== 'integral') expanded.add(partner);
    }
    const before = snapshot(context, [...expanded]), epoch = ++snapEpoch;
    if (!context.ready || !before.size) return 'Select a rectangle first.';
    if (!fraction) return 'Set a snap range above 0%.';
    const image = await context.loadSnapMask();
    if (epoch !== snapEpoch || menu.target !== target || getContext().entry !== context.entry ||
        rectangles(context) !== items || [...before].some(([id, rect]) => items.get(id) !== rect)) return '';
    if (!image) return 'Could not read the Canny image.';
    const fits = new Map(), visited=new Set(), pairs=window.OM10RectangleUnion.innerPairs(window.OM10_MASK,items);
    for (const [id, rect] of before) {
      if (visited.has(id)) continue;
      const pair=pairs.get(id);
      if (rect.shapeMode !== 'integral' && pair && pair.ids.every(member=>before.has(member) && items.get(member)?.shapeMode !== 'integral')) {
        const next=fitPairOnImage(pair,mode,fraction,image);
        pair.ids.forEach(member=>visited.add(member));
        if (next) pair.ids.forEach((member,i)=>fits.set(member,{...next.rects[i],snapMode:mode}));
        continue;
      }
      const next = fitOnImage(rect, mode, fraction, image);
      if (next) fits.set(id, { ...next, snapMode: mode });
    }
    if (!fits.size) return mode === 'midpoint' ? 'Too few consistent midpoints in range.' : 'Too few consistent Canny pixels in range.';
    for (const [id, rect] of fits) items.set(id, rect);
    save(context); recordGroup(context, before); render();
    feedback.textContent = `Snapped ${fits.size} of ${before.size} to ${mode === 'canny' ? 'Canny' : 'midpoints'}.` +
      (fits.size < before.size ? ' Unmatched rectangles stayed in place.' : '');
    return '';
  }
  function initialSpot(context,spot) {
    // A picker selection uses the exact centre shown in the corrected overlay.
    if (spot.pickerPlacement) return {...spot.pickerPlacement,color:spot.color,label:spot.label};
    const peers = window.OM10_DATA.images.filter(entry => entry.filename !== context.entry.filename).flatMap(entry => {
      const rect = rectangles({ entry }).get(spot.id);
      return rect ? [{ entry, rect }] : [];
    });
    return G.seedFromPeers(context.entry, peers, spot) || G.seedSpot(context.entry, window.OM10_MASK, spot);
  }
  function toggleSpot(spot) {
    const context = getContext();
    if (!context.ready) return;
    finish();
    if (rectangles(context).has(spot.id)) { remove([spot.id]); return; }
    rectangles(context).set(spot.id, { ...initialSpot(context,spot), ...menu.defaults() });
    selected.set(key(context), [spot.id]); save(context); recordEdit(context, spot.id, undefined); render();
  }
  function duplicateSpot(spot,source) {
    const context=getContext(), items=rectangles(context);
    if (!context.ready || source?.filename!==context.entry.filename || !source.rect || items.has(spot.id)) return;
    finish();
    const original=source.rect, seed=initialSpot(context,spot);
    let copy={...seed,width:original.width,height:original.height,angle:original.angle};
    let fits=true;
    if (context.view==='cropped') ({rect:copy,fits}=G.keepInsideCrop(copy,context.entry));
    items.set(spot.id,copy);
    selected.set(key(context),[spot.id]); save(context); recordEdit(context,spot.id,undefined); render();
    feedback.textContent=fits ? `Duplicated to ${spot.label}.` :
      `Duplicated to ${spot.label}; its original dimensions do not fit entirely inside the crop.`;
  }
  layer.addEventListener('pointerdown', event => {
    const target = event.target.closest('[data-action]'), context = getContext();
    if (!target || !context.ready || event.button !== 0 || event.ctrlKey || drag) return;
    const outlineId = target.closest('[data-outline-id]').dataset.outlineId;
    event.preventDefault(); event.stopPropagation();
    target.focus({ preventScroll: true }); // Commits a focused sidebar field before taking the drag snapshot.
    const rect = rectangles(context).get(outlineId);
    if (!rect) return;
    const wasSelected = selection(context).includes(outlineId);
    select(outlineId, event.metaKey ? 'toggle' : 'keep');
    if (!selection(context).includes(outlineId)) return;
    drag = { id: event.pointerId, action: target.dataset.action, outlineId, before: snapshot(context),
      linkedIds: expandPairs(rectangles(context),selection(context)),
      collapseOnClick: !event.metaKey && wasSelected && selection(context).length > 1 && target.dataset.action === 'move',
      startX: event.clientX, startY: event.clientY, moved: false,
      context, rect, from: screenToRaw(event.clientX, event.clientY, context) };
    layer.setPointerCapture(event.pointerId); layer.classList.add('dragging'); render();
  });
  layer.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 2) return;
    drag.moved = true;
    const to = screenToRaw(event.clientX, event.clientY, drag.context);
    const delta = { x: to.x - drag.from.x, y: to.y - drag.from.y };
    const { rect, action } = drag;
    let next;
    if (action === 'move') next = G.move(rect, delta);
    else if (action === 'rotate') next = G.rotate(rect, drag.from, to);
    else next = G.resize(rect, action, delta);
    applyGroup(rectangles(drag.context), drag.before, drag.outlineId, next, action); render();
  });
  layer.addEventListener('pointerup', event => {
    if (drag?.id !== event.pointerId) return;
    event.stopPropagation();
    const only = drag.collapseOnClick && !drag.moved && drag.outlineId;
    finish();
    if (only) select(only, 'only');
  });
  layer.addEventListener('pointercancel', event => { if (drag?.id === event.pointerId) finish(true); });
  layer.addEventListener('lostpointercapture', event => {
    // A descendant can lose implicit capture when the shared SVG takes it.
    if (event.target === layer && drag?.id === event.pointerId && !layer.hasPointerCapture(event.pointerId)) finish();
  });
  layer.addEventListener('dblclick', event => event.stopPropagation());
  layer.addEventListener('keydown', event => {
    const target = event.target.closest('[data-action]'), context = getContext();
    const id = target?.closest('[data-outline-id]')?.dataset.outlineId;
    const rect = rectangles(context).get(id);
    if (!target || !rect || !context.ready) return;
    if (event.ctrlKey || event.metaKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Escape', 'Enter'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Escape') { finish(true); return; }
    if (event.key === 'Enter') { if (!event.repeat) select(id, event.shiftKey ? 'toggle' : 'only'); return; }
    if (!selection(context).includes(id)) select(id);
    const action = target.dataset.action, step = event.shiftKey ? 10 : 1;
    const sign = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1;
    let next;
    if (action === 'rotate') next = { ...rect, angle: G.normalize(rect.angle + sign * step * Math.PI / 180) };
    else if (action === 'move') {
      const delta = { x: event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
        y: event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0 };
      next = G.move(rect, G.turn(delta, -matrixAngle(mapping(context))));
    } else next = G.resize(rect, action, G.turn({ x: ['ArrowLeft', 'ArrowRight'].includes(event.key) ? sign * step : 0,
      y: ['ArrowUp', 'ArrowDown'].includes(event.key) ? sign * step : 0 }, rect.angle));
    if (!event.repeat || keyEdit?.id !== id || keyEdit.key !== event.key) {
      endKeyEdit();
      snapEpoch++;
      keyEdit = { id, context, key: event.key, before: snapshot(context), linkedIds:expandPairs(rectangles(context),selection(context)) };
    }
    applyGroup(rectangles(context), snapshot(context), id, next, action); save(context); render();
  });
  function endKeyEdit() {
    if (!keyEdit) return;
    const { context, before } = keyEdit;
    keyEdit = null; recordGroup(context, before); render();
  }
  layer.addEventListener('keyup', event => { if (event.key.startsWith('Arrow')) endKeyEdit(); });
  layer.addEventListener('focusout', endKeyEdit);
  window.addEventListener('blur', endKeyEdit);
  // Synchronous local writes also preserve an in-progress edit when leaving.
  window.addEventListener('pagehide', () => finish());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') finish(); });
  window.addEventListener('storage', event => {
    const entry = window.OM10_DATA.images.find(image => store.keyFor(image.filename) === event.key);
    if (!entry || drag?.context.entry.filename === entry.filename || saveStates.get(entry.filename)?.error) return;
    doses.delete(entry.filename);
    if (getContext().entry.filename === entry.filename) render();
  });
  function select(id, mode = 'keep') {
    finish();
    const context = getContext(), ids = selection(context);
    if (id != null && !rectangles(context).has(id)) return;
    const next = id == null ? [] : mode === 'toggle'
      ? (ids.includes(id) ? ids.filter(other => other !== id) : [...ids, id])
      : (mode === 'keep' && ids.includes(id) ? ids : [id]);
    if (ids.length === next.length && ids.every((value, i) => value === next[i])) return;
    selected.set(key(context), next); save(context);
    render();
  }
  function selectAll() {
    const context = getContext();
    if (!context.ready || context.cleanImage || drag) return;
    finish();
    const ids = [...rectangles(context).keys()];
    selected.set(key(context), ids);
    save(context);
    render();
  }
  function editMeasurement(id, field, value, filename, view) {
    const context = getContext();
    if (!context.ready || key(context) !== filename || context.view !== view) return;
    const items = rectangles(context), rect = items.get(id);
    const next = rect && G.withMeasurement(rect, context.entry, view, field, value);
    if (!next) return;
    const before = snapshot(context);
    if (!before.has(id)) return;
    applyGroup(items, before, id, next);
    save(context);
    recordGroup(context, before);
    render();
  }
  function selectionCommand(command) {
    const context = getContext(), ids = selection(context);
    if (!context.ready || drag || !ids.length) return;
    finish();
    if (command === 'remove') { remove(ids); return; }
    snap(null, command, menu.fraction()).then(message => {
      if (message && getContext().entry === context.entry) feedback.textContent = message;
    }).catch(error => { if (getContext().entry === context.entry) feedback.textContent = 'Could not snap: ' + error.message; });
  }
  function rectanglesForExport(entry, side = window.OM10Session.get('pictureSide', 'top')) {
    // Read other images without populating the live overlay or reconciling comparisons.
    if (side === window.OM10Session.get('pictureSide', 'top') && doses.has(entry.filename)) {
      if (saveStates.get(entry.filename)?.readError) throw new Error(`Could not read saved rectangles for ${entry.filename}.`);
      return doses.get(entry.filename);
    }
    return store.load(entry.filename, side).items;
  }
  async function duplicateFrom(source, resnap, stillCurrent) {
    finish();
    const context = getContext(), filename = key(context);
    const copies = new Map(rectanglesForExport(source));
    if (!copies.size) return source.filename + ' has no rectangles to copy.';
    const original = rectanglesForExport(context.entry), before = new Map(original);
    const fraction = menu.fraction('square');
    const wanted = resnap ? [...copies.values()].filter(rect => rect.snapMode).length : 0;
    let mask, fitted = 0;
    if (wanted && fraction > 0) {
      mask = await context.loadSnapMask();
      if (!stillCurrent()) return '';
      // A pending decode must not overwrite a drag, field edit, undo, or another tab's save.
      if (drag || keyEdit || getFieldEdit() || rectangles(context) !== original ||
          original.size !== before.size || [...before].some(([id, rect]) => original.get(id) !== rect)) {
        return 'Copy cancelled because the destination rectangles changed.';
      }
    }
    // Shift+Space replaces the destination as one atomic, undoable edit.
    const items = resnap ? new Map() : new Map(before), changed = new Set(resnap ? before.keys() : []), handled = new Set();
    for (const [id, rect] of copies) {
      items.set(id,G.copyToDose(rect, source, context.entry)); changed.add(id);
    }
    let conflicts=0;
    const pairs=window.OM10RectangleUnion.innerPairs(window.OM10_MASK,items);
    if (mask) for (const [id, original] of copies) {
      if (!original.snapMode || handled.has(id)) continue;
      const pair=pairs.get(id);
      if (pair) {
        const modes=new Set(pair.ids.map(member=>copies.get(member)?.snapMode).filter(Boolean));
        pair.ids.forEach(member=>handled.add(member));
        if (modes.size>1) { conflicts++; continue; }
        const mode=[...modes][0], fit=fitPairOnImage(pair,mode,fraction,mask);
        if (fit) pair.ids.forEach((member,i)=>{
          items.set(member,{...fit.rects[i],snapMode:mode}); changed.add(member);
          if (copies.get(member)?.snapMode) fitted++;
        });
      } else {
        handled.add(id);
        const fit=fitOnImage(items.get(id),original.snapMode,fraction,mask);
        if (fit) { items.set(id,fit); fitted++; }
      }
    }
    const edits=[...changed].map(id=>({filename,id,before:before.get(id),after:items.get(id)}));
    const ids = selection(context);
    writeDoses([{ filename, items, selected: ids.length ? ids : selection({entry:source}) }]);
    history.record(edits);
    render();
    const copied = 'Copied ' + copies.size + (copies.size === 1 ? ' rectangle' : ' rectangles') + ' from ' + source.filename + '.';
    if (!resnap) return copied;
    if (!wanted) return copied + ' No recorded snaps.';
    if (!fraction) return copied + ' Snap range is 0%.';
    if (!mask) return copied + ' Canny image unavailable; kept copied positions.';
    return copied + ' Reapplied ' + fitted + '/' + wanted + ' snaps.' +
      (conflicts ? ` ${conflicts} overlapping pair${conflicts===1?' has':'s have'} conflicting saved snap modes.` : '') +
      (fitted < wanted ? ' Unmatched rectangles kept their copied positions.' : '');
  }
  function importRectangles(groups) {
    finish();
    const changes = [], edits = [];
    for (const [filename, incoming] of groups) {
      const existing = store.load(filename);
      const items = window.OM10SpotColors.apply(new Map([...existing.items, ...incoming]));
      const prior = window.OM10SpotColors.apply(existing.items);
      for (const id of incoming.keys()) edits.push({ filename, id, before: prior.get(id), after: items.get(id) });
      changes.push({ filename, items, selected: existing.selected.length ? existing.selected : [incoming.keys().next().value] });
    }
    writeDoses(changes);
    history.record(edits);
    render();
  }
  function writeDoses(changes) {
    store.saveBatch(changes);
    for (const change of changes) {
      doses.set(change.filename, change.items);
      onSavedRectangles(change.filename, change.items);
      selected.set(change.filename, change.selected);
      saveStates.set(change.filename, { text: 'Saved locally' });
    }
  }
  function replayEdit(forward) {
    finish();
    try {
      const filenames = history.replay(forward, filename => {
        const dose = store.load(filename);
        return { items: window.OM10SpotColors.apply(dose.items), selected: dose.selected };
      }, writeDoses);
      render();
      return filenames;
    } catch (error) {
      saveStatus.textContent = (forward ? 'Redo' : 'Undo') + ' failed: ' + error.message;
      saveStatus.hidden = false; saveStatus.classList.add('save-error');
      return [];
    }
  }
  function clearPictureSide() { snapEpoch++; menu.close(); doses.clear(); selected.clear(); saveStates.clear(); }
  return { clearPictureSide, render, finish, toggleSpot, duplicateSpot, select, selectAll, selectionCommand, editMeasurement, rectanglesForExport, importRectangles, replayEdit, duplicateFrom,
    isDragging: () => Boolean(drag) };
};

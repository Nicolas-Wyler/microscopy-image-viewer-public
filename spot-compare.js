'use strict';

// Eliminate the common gap from r²(P² − λ²) = g²λ², where P is the Ru mask period.
function comparisonWavelength(a, b) {
  const [small, large] = a.maskPitchNm < b.maskPitchNm ? [a, b] : [b, a];
  const p = small.maskPitchNm, q = large.maskPitchNm;
  if (![p,q,small.distanceUm,large.distanceUm].every(Number.isFinite)
      || !(0 < p && p < q && small.distanceUm > large.distanceUm && large.distanceUm > 0)) return null;
  const ratio = large.distanceUm / small.distanceUm;
  const wavelength = Math.sqrt((p - ratio * q) * (p + ratio * q)
    / ((1 - ratio) * (1 + ratio)));
  return wavelength > 0 && wavelength < p ? wavelength : null;
}

// g = r_i r_j sqrt((P_i²-P_j²)/(r_j²P_j²-r_i²P_i²)).
function comparisonGapFromPairs(a, b) {
  const [wide, narrow]=a.maskPitchNm>b.maskPitchNm ? [a,b] : [b,a];
  const p=narrow.maskPitchNm, q=wide.maskPitchNm;
  if (![p,q,narrow.distanceUm,wide.distanceUm].every(Number.isFinite)
      || !(0<p && p<q && narrow.distanceUm>wide.distanceUm && wide.distanceUm>0)) return null;
  const ratio=wide.distanceUm/narrow.distanceUm;
  // Factoring the differences of squares improves numerical stability.
  const denominator=(p-ratio*q)*(p+ratio*q);
  if (!(denominator>0)) return null;
  const gap=wide.distanceUm*Math.sqrt((q-p)*(q+p)/denominator);
  return Number.isFinite(gap) && gap>0 ? gap : null;
}

window.createSpotCompare = function (doseFormat, openImage, isCleanImage, store, resolveBatchPairs) {
  const history = document.getElementById('compare-history');
  const histograms = window.createCompareHistograms();
  const measure = window.createDistanceMeasurements(window.OM10_MASK);
  const describe = p => p.pitch+' nm · '+p.name+' (r = '+p.distanceUm.toFixed(2)+' µm)';
  const storageKey = name => 'comparisons:'+name;
  const pairKey = (a, b) => [a.firstId, b.firstId].sort().join('|');
  const recordIdentity = entry => entry.key+'|'+(entry.processingSignature || 'square')+'|'+JSON.stringify(entry.integralInputs || {})+'|'+JSON.stringify(entry.geometry || {});
  const model = 'ru-mask-pitch-v1';
  const entryView = entry => entry.view || (entry.details?.[2] === 'Cropped view' ? 'cropped' : 'original');
  const resultLabel = wavelength => wavelength === null ? 'No physical wavelength for this pair.' : 'λ = '+wavelength.toFixed(2)+' nm';
  // The original OM11 viewer used wafer fringe pitches in its wavelength calculation.
  // Reproduce that result only to verify an old file before recalculating from its rectangles.
  function legacyWavelength(a, b) {
    return comparisonWavelength({...a, maskPitchNm:a.pitch}, {...b, maskPitchNm:b.pitch});
  }
  const signature = r => r && [r.cx, r.cy, r.width, r.height, r.angle].join(',');
  function processingSignature(name=filename) {
    const image=window.OM10_DATA.images.find(item=>item.filename===name),mode=window.OM10Session.get('backgroundMode','original');
    if(mode!=='normalized'||!image?.backgroundFile||image.backgroundError)return 'original-tiff';
    return JSON.stringify(['normalized',image.backgroundId,window.OM10Session.get('backgroundSigma',3),window.OM10Session.get('zeroOffset',0)]);
  }
  const integralSignature = rect => JSON.stringify([rect.shapeMode, rect.positionMethod || 'maximum',
    rect.signalRange ?? window.OM10Session.get('integralDummyPercent',75), rect.smoothingSigma ?? 0]);
  function snapshotCurrent(entry,items,side=window.OM10Session.get('pictureSide','top'),name=filename) {
    if (entry.pictureSide && entry.pictureSide !== side) return false;
    if (entry.geometry && Object.entries(entry.geometry).some(([id,sig]) => !sameGeometry(items.get(id),sig))) return false;
    if (!entry.integralInputs) return !Object.keys(entry.geometry || {}).some(id => items.get(id)?.shapeMode === 'integral');
    if (entry.processingSignature !== processingSignature(name)) return false;
    return Object.entries(entry.integralInputs).every(([id,sig]) => items.has(id) && integralSignature(items.get(id)) === sig)
      && Object.keys(entry.geometry || {}).every(id => (items.get(id)?.shapeMode === 'integral') === (id in entry.integralInputs));
  }
  // Converting pixels to µm and back through CSV can change the last float bits.
  function sameGeometry(rect, saved) {
    if (!rect || typeof saved !== 'string') return false;
    if (signature(rect) === saved) return true;
    const old = saved.split(',').map(Number), current = [rect.cx,rect.cy,rect.width,rect.height,rect.angle];
    return old.length === 5 && current.every((v,i) => Math.abs(i===4 ? window.GratingGeometry.normalize(v-old[i]) : v-old[i])
      <= 32*Number.EPSILON*Math.max(1,Math.abs(v),Math.abs(old[i])));
  }
  const images = window.OM10_DATA.images;
  const removeAll = document.getElementById('remove-all-comparisons');
  let filename, choices = [], initialized = false;
  const layer = document.getElementById('compare-layer');
  const output = document.getElementById('compare-result');
  let active = false, firstId = null, pairs = [], frameKey;
  const resolvedFrames = new Map();
  let historyRefreshPending = false;
  function scheduleHistoryRefresh() {
    if (historyRefreshPending) return;
    historyRefreshPending=true;
    requestAnimationFrame(() => { historyRefreshPending=false; if(initialized) refreshHistory(); });
  }
  function svg(tag, attrs, parent) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    parent.append(node);
    return node;
  }
  function setActive(enabled) {
    resetConfirmation();
    active = enabled;
    firstId = null;
    layer.toggleAttribute('hidden', !active);
    if (active) draw();
    else layer.replaceChildren();
  }
  const groupOpen = window.OM10Session.get('comparisonGroups', {});
  function showGroup(image, entries) {
    const card = document.createElement('details');
    card.className = 'position-pitch comparison-group';
    card.open = groupOpen[image.filename] !== false;
    const summary = document.createElement('summary');
    summary.textContent = image.filename.replace(/\.tif$/i, '')+' · '+doseFormat.format(image.dose)+' mJ/cm²';
    summary.title = 'EUV dose · '+entries.length+' comparison(s)';
    const list = document.createElement('ul');
    for (const entry of entries.slice().reverse()) list.append(comparisonRow(entry, image));
    card.append(summary, list);
    card.addEventListener('toggle', () => {
      if (card.isConnected && groupOpen[image.filename] !== card.open) {
        groupOpen[image.filename] = card.open;
        window.OM10Session.set('comparisonGroups', groupOpen);
      }
    });
    history.append(card);
  }
  function comparisonRow(entry, image) {
    const item = document.createElement('li');
    const result = document.createElement('strong');
    result.textContent = entry.result;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'comparison-remove';
    remove.textContent = '×';
    remove.title = 'Remove comparison';
    remove.setAttribute('aria-label', 'Remove comparison: ' + entry.details.slice(0, 2).join(' and '));
    remove.addEventListener('click', () => {
      const key = storageKey(image.filename);
      const remaining = window.OM10Session.get(key, []).filter(saved => entry.key ? recordIdentity(saved) !== recordIdentity(entry) : saved !== entry);
      window.OM10Session.set(key, remaining);
      refreshHistory();
      if (active) draw();
    });
    const jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'comparison-jump';
    jump.title = 'Go to '+image.filename;
    jump.setAttribute('aria-label', jump.title+' · '+entry.result);
    jump.addEventListener('click', () => openImage(image));
    jump.append(result);
    item.append(remove, jump);
    for (const line of entry.details.slice(0,2)) {
      const detail = document.createElement('span');
      detail.textContent = line;
      const match = /^(\d+) nm · (left|right) · (e\d+) · ([−+]1) \(r = ([\d.]+) µm\)$/.exec(line);
      if (match) {
        const [,pitch,side,variant,order,r] = match;
        const id = 'spot-p'+pitch+'-'+variant+'-'+side+'-'+(order==='+1'?'p1':'m1');
        detail.className = 'comparison-spot';
        detail.style.setProperty('--spot-color',window.OM10SpotColors.forSpot(id));
        detail.textContent = [side==='left'?'L':'R',variant,pitch+' nm',order].join('·')+'  '+r+' µm';
        detail.title = line;
      }
      jump.append(detail);
    }
    return item;
  }
  function makeEntry(first, second, view, side=window.OM10Session.get('pictureSide','top'),name=filename) {
    const wavelength = comparisonWavelength(first, second);
    const geometry = {}, measurementPoints = {}, integralInputs = {};
    for (const p of [first, second]) {
      geometry[p.firstId] = signature(p.first.raw); geometry[p.zeroId] = signature(p.zero.raw);
      for (const [id, centre] of [[p.firstId,p.first],[p.zeroId,p.zero]]) if (centre.usesMaximum && centre.measurementRaw) {
        measurementPoints[id] = centre.measurementRaw; integralInputs[id] = integralSignature(centre.raw);
      }
    }
    return {
      key: pairKey(first, second), geometry, wavelength, model, view, pictureSide:side,
      ...(Object.keys(integralInputs).length ? {measurementPoints, integralInputs, processingSignature:processingSignature(name),
        savedRadii:[first,second].map(p => ({firstId:p.firstId, zeroId:p.zeroId, pitch:p.pitch, maskPitchNm:p.maskPitchNm, distanceUm:p.distanceUm}))} : {}),
      spotIds:[first.firstId, second.firstId], result: resultLabel(wavelength),
      details:[describe(first), describe(second), view === 'cropped' ? 'Cropped view' : 'Original view']
    };
  }
  // Older entries stored only the displayed measurements. Match them in their recorded frame.
  function measuredPairs(name, items, view, side = window.OM10Session.get('pictureSide', 'top')) {
    const base = window.OM10_DATA.images.find(image => image.filename === name);
    const entry = base?.[side] ? { ...base, ...base[side] } : base;
    const cached = resolvedFrames.get(side+'|'+name+'|'+view);
    if (cached && cached.inputs.length === items.size && cached.inputs.every(({id,geometry,integral}) => {
      const rect=items.get(id); return rect && sameGeometry(rect,geometry)
        && (integral === null ? rect.shapeMode !== 'integral' : integralSignature(rect) === integral);
    })) return cached.pairs;
    const matrix = window.GratingGeometry.viewMatrix(entry, view);
    const centres = new Map();
    for (const [id, raw] of items) {
      // A profile-derived center cannot be replaced by a rectangle center.
      if (raw.shapeMode === 'integral') continue;
      const centre = window.GratingGeometry.transform({x:raw.cx,y:raw.cy}, matrix);
      centres.set(id, {raw, xUm:centre.x * entry.pixelSizeUm});
    }
    return measure(centres);
  }
  function comparisonGap(image, entry) {
    const wavelength=entry.wavelength;
    if (!Number.isFinite(wavelength) || wavelength <= 0) return null;
    if (entry.savedRadii) return comparisonGapFromPairs(entry.savedRadii[0],entry.savedRadii[1]);
    const view=entryView(entry);
    let items;
    if (entry.geometry) {
      // Use the saved full-precision centres rather than the rounded card labels.
      items=new Map();
      for (const [id, value] of Object.entries(entry.geometry)) {
        if (typeof value !== 'string') return null;
        const parts=value.split(',');
        if (parts.length !== 5 || parts.some(part=>!part.trim())) return null;
        const numbers=parts.map(Number);
        if (!numbers.every(Number.isFinite)) return null;
        let [cx,cy,width,height,angle]=numbers;
        if (entry.measurementPoints?.[id]) ({x:cx,y:cy}=entry.measurementPoints[id]);
        items.set(id,{cx,cy,width,height,angle});
      }
    } else {
      // Older, text-only entries may still be recoverable from their saved rectangles.
      items=store.load(image.filename).items;
    }
    const [a,b] = savedPairs(entry, pairLookup(image.filename,items)(view));
    return a && b ? comparisonGapFromPairs(a,b) : null;
  }
  function pairLookup(name, items, side) {
    const frames = new Map();
    return view => {
      if (!frames.has(view)) frames.set(view, new Map(measuredPairs(name, items, view, side).map(p => [p.firstId, p])));
      return frames.get(view);
    };
  }
  function savedPairs(entry, pairs) {
    // Before spotIds were saved, geometry keys were inserted in the order the user picked the spots.
    const ids = entry.spotIds || Object.keys(entry.geometry || {}).filter(id => !id.endsWith('-zero'));
    if (ids.length) return ids.length === 2 ? ids.map(id => pairs.get(id)) : [];
    return (entry.details || []).slice(0,2).map(label => [...pairs.values()].find(pair => describe(pair) === label));
  }
  function pairsFromSnapshot(name, entry, side) {
    const base=images.find(image=>image.filename===name), actual=base?.[side] ? {...base,...base[side]} : base;
    if (!actual || !entry.geometry) return [];
    const matrix=window.GratingGeometry.viewMatrix(actual,entryView(entry)), centres=new Map();
    for (const [id,value] of Object.entries(entry.geometry)) {
      if(typeof value !== 'string') return [];
      const n=value.split(',').map(Number); if(n.length!==5 || !n.every(Number.isFinite)) return [];
      const [cx,cy,width,height,angle]=n, raw={cx,cy,width,height,angle};
      const point=entry.integralInputs && id in entry.integralInputs ? entry.measurementPoints?.[id] : {x:cx,y:cy};
      if(!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return [];
      const transformed=window.GratingGeometry.transform(point,matrix);
      centres.set(id,{raw,xUm:transformed.x*actual.pixelSizeUm});
    }
    return measure(centres);
  }
  function exportRows(name, items, side = window.OM10Session.get('pictureSide', 'top')) {
    const lookup = pairLookup(name, items, side);
    return window.OM10Session.getForSide(storageKey(name), side, []).map(entry => {
      const view = entryView(entry);
      if (entry.integralInputs && entry.savedRadii) {
        const [a,b]=entry.savedRadii, current=snapshotCurrent(entry,items,side,name);
        return {comparison_view:view,a_spot_id:a.firstId,a_zero_spot_id:a.zeroId,a_pitch_nm:a.pitch,a_mask_pitch_nm:a.maskPitchNm,a_r_um:a.distanceUm,
          b_spot_id:b.firstId,b_zero_spot_id:b.zeroId,b_pitch_nm:b.pitch,b_mask_pitch_nm:b.maskPitchNm,b_r_um:b.distanceUm,
          comparison_status:current ? (entry.wavelength === null ? 'no_physical_solution' : 'ok') : 'stale', wavelength_nm:entry.wavelength,
          comparison_snapshot_json:JSON.stringify(entry),created_at:entry.createdAt == null ? '' : new Date(entry.createdAt).toISOString()};
      }
      const historical=entry.geometry ? new Map(pairsFromSnapshot(name,entry,side).map(p=>[p.firstId,p])) : lookup(view);
      const [a,b] = savedPairs(entry,historical);
      if (!a || !b) throw new Error('Cannot match a saved comparison to its saved rectangle geometry in '+name+'.');
      const wavelength = comparisonWavelength(a,b), current=snapshotCurrent(entry,items,side,name);
      return {comparison_view:view, a_spot_id:a.firstId, a_zero_spot_id:a.zeroId, a_pitch_nm:a.pitch, a_mask_pitch_nm:a.maskPitchNm, a_r_um:a.distanceUm,
        b_spot_id:b.firstId, b_zero_spot_id:b.zeroId, b_pitch_nm:b.pitch, b_mask_pitch_nm:b.maskPitchNm, b_r_um:b.distanceUm,
        comparison_status: current ? (wavelength === null ? 'no_physical_solution' : 'ok') : 'stale', wavelength_nm:wavelength,
        comparison_snapshot_json:JSON.stringify(entry), created_at:entry.createdAt == null ? '' : new Date(entry.createdAt).toISOString()};
    });
  }
  // Validate every comparison against the geometry in this file before writing any dose.
  function prepareImport(groups, rows, side) {
    const pending = new Map(), lookups = new Map();
    for (const {row, line} of rows) {
      const fail = message => { throw new Error('Row '+line+': '+message); };
      const name = row.image, view = row.comparison_view;
      if (!groups.has(name) || !['original','cropped'].includes(view)) fail('Missing rectangles or unknown measurement view.');
      if (row.comparison_snapshot_json) {
        let snapshot;
        try { snapshot=JSON.parse(row.comparison_snapshot_json); } catch (_) { fail('Invalid comparison snapshot.'); }
        if (snapshot?.geometry) {
          if (snapshot.model !== model || snapshot.view !== view || (snapshot.pictureSide && snapshot.pictureSide !== side) ||
              (snapshot.integralInputs && (!Array.isArray(snapshot.savedRadii) || snapshot.savedRadii.length !== 2 ||
               !snapshot.measurementPoints || snapshot.processingSignature !== processingSignature(name)))) fail('Invalid comparison snapshot.');
          const base=images.find(entry=>entry.filename===name), actual=base?.[side] ? {...base,...base[side]} : base;
          const matrix=window.GratingGeometry.viewMatrix(actual,view), centres=new Map();
          for (const [id,signatureText] of Object.entries(snapshot.geometry)) {
            if (typeof signatureText !== 'string') fail('Invalid saved rectangle geometry.');
            const numbers=signatureText.split(',').map(Number);
            if (numbers.length!==5 || !numbers.every(Number.isFinite)) fail('Invalid saved rectangle geometry.');
            const [cx,cy,width,height,angle]=numbers, rect={cx,cy,width,height,angle};
            const point=snapshot.integralInputs && id in snapshot.integralInputs ? snapshot.measurementPoints[id] : {x:cx,y:cy};
            if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) fail('Missing integral measurement point.');
            const transformed=window.GratingGeometry.transform(point,matrix);
            centres.set(id,{raw:rect,xUm:transformed.x*actual.pixelSizeUm});
          }
          const byId=new Map(measure(centres).map(pair=>[pair.firstId,pair]));
          const savedRadii=snapshot.savedRadii || ['a','b'].map(prefix => ({firstId:row[prefix+'_spot_id'],zeroId:row[prefix+'_zero_spot_id'],pitch:Number(row[prefix+'_pitch_nm']),maskPitchNm:Number(row[prefix+'_mask_pitch_nm']),distanceUm:Number(row[prefix+'_r_um'])}));
          const computed=savedRadii.map(saved=>byId.get(saved.firstId));
          const near=(a,b)=>Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Math.abs(Number(a)-Number(b))<=1e-8*Math.max(1,Math.abs(Number(a)),Math.abs(Number(b)));
          for(let i=0;i<2;i++) {
            const saved=savedRadii[i], pair=computed[i], prefix=i?'b':'a';
            if (!pair || saved.zeroId!==pair.zeroId || saved.pitch!==pair.pitch || saved.maskPitchNm!==pair.maskPitchNm || !near(saved.distanceUm,pair.distanceUm) ||
                row[prefix+'_spot_id']!==pair.firstId || row[prefix+'_zero_spot_id']!==pair.zeroId || !near(row[prefix+'_r_um'],pair.distanceUm) ||
                Number(row[prefix+'_pitch_nm'])!==pair.pitch || Number(row[prefix+'_mask_pitch_nm'])!==pair.maskPitchNm) fail('Integral snapshot does not match its measurement.');
          }
          const [a,b]=computed, wavelength=comparisonWavelength(a,b), current=snapshotCurrent(snapshot,groups.get(name),side,name);
          if(a.side!==b.side || a.pitch===b.pitch || snapshot.key!==pairKey(a,b) ||
             (wavelength===null ? snapshot.wavelength!==null || row.wavelength_nm!=='' : !near(snapshot.wavelength,wavelength) || !near(row.wavelength_nm,wavelength)) ||
             row.comparison_status!==(current ? (wavelength===null?'no_physical_solution':'ok') : 'stale')) fail('Integral comparison result does not match its snapshot.');
          if(row.created_at) {snapshot.createdAt=Date.parse(row.created_at);if(!Number.isFinite(snapshot.createdAt))fail('Invalid comparison timestamp.');}
          if(!pending.has(name))pending.set(name,new Map());
          const identity=recordIdentity(snapshot);
          if(pending.get(name).has(identity))fail('Duplicate comparison.');
          pending.get(name).set(identity,snapshot); continue;
        }
      }
      if (!lookups.has(name)) lookups.set(name, pairLookup(name,groups.get(name),side));
      const pairs = lookups.get(name)(view);
      const near = (text,value) => typeof text === 'string' && text !== '' && Number.isFinite(Number(text))
        && Math.abs(Number(text)-value) <= 1e-8*Math.max(1,Math.abs(value));
      const read = prefix => {
        const p = pairs.get(row[prefix+'_spot_id']);
        if (!p || p.zeroId !== row[prefix+'_zero_spot_id'] || p.pitch !== Number(row[prefix+'_pitch_nm'])
          || !near(row[prefix+'_r_um'], p.distanceUm)) fail('Comparison spot, pitch or distance does not match its rectangles.');
        if (row.csv_version === '3' && p.maskPitchNm !== Number(row[prefix+'_mask_pitch_nm'])) fail('Mask pitch does not match this grating.');
        return p;
      };
      const a = read('a'), b = read('b');
      if (a.side !== b.side || a.pitch === b.pitch) fail('Expected two different pitches on the same side.');
      const entry = makeEntry(a,b,view,side,name);
      const expected = row.csv_version === '2' ? legacyWavelength(a,b) : entry.wavelength;
      if (expected === null ? row.comparison_status !== 'no_physical_solution' || row.wavelength_nm !== ''
          : row.comparison_status !== 'ok' || !near(row.wavelength_nm,expected)) fail('Wavelength does not match this pair.');
      if (row.created_at) {
        entry.createdAt = Date.parse(row.created_at);
        if (!Number.isFinite(entry.createdAt)) fail('Invalid comparison timestamp.');
      }
      if (!pending.has(name)) pending.set(name,new Map());
      const identity=recordIdentity(entry);
      if (pending.get(name).has(identity)) fail('Duplicate comparison.');
      pending.get(name).set(identity,entry);
    }
    return pending;
  }
  function importEntries(pending, side = window.OM10Session.get('pictureSide', 'top')) {
    for (const [name, entries] of pending) {
      const merged = new Map(window.OM10Session.getForSide(storageKey(name), side, []).map(e => [recordIdentity(e),e]));
      for (const [key, entry] of entries) merged.set(key,entry);
      window.OM10Session.setForSide(storageKey(name), side, [...merged.values()]);
    }
    if (side === window.OM10Session.get('pictureSide', 'top')) { refreshHistory(); if (active) draw(); }
  }
  function reconcile(name, items) {
    const stored = window.OM10Session.get(storageKey(name), []);
    if (!stored.length) return;
    const seen = new Set(), lookup = pairLookup(name,items), kept = [];
    let migrated = false;
    for (let entry of stored) {
      if (!entry.integralInputs && entry.geometry && Object.entries(entry.geometry).some(([id, value]) => !sameGeometry(items.get(id), value))) continue;
      if (entry.model !== model || !entry.geometry) {
        const view = entryView(entry);
        const [a,b] = savedPairs(entry,lookup(view));
        if (!a || !b || a.side !== b.side || a.pitch === b.pitch) continue;
        if (!entry.geometry && entry.result !== resultLabel(legacyWavelength(a,b))) continue;
        entry = {...entry, ...makeEntry(a,b,view,undefined,name)};
        migrated = true;
      }
      const identity=recordIdentity(entry);
      if (seen.has(identity)) continue;
      seen.add(identity);
      kept.push(entry);
    }
    if (!migrated && kept.length === stored.length) return;
    window.OM10Session.set(storageKey(name), kept);
    if (initialized) refreshHistory();
  }
  function resetConfirmation() {
    removeAll.classList.remove('confirming');
    removeAll.textContent = 'Remove all';
  }
  function refreshHistory() {
    const all = [], results = [];
    history.replaceChildren();
    for (const image of images) {
      const stored = window.OM10Session.get(storageKey(image.filename), []);
      let items; try { items=store.load(image.filename).items; } catch (_) { items=new Map(); }
      const entries = stored.filter(entry => entry.model === model && snapshotCurrent(entry,items,undefined,image.filename));
      // A failed storage read leaves the original record intact. Do not present its old wavelength.
      if (entries.length < stored.length) {
        const note = document.createElement('p');
        note.textContent = image.filename+' · '+(stored.length-entries.length)+' saved comparison(s) awaiting recalculation.';
        history.append(note);
      }
      if (entries.length) showGroup(image, entries);
      all.push(...stored);
      for (const entry of entries) {
        let gap=null;
        if (Number.isFinite(entry.wavelength)) {
          try { const value=comparisonGap(image,entry); if (Number.isFinite(value)) gap=value; } catch (_) { /* Unavailable gap. */ }
        }
        // Keep both estimates attached to their own comparison, even if one is unavailable.
        results.push({wavelength:entry.wavelength,gap});
      }
    }
    histograms.render(results);
    removeAll.disabled = !all.length;
    resetConfirmation();
  }
  removeAll.addEventListener('blur', resetConfirmation);
  removeAll.addEventListener('click', () => {
    if (!removeAll.classList.contains('confirming')) {
      removeAll.classList.add('confirming');
      removeAll.textContent = 'sure?';
      return;
    }
    for (const image of images) {
      const key = storageKey(image.filename);
      if (window.OM10Session.get(key, []).length) window.OM10Session.set(key, []);
    }
    firstId = null;
    refreshHistory();
    if (active) draw();
  });
  const batchButton=document.getElementById('compare-extremes');
  batchButton.addEventListener('click', async () => {
    if (batchButton.disabled) return;
    batchButton.disabled=true;
    const status=document.getElementById('compare-extremes-status');
    const view=frameKey?.endsWith('|original')?'original':'cropped';
    let added=0,existing=0,incomplete=0,unresolved=0,processed=0; const failed=[];
    try {
      for (const image of images) for (const side of ['top','bottom']) {
        processed++; status.textContent=`Checking ${processed}/${images.length*2} picture sides · ${added} added…`;
        await new Promise(resolve=>setTimeout(resolve,0));
        try {
          const items=store.load(image.filename,side).items;
          const hasIntegral=[...items.values()].some(rect=>rect.shapeMode==='integral');
          let computed;
          if (hasIntegral) {
            if (typeof resolveBatchPairs !== 'function') throw new Error('Integral positions unavailable');
            computed=await resolveBatchPairs(image,side,items,view);
          } else computed={pairs:measuredPairs(image.filename,items,view,side),unresolved:0};
          unresolved+=computed.unresolved || 0;
          const inputs=[...items].map(([id,rect])=>({id,geometry:signature(rect),integral:rect.shapeMode==='integral'?integralSignature(rect):null}));
          resolvedFrames.set(side+'|'+image.filename+'|'+view,{inputs,pairs:computed.pairs});
          const groups=window.selectExtremeComparisonPairs(computed.pairs);
          const key=storageKey(image.filename), saved=window.OM10Session.getForSide(key,side,[]), next=saved.slice();
          const known=new Set(saved.filter(entry=>snapshotCurrent(entry,items,side,image.filename)).map(entry=>entry.key));
          for (const [small,large] of groups) {
            const result=makeEntry(small,large,view,side,image.filename);
            if(known.has(result.key)){existing++;continue;}
            next.push({...result,createdAt:Date.now()});known.add(result.key);added++;
          }
          if(next.length!==saved.length) window.OM10Session.setForSide(key,side,next);
          if(!groups.length) incomplete++;
        } catch(error) { failed.push(image.filename+' '+side); console.warn('Could not compare '+image.filename+' '+side,error); }
      }
      status.textContent=`Added ${added}; ${existing} already present; ${incomplete} picture sides without a complete group; ${unresolved} Integral positions unavailable.`+(failed.length?` Failed: ${failed.join(', ')}.`:'');
    } catch(error) { status.textContent=`Stopped after ${processed} picture sides; ${added} comparisons saved. ${error.message}`; }
    finally { batchButton.disabled=false; refreshHistory(); if(active){firstId=null;draw();} }
  });
  function draw() {
    layer.replaceChildren();
    if (!filename || !frameKey) { choices=[]; output.textContent='Loading spots for this picture side.'; return; }
    if (isCleanImage()) {
      choices = [];
      output.textContent = 'Turn off Clean image to pick comparison spots.';
      return;
    }
    const currentItems=filename ? store.load(filename).items : new Map();
    const used = new Set(window.OM10Session.get(storageKey(filename), []).filter(entry=>snapshotCurrent(entry,currentItems)).map(entry => entry.key));
    const available = (a,b) => a.side === b.side && a.pitch !== b.pitch && !used.has(pairKey(a,b));
    const starters = pairs.filter(a => pairs.some(b => available(a,b)));
    const first = starters.find(pair => pair.firstId === firstId);
    if (!first) firstId = null;
    choices = first ? pairs.filter(b => available(first,b)) : starters;
    output.textContent = first ? 'Step 2 of 2 · Click a different pitch on the ' + first.side + ' side.'
      : 'Step 1 of 2 · Click a colored −1 or +1 spot to start a new comparison.';
    if (!choices.length) output.textContent = used.size ? 'All available pairs have been compared.'
      : 'Place spots at two different pitches on the same side, each with its matching zero order.';
    const mask = svg('mask', {id:'compare-holes',maskUnits:'userSpaceOnUse',x:0,y:0,width:'100%',height:'100%'}, layer);
    svg('rect',{width:'100%',height:'100%',fill:'white'},mask);
    svg('rect',{width:'100%',height:'100%',fill:'black',opacity:0.40,mask:'url(#compare-holes)'},layer);
    for (const pair of choices) {
      const {width,height,angle,color} = pair.first;
      const x=pair.first.boxX ?? pair.first.x, y=pair.first.boxY ?? pair.first.y;
      const box = {x:-width/2,y:-height/2,width,height,transform:'translate('+x+' '+y+') rotate('+angle+')'};
      svg('rect',{...box,fill:'black'},mask);
      svg('rect',{...box,fill:color,'fill-opacity':0.28,stroke:'none','data-spot':pair.firstId,'aria-label':pair.pitch+' nm · '+pair.name},layer);
    }
  }
  layer.addEventListener('contextmenu', event => { event.preventDefault(); event.stopPropagation(); });
  function pick(spotId) {
    if (!active) return;
    const picked = choices.find(pair => pair.firstId === spotId);
    if (!picked) return;
    const first = pairs.find(pair => pair.firstId === firstId);
    if (!first) { firstId = picked.firstId; draw(); return; }
    const entry = makeEntry(first, picked, frameKey.endsWith('|cropped') ? 'cropped' : 'original');
    const saved = window.OM10Session.get(storageKey(filename), []);
    if (!saved.some(previous => previous.key === entry.key && snapshotCurrent(previous,store.load(filename).items))) {
      const next = [...saved, {...entry, createdAt: Date.now()}];
      window.OM10Session.set(storageKey(filename), next);
    }
    refreshHistory();
    firstId = null;
    draw();
  }
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.target.closest?.('#sidecar-dialog, #compare-histogram-settings')) return;
    if (active && event.key === 'Escape') { resetConfirmation(); firstId = null; draw(); }
  });
  return { invalidate(name) { const prefix=window.OM10Session.get('pictureSide','top')+'|'+name+'|'; for (const key of resolvedFrames.keys()) if (key.startsWith(prefix)) resolvedFrames.delete(key); scheduleHistoryRefresh(); }, refreshSide() { firstId = null; pairs = []; frameKey = null; refreshHistory(); if (active) draw(); }, setActive, reconcile, pick, exportRows, prepareImport, importEntries, update(nextPairs, context) {
    if (!initialized) {
      // Refresh all legacy results before the first history display, including unopened images.
      const legacyImages = images.filter(image => window.OM10Session.get(storageKey(image.filename), []).some(e => !e.geometry || e.model !== model));
      if (legacyImages.length) {
        for (const image of legacyImages) {
          try { reconcile(image.filename, store.load(image.filename).items); }
          catch (error) { console.warn('Could not verify comparisons for '+image.filename, error); }
        }
      }
      initialized = true;
      refreshHistory();
    }
    filename = context.entry.filename;
    const key = filename+'|'+context.view;
    if (key !== frameKey) { firstId = null; frameKey = key; }
    pairs = nextPairs;
    const side=window.OM10Session.get('pictureSide','top');
    try {
      const items=store.load(filename,side).items;
      const inputs=[...items].map(([id,rect])=>({id,geometry:signature(rect),integral:rect.shapeMode==='integral'?integralSignature(rect):null}));
      resolvedFrames.set(side+'|'+filename+'|'+context.view,{inputs,pairs:nextPairs});
    } catch (_) { /* Live profile stays visible; avoid caching unreadable saves. */ }
    if (firstId && !pairs.some(pair => pair.firstId === firstId)) firstId = null;
    if (active) draw();
  }};
};

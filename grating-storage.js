/* Small, versioned local saves: one record per dataset and original TIFF. */
'use strict';
(() => {
  function createGratingStore({ data, mask, scope = '', startingRectangles = new Map(), startingRecords = {}, getStorage = () => window.OM13Storage }) {
    const designScope=data.importedProject ? `:design:${encodeURIComponent(data.maskDesign?.id||'none')}` : '';
    const prefix = scope + `om10-viewer:rectangles:v1:${data.exposure}:${data.mask}${designScope}:`;
    const filenames = new Set(data.images.map(image => image.filename));
    const spotIds = new Set(mask.rows.flatMap(row => ['left', 'right'].flatMap(side =>
      ['m1', 'zero', 'p1'].map(order => `spot-${row.id}-${side}-${order}`))));
    for (const row of mask.rows) spotIds.add(`spot-${row.id}-both-inner_pair`);
    if(data.importedProject)for(const spot of window.ViewerSpotPlacement.definitions(data))spotIds.add(spot.id);
    const blocked = new Set();
    const currentSide = () => window.OM10Session?.get('pictureSide', 'top') === 'bottom' ? 'bottom' : 'top';
    const keyFor = (filename, side = currentSide()) => prefix + (side === 'bottom' ? 'picture-bottom:' : '') + filename;
    const validSelection = (ids, items) => [...new Set(Array.isArray(ids) ? ids : [ids])].filter(id => items.has(id));
    function validate(record, filename) {
      if (!filenames.has(filename) || record?.version !== 1 || record.filename !== filename ||
          record.exposure !== data.exposure || record.mask !== data.mask ||
          record.coordinates !== 'raw-tiff-pixels' || !Array.isArray(record.rectangles)) {
        throw new Error('Unrecognized rectangle save. The existing record has been preserved.');
      }
      const items = new Map();
      for (const item of record.rectangles) {
        if (!Array.isArray(item) || item.length !== 2) throw new Error('Invalid rectangle entry.');
        const [id, rect] = item;
        if (!(spotIds.has(id) || (data.importedProject && /^vspot-[A-Za-z0-9_-]{1,800}$/.test(id))) || items.has(id) || !rect ||
            !['cx', 'cy', 'width', 'height', 'angle'].every(name => Number.isFinite(rect[name])) ||
            rect.width < 1 || rect.height < 1 ||
            typeof rect.color !== 'string' || rect.color.length > 100 ||
            typeof rect.label !== 'string' || rect.label.length > 200) {
          throw new Error('Invalid rectangle geometry. The existing record has been preserved.');
        }
        const { cx, cy, width, height, angle, color, label } = rect;
        const restored = { cx, cy, width, height, angle, color, label };
        // Older saves have geometry only; never infer a snap from its shape.
        if (rect.snapMode === 'canny' || rect.snapMode === 'midpoint') restored.snapMode = rect.snapMode;
        if (rect.shapeMode === 'integral' || rect.shapeMode === 'square') restored.shapeMode = rect.shapeMode;
        if (rect.positionMethod === 'maximum' || rect.positionMethod === 'inflection') restored.positionMethod = rect.positionMethod;
        if (rect.useMaximum === true) restored.useMaximum = true;
        if (Number.isFinite(rect.smoothingSigma) && rect.smoothingSigma >= 0) restored.smoothingSigma = rect.smoothingSigma;
        if (Number.isFinite(rect.signalRange) && rect.signalRange >= 0 && rect.signalRange <= 100) restored.signalRange = rect.signalRange;
        items.set(id, restored);
      }
      return { items, selected: validSelection(record.selection ?? record.selected, items), saved: true };
    }
    // Correct rows assigned before the OM13 crop orientation was established.
    // Remap only when the rectangle lies clearly within a different known row;
    // preserve the exact old record and any comparison history first.
    function correctSavedRows(value, filename) {
      const storage = getStorage(), marker = keyFor(filename)+':om13-row-correction-v1';
      if (storage.getItem(marker) !== null) return value;
      const record=JSON.parse(value), entry=data.images.find(image=>image.filename===filename);
      validate(record, filename);
      const mapping=new Map(), changed=[];
      for (const [id, rect] of record.rectangles) {
        const match=/^spot-(p\d+-e0)-(left|right)-(m1|zero|p1)$/.exec(id);
        if (!match) { mapping.set(id,id); continue; }
        const cropY=entry.rawToCrop[1][0]*rect.cx+entry.rawToCrop[1][1]*rect.cy+entry.rawToCrop[1][2];
        const candidates=mask.rows.map((row,i)=>({row,distance:Math.abs(mask.referenceZeroCentresCrop[i*2][1]-cropY)})).sort((a,b)=>a.distance-b.distance);
        const found=candidates[0], clear=found && candidates[1] && found.distance<=45 && candidates[1].distance-found.distance>=35;
        const target=clear ? `spot-${found.row.id}-${match[2]}-${match[3]}` : id;
        mapping.set(id,target); if(target!==id) changed.push(id);
      }
      if (!changed.length) { storage.setItem(marker,'no_changes'); return value; }
      if (new Set(mapping.values()).size !== record.rectangles.length) {
        console.warn('OM13 row correction skipped because assignments conflict for '+filename); return value;
      }
      const definitions=new Map(window.rectangleSpotDefinitions().map(spot=>[spot.id,spot]));
      const updated={...record,rectangles:record.rectangles.map(([id,rect])=>{
        const target=mapping.get(id), spot=definitions.get(target);
        return [target,target===id?rect:{...rect,color:window.OM10SpotColors.forSpot(target),label:spot?.title || rect.label}];
      }),selection:(record.selection||[]).map(id=>mapping.get(id)||id),selected:mapping.get(record.selected)||record.selected};
      validate(updated,filename);
      const comparisonKey=scope+`om10-viewer:session:v1:${data.exposure}:${data.mask}:comparisons:`+filename;
      const oldComparisons=storage.getItem(comparisonKey);
      if(storage.getItem(keyFor(filename)+':before-om13-row-correction')===null) storage.setItem(keyFor(filename)+':before-om13-row-correction',value);
      if(oldComparisons!==null && storage.getItem(comparisonKey+':before-om13-row-correction')===null) storage.setItem(comparisonKey+':before-om13-row-correction',oldComparisons);
      const next=JSON.stringify(updated);storage.setItem(keyFor(filename),next);storage.setItem(marker,'corrected');
      console.info('Corrected '+changed.length+' OM13 row labels for '+filename+'; prior records backed up locally.');
      return next;
    }
    function load(filename, side = currentSide()) {
      try {
        if (!filenames.has(filename)) throw new Error('Unknown image.');
        const value = getStorage().getItem(keyFor(filename, side));
        // The blank fork has no pre-orientation annotations to migrate.
        if (value !== null) return validate(JSON.parse(value), filename);
        if (side === 'top' && Object.hasOwn(startingRecords, filename)) return validate(startingRecords[filename], filename);
        return { items: new Map(side === 'top' ? startingRectangles.get(filename) : undefined), selected: [], saved: false };
      } catch (error) {
        // Do not overwrite an unreadable save with an empty replacement.
        blocked.add(keyFor(filename, side));
        throw error;
      }
    }
    function serialize(filename, items, selected, side = currentSide()) {
      if (blocked.has(keyFor(filename, side))) throw new Error('The existing save could not be read; it has not been overwritten.');
      const selection = validSelection(selected, items);
      const record = { version: 1, exposure: data.exposure, mask: data.mask, filename,
        coordinates: 'raw-tiff-pixels', selection, selected: selection.at(-1) ?? null, rectangles: [...items] };
      validate(record, filename);
      return JSON.stringify(record);
    }
    function save(filename, items, selected, side = currentSide()) {
      getStorage().setItem(keyFor(filename, side), serialize(filename, items, selected, side));
    }
    function saveBatch(changes, side = currentSide()) {
      const storage = getStorage();
      const writes = changes.map(({ filename, items, selected }) => ({
        key: keyFor(filename, side), previous: storage.getItem(keyFor(filename, side)),
        next: serialize(filename, items, selected, side),
      }));
      const written = [];
      try {
        for (const item of writes) {
          storage.setItem(item.key, item.next);
          written.push(item);
        }
      } catch (error) {
        for (const item of written.reverse()) {
          if (item.previous === null) storage.removeItem(item.key);
          else storage.setItem(item.key, item.previous);
        }
        throw error;
      }
    }
    return { load, save, saveBatch, keyFor };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = createGratingStore;
  else window.createGratingStore = createGratingStore;
})();

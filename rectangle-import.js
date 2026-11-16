/* Read a complete CSV into groups before changing any saved dose. */
'use strict';
function rectangleCsvRows(text) {
  const rows = [];
  let row = [], value = '', quoted = false, closedQuote = false;
  text = text.replace(/^\uFEFF/, '');
  function endRow() {
    row.push(value);
    if (row.some(cell => cell.trim())) rows.push(row);
    row = []; value = ''; closedQuote = false;
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') value += ch;
      else if (text[i + 1] === '"') { value += '"'; i++; }
      else { quoted = false; closedQuote = true; }
    } else if (ch === ',') { row.push(value); value = ''; closedQuote = false; }
    else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else if (ch === '"' && value === '' && !closedQuote) quoted = true;
    else if (closedQuote || ch === '"') throw new Error('Invalid CSV quoting.');
    else value += ch;
  }
  if (quoted) throw new Error('Unclosed quote in CSV.');
  endRow();
  return rows;
}

window.readRectangleCsv = function (text, data, spots) {
  const [first, ...rows] = rectangleCsvRows(text);
  if (!first || !rows.length) throw new Error('The CSV contains no rectangle rows.');
  const headers = first.map(name => name.trim());
  if (new Set(headers).size !== headers.length) throw new Error('Duplicate column names in CSV.');
  const required = ['exposure', 'mask', 'image', 'coordinate_view', 'spot_id', 'centre_x_um',
    'centre_y_um', 'width_um', 'height_um', 'rotation_clockwise_deg', 'colour'];
  if (headers.includes('csv_version')) required.push('source_directory', 'source_sha256');
  for (const name of required) if (!headers.includes(name)) throw new Error(`Missing column ${name}.`);
  const images = new Map(data.images.map(entry => [entry.filename, entry]));
  const metadataMatches = (value, expected) => expected == null ? value === '' : value !== '' && Number(value) === expected;
  const identities = new Map(spots.map(spot => [spot.id, spot]));
  const selectedSide = window.OM10Session?.get('pictureSide', 'top') === 'bottom' ? 'bottom' : 'top';
  const groupsBySide = new Map([['top', new Map()], ['bottom', new Map()]]);
  const comparisonsBySide = new Map([['top', []], ['bottom', []]]);
  const emptyImages = new Set();
  for (const [index, cells] of rows.entries()) {
    const fail = message => { throw new Error(`Row ${index + 2}: ${message}`); };
    if (cells.length !== headers.length) fail('Wrong number of columns.');
    const row = Object.fromEntries(headers.map((name, i) => [name, cells[i].trim()]));
    if (row.csv_version !== undefined && !['1','2','3','4'].includes(row.csv_version)) fail('Unsupported CSV version.');
    if (row.csv_version === '3' && ['mask_pitch_nm','a_mask_pitch_nm','b_mask_pitch_nm'].some(name => row[name] === undefined)) {
      fail('Missing mask pitch columns in version 3 CSV.');
    }
    if (row.exposure !== data.exposure || row.mask !== data.mask) fail('Different exposure or mask.');
    const base = images.get(row.image), spot = identities.get(row.spot_id);
    if (!base) fail(`Unknown picture ${row.image}.`);
    const pictureSide = row.picture_side || selectedSide;
    if (!['top', 'bottom'].includes(pictureSide)) fail('Unknown picture side.');
    const image = base[pictureSide] ? { ...base, ...base[pictureSide] } : base;
    const groups = groupsBySide.get(pictureSide), comparisons = comparisonsBySide.get(pictureSide);
    const slot = pictureSide + '|' + row.image;
    if (row.source_directory !== undefined && row.source_directory !== data.sourceDirectory) fail('Source directory mismatch.');
    if (row.source_filename !== undefined && row.source_filename && row.source_filename !== image.sourceFilename) fail('Source TIFF filename mismatch.');
    if (row.source_sha256 !== undefined && !(row.record_type === 'empty_image' && row.source_sha256 === '') && row.source_sha256.toLowerCase() !== image.sourceSha256) fail('Source TIFF checksum mismatch.');
    if (row.csv_version === '2' || row.csv_version === '3' || row.csv_version === '4') {
      if (row.record_type === 'empty_image') {
        if (row.spot_id || row.a_spot_id || row.b_spot_id || emptyImages.has(slot) ||
            !metadataMatches(row.euv_dose_mJ_cm2, image.dose) || !metadataMatches(row.exposure_field, image.exposureField)) {
          fail('Invalid empty project image.');
        }
        emptyImages.add(slot);
        continue;
      }
      if (row.record_type === 'comparison') {
        if (!metadataMatches(row.euv_dose_mJ_cm2, image.dose) || !metadataMatches(row.exposure_field, image.exposureField)) fail('Image metadata mismatch.');
        comparisons.push({row, line:index+2}); continue;
      }
      if (row.record_type !== 'rectangle') fail('Unknown record type.');
    }
    if (row.coordinate_view !== 'original') fail('Full original TIFF coordinates are required.');
    if (!spot) fail(`Unknown spot ${row.spot_id}.`);
    for (const [name, expected] of Object.entries({ side: spot.side, electron_dose_variant: spot.variant,
      mask_electron_dose: spot.electronDose, pitch_nm: spot.pitch, mask_pitch_nm: spot.maskPitchNm, diffraction_order: spot.order,
      euv_dose_mJ_cm2: image.dose, exposure_field: image.exposureField })) {
      if (row[name] === undefined) continue;
      const value = expected == null && row[name] === '' ? null : typeof expected === 'number' && row[name] !== '' ? Number(row[name]) : row[name];
      if (value !== expected) fail(`${name} does not match the image or spot.`);
    }
    const number = name => {
      const value = Number(row[name]);
      if (!row[name] || !Number.isFinite(value)) fail(`Invalid ${name}.`);
      return value;
    };
    const pixel = image.pixelSizeUm;
    const rect = { cx: number('centre_x_um') / pixel, cy: image.height - number('centre_y_um') / pixel,
      width: number('width_um') / pixel, height: number('height_um') / pixel,
      angle: window.GratingGeometry.normalize((number('rotation_clockwise_deg') % 360) * Math.PI / 180),
      color: row.colour, label: spot.title };
    if (row.snap_mode) {
      if (!['canny', 'midpoint'].includes(row.snap_mode)) fail('Unknown snap mode.');
      rect.snapMode = row.snap_mode;
    }
    if (row.shape_mode) {
      if (!['square', 'integral'].includes(row.shape_mode)) fail('Unknown rectangle mode.');
      rect.shapeMode = row.shape_mode;
    }
    if (row.position_method) {
      if (!['maximum', 'inflection'].includes(row.position_method)) fail('Unknown integral position method.');
      rect.positionMethod = row.position_method;
    }
    if (row.signal_range_percent) {
      const value = Number(row.signal_range_percent);
      if (!Number.isFinite(value) || value < 0 || value > 100) fail('Invalid signal range.');
      rect.signalRange = value;
    }
    if (row.curve_gaussian_sigma_px) {
      const value = Number(row.curve_gaussian_sigma_px);
      if (!Number.isFinite(value) || value < 0) fail('Invalid curve smoothing.');
      rect.smoothingSigma = value;
    }
    if (![rect.cx, rect.cy, rect.width, rect.height].every(Number.isFinite) || rect.width < 1 || rect.height < 1) {
      fail('Invalid geometry. Each dimension must be at least one original pixel.');
    }
    if (rect.color.length > 100 || !CSS.supports('color', rect.color)) fail('Invalid rectangle colour.');
    if (!groups.has(image.filename)) groups.set(image.filename, new Map());
    const items = groups.get(image.filename);
    if (items.has(spot.id)) fail('This image and spot appear twice.');
    items.set(spot.id, rect);
  }
  for (const side of ['top', 'bottom']) {
    for (const name of groupsBySide.get(side).keys()) {
      if (emptyImages.has(side + '|' + name)) throw new Error('A picture side cannot be both empty and annotated.');
    }
    for (const {row} of comparisonsBySide.get(side)) {
      if (emptyImages.has(side + '|' + row.image)) throw new Error('A picture side cannot be both empty and compared.');
    }
  }
  const annotationCount = [...groupsBySide.values()].reduce((n, x) => n + x.size, 0) + [...comparisonsBySide.values()].reduce((n, x) => n + x.length, 0);
  const emptyProject = emptyImages.size > 0 && annotationCount === 0;
  if (emptyProject && ![images.size, images.size * 2].includes(emptyImages.size)) throw new Error('An empty project must list every source image.');
  return {groups: groupsBySide.get(selectedSide), comparisons: comparisonsBySide.get(selectedSide), groupsBySide, comparisonsBySide, emptyProject};
};

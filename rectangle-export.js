/* Export Top and Bottom with explicit picture and source identities. */
'use strict';
window.buildRectangleCsv = function (entries, spots, getRectangles, all, getComparisons) {
  const common = ['csv_version', 'exposure', 'mask', 'source_directory', 'image', 'picture_side', 'source_filename', 'source_sha256', 'exposure_field', 'euv_dose_mJ_cm2'];
  const geometry = ['spot_id', 'side', 'electron_dose_variant', 'mask_electron_dose', 'pitch_nm', 'mask_pitch_nm', 'diffraction_order',
    'coordinate_view', 'centre_x_um', 'centre_y_um', 'width_um', 'height_um', 'rotation_clockwise_deg', 'colour', 'snap_mode', 'shape_mode', 'position_method', 'signal_range_percent', 'curve_gaussian_sigma_px'];
  const pair = ['spot_id', 'zero_spot_id', 'pitch_nm', 'mask_pitch_nm', 'r_um'];
  const columns = all ? [...common, 'record_type', ...geometry, 'comparison_view',
    ...['a', 'b'].flatMap(k => pair.map(field => k+'_'+field)), 'comparison_status', 'wavelength_nm', 'created_at', 'comparison_snapshot_json'] : [...common, ...geometry];
  const { exposure, mask, sourceDirectory } = window.OM10_DATA;
  const rows = [columns], counts = { rectangles: 0, comparisons: 0, slots: 0 };
  function add(entry, side, actual, values) {
    const row = { csv_version: all ? 3 : 1, exposure, mask, source_directory: sourceDirectory, image: entry.filename,
      picture_side: side, source_filename: actual.sourceFilename || '', source_sha256: actual.sourceSha256 || '', exposure_field: entry.exposureField, euv_dose_mJ_cm2: entry.dose, ...values };
    rows.push(columns.map(key => row[key] ?? ''));
  }
  const sides = all ? ['top', 'bottom'] : [window.OM10Session.get('pictureSide', 'top')];
  for (const entry of entries) for (const side of sides) {
    const actual = entry[side] ? { ...entry, ...entry[side] } : entry;
    const rectangles = getRectangles(entry, side); let slotRecords = 0;
    counts.slots++;
    for (const spot of spots) {
      const rect = rectangles.get(spot.id);
      if (!rect) continue;
      const m = window.GratingGeometry.measurements(rect, actual, 'original');
      add(entry, side, actual, {record_type:'rectangle', spot_id:spot.id, side:spot.side, electron_dose_variant:spot.variant, mask_electron_dose:spot.electronDose,
        pitch_nm:spot.pitch, mask_pitch_nm:spot.maskPitchNm, diffraction_order:spot.order, coordinate_view:'original', centre_x_um:m.x, centre_y_um:m.y,
        width_um:m.width, height_um:m.height, rotation_clockwise_deg:m.rotation, colour:rect.color, snap_mode:rect.snapMode, shape_mode:rect.shapeMode || 'square', position_method:rect.positionMethod, signal_range_percent:rect.signalRange, curve_gaussian_sigma_px:rect.smoothingSigma});
      counts.rectangles++; slotRecords++;
    }
    if (all) for (const comparison of getComparisons(entry.filename, rectangles, side)) {
      add(entry, side, actual, {record_type:'comparison', ...comparison}); counts.comparisons++; slotRecords++;
    }
    if (all && !slotRecords) add(entry, side, actual, {record_type:'empty_image'});
  }
  if (rows.length === 1) return { counts, csv: '' };
  const escape = value => {
    const text = String(value);
    return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
  };
  return { counts, csv: rows.map(row => row.map(escape).join(',')).join('\r\n') + '\r\n' };
};

window.downloadRectangleCsv = function (entries, spots, getRectangles, all, getComparisons) {
  const { counts, csv } = window.buildRectangleCsv(entries, spots, getRectangles, all, getComparisons);
  if (!csv) return counts;
  const { mask } = window.OM10_DATA;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  const side = window.OM10Session.get('pictureSide', 'top');
  const scope = all ? 'all-pictures_top-bottom_rectangles_and_comparisons' : entries[0].filename+'_'+side+'_rectangles';
  link.href = url; link.download = mask+'_'+scope+'.csv';
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return counts;
};

/* Complete analysis export; compute integral centers from each original TIFF.
 * `prepareProfiles(entry, side, rectangles)` returns Map id => {detail,position,point}.
 * A missing profile is explicitly reported and never replaced by rectangle center. */
window.downloadFullRectangleCsv = async function(entries, spots, getRectangles, getComparisons, prepareProfiles, settings = {}, progress) {
  const data=window.OM10_DATA, mask=window.OM10_MASK, session=window.OM10Session;
  const fields=['csv_version','record_type','exposure','mask','source_directory','image','picture_side','source_filename','source_sha256','exposure_field','euv_dose_mJ_cm2',
    'spot_id','side','electron_dose_variant','mask_electron_dose','pitch_nm','mask_pitch_nm','diffraction_order','coordinate_view','centre_x_um','centre_y_um','width_um','height_um','rotation_clockwise_deg','colour','snap_mode','shape_mode','position_method','signal_range_percent','curve_gaussian_sigma_px',
    'selected_x_sensor_px','selected_y_sensor_px','selected_x_aligned_px','selected_y_aligned_px','selected_position_status','rectangle_json','profile_json','preprocessing_json','image_metadata_json','mask_row_json',
    'comparison_view','a_spot_id','a_zero_spot_id','a_pitch_nm','a_mask_pitch_nm','a_r_um','b_spot_id','b_zero_spot_id','b_pitch_nm','b_mask_pitch_nm','b_r_um','comparison_status','wavelength_nm','created_at','comparison_snapshot_json'];
  if (!document.getElementById('compare-tab')) fields.splice(fields.indexOf('comparison_view'));
  const esc=v=>{const t=v==null?'':String(v);return /[",\r\n]/.test(t)?'"'+t.replaceAll('"','""')+'"':t;};
  const lines=[fields.join(',')],counts={rectangles:0,comparisons:0,profiles:0,unavailableProfiles:0,slots:0};
  const add=object=>lines.push(fields.map(k=>esc(object[k])).join(','));
  // Snapshot values before asynchronously loading TIFFs so switching pictures or
  // editing while export runs cannot mix datasets.
  const tasks=[];
  for(const entry of entries) for(const pictureSide of ['top','bottom']) {
    const rectangles=new Map([...getRectangles(entry,pictureSide)].map(([id,r])=>[id,{...r}]));
    let comparisons;
    try {comparisons=getComparisons(entry.filename,rectangles,pictureSide).map(x=>({...x}));}
    catch(error) {comparisons=(session.getForSide('comparisons:'+entry.filename,pictureSide,[]) || []).map(saved=>({comparison_status:'unresolved',comparison_snapshot_json:JSON.stringify(saved)}));}
    tasks.push({entry,pictureSide,rectangles,comparisons});
  }
  const missing=[];
  for(const [index,task] of tasks.entries()) {
    const {entry,pictureSide,rectangles,comparisons}=task, actual=entry[pictureSide] ? {...entry,...entry[pictureSide]} : entry;
    const transform=window.GratingGeometry.viewMatrix(actual,'cropped');
    const common={csv_version:4,exposure:data.exposure,mask:data.mask,source_directory:data.sourceDirectory,image:entry.filename,picture_side:pictureSide,
      source_filename:actual.sourceFilename,source_sha256:actual.sourceSha256,exposure_field:entry.exposureField,euv_dose_mJ_cm2:entry.dose};
    const meta={pictureNumber:entry.number,pictureSide,sourceFilename:actual.sourceFilename,sourceSha256:actual.sourceSha256,
      sensorWidth:actual.width,sensorHeight:actual.height,alignedWidth:actual.cropWidth,alignedHeight:actual.cropHeight,
      rawToAligned:transform,pixelSizeUm:actual.pixelSizeUm,alignedPixelSizeUm:actual.alignment?.alignedPixelUm??actual.pixelSizeUm,objectiveMagnification:actual.objectiveMagnification,
      maskSource:mask.source,maskSourceSha256:mask.sourceSha256,nominalGapUm:2000+Number(session.get('gapCorrectionUm',0)),nominalWavelengthNm:3.1};
    const pre={curveInput:'original linear grayscale TIFF',referenceSubtraction:false,displayFilterApplied:false,
      fit:'linear least squares to both regions outside signal range',normalization:'background-subtracted smoothed profile divided by its maximum',...settings};
    common.image_metadata_json=JSON.stringify(meta);common.preprocessing_json=JSON.stringify(pre);counts.slots++;
    let measures=new Map(), reason='';
    if([...rectangles.values()].some(rect=>rect.shapeMode==='integral')) {
      progress?.(`Preparing picture ${entry.number} ${pictureSide} (${index+1}/${tasks.length})…`);
      await new Promise(resolve=>setTimeout(resolve,0));
      try {measures=await prepareProfiles(entry,pictureSide,rectangles,settings) || new Map();}
      catch(error) {reason=error.message || String(error);}
    }
    let n=0;
    for(const spot of spots) {
      const rect=rectangles.get(spot.id);if(!rect)continue;
      const geometry=window.GratingGeometry.measurements(rect,actual,'original');
      const integral=rect.shapeMode==='integral', measured=measures.get(spot.id) || {};
      const point=integral ? measured.point : {x:rect.cx,y:rect.cy};
      const aligned=point && window.GratingGeometry.transform(point,transform);
      let status=point?'ok':reason ? 'unavailable: '+reason : 'unavailable: profile or center could not be calculated';
      if(integral && !point) {counts.unavailableProfiles++;missing.push(`${entry.filename} ${pictureSide} ${spot.id}: ${status}`);}
      if(integral && measured.detail) counts.profiles++;
      add({...common,record_type:'rectangle',spot_id:spot.id,side:spot.side,electron_dose_variant:spot.variant,mask_electron_dose:spot.electronDose,
        pitch_nm:spot.pitch,mask_pitch_nm:spot.maskPitchNm,diffraction_order:spot.order,coordinate_view:'original',centre_x_um:geometry.x,centre_y_um:geometry.y,
        width_um:geometry.width,height_um:geometry.height,rotation_clockwise_deg:geometry.rotation,colour:rect.color,snap_mode:rect.snapMode,
        shape_mode:rect.shapeMode || 'square',position_method:integral?(rect.positionMethod || 'maximum'):'',
        signal_range_percent:integral?(rect.signalRange ?? session.get('integralDummyPercent',75)):'',curve_gaussian_sigma_px:integral?(rect.smoothingSigma ?? 0):'',
        selected_x_sensor_px:point?.x,selected_y_sensor_px:point?.y,selected_x_aligned_px:aligned?.x,selected_y_aligned_px:aligned?.y,selected_position_status:status,
        rectangle_json:JSON.stringify(rect),profile_json:measured.detail?JSON.stringify({detail:measured.detail,position:measured.position}):'',mask_row_json:JSON.stringify(mask.rows[spot.rowIndex])});
      counts.rectangles++;n++;
    }
    for(const comparison of comparisons) {add({...common,record_type:'comparison',...comparison});counts.comparisons++;n++;}
    if(!n) add({...common,record_type:'empty_image'});
  }
  const url=URL.createObjectURL(new Blob([lines.join('\r\n')+'\r\n'],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=document.getElementById('compare-tab') ? mask.mask?.split(' ')[0]+'_all-pictures_top-bottom_complete_analysis.csv' : 'all-pictures_rectangles.csv';
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  return {...counts,unavailableDetails:missing};
};

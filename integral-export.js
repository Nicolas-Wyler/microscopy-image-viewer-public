/* Three-column profile export: metadata rows, then x/y sensor pixels and intensity. */
'use strict';
window.exportIntegralCsv = function ({ entry, context, spot, rect, detail, signalRange }) {
  const data=window.OM10_DATA, pixelSize=entry.pixelSizeUm;
  const pictureSide=context.pictureSide || window.OM10Session?.get('pictureSide','top') || 'top';
  const transform=window.GratingGeometry.viewMatrix(entry,'cropped');
  const position=window.integralPosition(detail,rect.positionMethod || 'maximum');
  const fields={
    export_format:'om13-integral-profile-three-column-v1', exposure:data.exposure, mask:data.mask,
    picture_number:entry.number, picture_side:pictureSide, source_directory:data.sourceDirectory,
    source_image:entry.sourceFilename, source_tiff_sha256:entry.sourceSha256,
    source_sensor_width_px:entry.width, source_sensor_height_px:entry.height,
    sensor_to_aligned_matrix_json:JSON.stringify(transform), aligned_width_px:entry.cropWidth, aligned_height_px:entry.cropHeight,
    image_dose_mJ_cm2:entry.dose, image_exposure_field:entry.exposureField, objective_magnification:entry.objectiveMagnification,
    pixel_size_um:pixelSize, spot_id:spot.id, spot_label:rect.label, grating_side:spot.side,
    diffraction_order:spot.order, wafer_pitch_nm:spot.pitch, mask_pitch_nm:spot.maskPitchNm,
    electron_dose_variant:spot.variant, mask_electron_dose_uC_cm2:spot.electronDose,
    rectangle_coordinate_system:'original_tiff_sensor_pixels_xy_top_left', centre_x_sensor_px:rect.cx, centre_y_sensor_px:rect.cy,
    rectangle_width_px:rect.width, rectangle_height_px:rect.height, rectangle_width_um:rect.width*pixelSize,
    rectangle_height_um:rect.height*pixelSize, rectangle_rotation_clockwise_deg:rect.angle*180/Math.PI,
    rectangle_colour:rect.color, shape_mode:rect.shapeMode || 'square', signal_range_percent:signalRange,
    position_method:rect.positionMethod || 'maximum', selected_position_from_centre_px:position?.position,
    left_inflection_from_centre_px:position?.leftInflection, right_inflection_from_centre_px:position?.rightInflection,
    derivative_maximum_from_centre_px:position?.derivativeMaximumPosition, derivative_minimum_from_centre_px:position?.derivativeMinimumPosition,
    inflection_method:'maximum and minimum derivative within signal range; sampled positions',
    peak_sample_index:detail.maximum>1e-9 ? detail.normalized.indexOf(Math.max(...detail.normalized.filter(v=>v!==null))) : '',
    peak_position_from_centre_px:detail.maximum>1e-9 ? detail.positions[detail.normalized.indexOf(Math.max(...detail.normalized.filter(v=>v!==null)))] : '',
    displayed_view:context.view, displayed_filter:context.filter,
    background_mode:context.backgroundMode, background_image:context.backgroundMode==='normalized'?entry.backgroundName:'', background_gaussian_sigma_px:context.backgroundMode==='normalized'?context.gaussianSigma:'', background_zero_offset:context.backgroundMode==='normalized'?context.zeroOffset:'', curve_input:context.backgroundMode==='normalized'?'linear signed sensor-pixel intensity after reference subtraction':'original linear grayscale intensity; display filters are not used',
    sampling_method:'nearest pixel; uniform across rectangle; mean along height; 256 column and 512 height sample maximum',
    curve_gaussian_sigma_px:detail.smoothingSigma, curve_smoothing_method:'Gaussian on background-subtracted profile; truncated at 4 sigma; renormalized at boundaries',
    number_of_columns:detail.values.length, samples_along_height:detail.sampleCountAcross,
    fit_method:'ordinary least squares on both regions outside signal ticks', fit_x_coordinate:'dimensionless; -0.5 left edge to +0.5 right edge',
    fit_intercept_intensity:detail.intercept, fit_slope_intensity_per_rectangle_width:detail.slope,
    fit_points:detail.backgroundCount, fit_points_left:detail.backgroundLeftCount, fit_points_right:detail.backgroundRightCount,
    corrected_profile_max:detail.maximum,
    normalized_curve_rule:'Gaussian-smooth(column mean - fitted background) / smoothed_profile_max; signed values retained',
    nominal_gap_um:data.nominalGapUm??'', nominal_wavelength_nm:data.nominalWavelengthNm??'',
    exported_at_utc:new Date().toISOString()
  };
  const esc=value=>{const text=value==null?'':String(value);return /[",\r\n]/.test(text)?'"'+text.replaceAll('"','""')+'"':text;};
  const rows=[['parameter','value',''].map(esc).join(',')];
  for (const [name,value] of Object.entries(fields)) rows.push([name,value,''].map(esc).join(','));
  for(let i=0;i<detail.sampleCounts.length;i++) rows.push([`sample_${i}_valid_height_samples`,detail.sampleCounts[i],''].map(esc).join(','));
  if (position && (rect.positionMethod || 'maximum') === 'inflection') {
    for(let i=0;i<position.derivative.length;i++) rows.push([`derivative_${i}_per_px`,position.derivative[i],''].map(esc).join(','));
  }
  rows.push(['curve_coordinate_system','original TIFF sensor pixels; origin top-left; X right, Y down',''].map(esc).join(','));
  rows.push(['x_sensor_px','y_sensor_px','normalized_value'].map(esc).join(','));
  const c=Math.cos(rect.angle), s=Math.sin(rect.angle);
  for(let i=0;i<detail.values.length;i++) {
    const u=detail.positions[i];
    rows.push([rect.cx+c*u,rect.cy+s*u,detail.normalized[i]].map(esc).join(','));
  }
  const url=URL.createObjectURL(new Blob([rows.join('\r\n')+'\r\n'],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=`${data.mask}_${entry.sourceFilename.replace(/\.tif$/i,'')}_${pictureSide}_${spot.id}_integral.csv`;
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
};

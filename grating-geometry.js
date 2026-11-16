/* Pure rectangle geometry in native image pixels. Also loaded by Node tests. */
'use strict';
(() => {
  const MIN_SIZE = 1;
  const turn = (p, angle) => ({ x: p.x * Math.cos(angle) - p.y * Math.sin(angle), y: p.x * Math.sin(angle) + p.y * Math.cos(angle) });
  const point = (r, x, y) => {
    const p = turn({ x, y }, r.angle);
    return { x: r.cx + p.x, y: r.cy + p.y };
  };
  const normalize = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
  const transform = (p, m) => ({ x: m[0][0] * p.x + m[0][1] * p.y + m[0][2], y: m[1][0] * p.x + m[1][1] * p.y + m[1][2] });
  function inverseTransform(p, m) {
    const x = p.x - m[0][2], y = p.y - m[1][2];
    const det = m[0][0] * m[1][1] - m[0][1] * m[1][0];
    return { x: (m[1][1] * x - m[0][1] * y) / det, y: (-m[1][0] * x + m[0][0] * y) / det };
  }
  const identity = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  function viewMatrix(entry, view) {
    if (view !== 'cropped') return identity;
    // OpenCV labels pixel centres with integers. CSS and the viewer's positions
    // start at the outside edge of pixel zero, whose centre is (0.5, 0.5).
    const [[a, c, tx], [b, d, ty]] = entry.rawToCrop;
    return [[a, c, tx + (1 - a - c) / 2], [b, d, ty + (1 - b - d) / 2], [0, 0, 1]];
  }
  function measurements(rect, entry, view) {
    const matrix = viewMatrix(entry, view);
    const centre = transform({ x: rect.cx, y: rect.cy }, matrix);
    const imageHeight = view === 'cropped' ? entry.cropHeight : entry.height;
    const pixel = entry.pixelSizeUm, displayPixel=view==='cropped'?(entry.alignment?.alignedPixelUm??pixel):pixel;
    return {
      x: centre.x * displayPixel, y: (imageHeight - centre.y) * displayPixel,
      width: rect.width * pixel, height: rect.height * pixel,
      rotation: normalize(rect.angle + Math.atan2(matrix[1][0], matrix[0][0])) * 180 / Math.PI,
    };
  }
  function withMeasurement(rect, entry, view, field, value) {
    if (!Number.isFinite(value)) return null;
    if (field === 'width' || field === 'height') {
      const pixels = value / entry.pixelSizeUm;
      return Number.isFinite(pixels) && pixels >= MIN_SIZE ? { ...rect, [field]: pixels } : null;
    }
    const matrix = viewMatrix(entry, view);
    if (field === 'rotation') {
      const angle = (value % 360) * Math.PI / 180 - Math.atan2(matrix[1][0], matrix[0][0]);
      return { ...rect, angle: normalize(angle) };
    }
    if (field !== 'x' && field !== 'y') return null;
    const centre = transform({ x: rect.cx, y: rect.cy }, matrix);
    const displayPixel=view==='cropped'?(entry.alignment?.alignedPixelUm??entry.pixelSizeUm):entry.pixelSizeUm;
    if (field === 'x') centre.x = value / displayPixel;
    else centre.y = (view === 'cropped' ? entry.cropHeight : entry.height) - value / displayPixel;
    const raw = inverseTransform(centre, matrix);
    return Number.isFinite(raw.x) && Number.isFinite(raw.y) ? { ...rect, cx: raw.x, cy: raw.y } : null;
  }
  function move(r, delta) { return { ...r, cx: r.cx + delta.x, cy: r.cy + delta.y }; }
  function resize(r, name, delta) {
    const local = turn(delta, -r.angle);
    const sx = name.includes('left') ? -1 : name.includes('right') ? 1 : 0;
    const sy = name.includes('top') ? -1 : name.includes('bottom') ? 1 : 0;
    const width = Math.max(MIN_SIZE, r.width + sx * local.x);
    const height = Math.max(MIN_SIZE, r.height + sy * local.y);
    const offset = turn({ x: sx * (width - r.width) / 2, y: sy * (height - r.height) / 2 }, r.angle);
    return { ...move(r, offset), width, height };
  }
  function rotate(r, from, to) {
    if (Math.hypot(to.x - r.cx, to.y - r.cy) < 1e-6) return { ...r };
    const delta = Math.atan2(to.y - r.cy, to.x - r.cx) - Math.atan2(from.y - r.cy, from.x - r.cx);
    return { ...r, angle: normalize(r.angle + delta) };
  }
  // Repeat an edit, not the resulting absolute geometry. A dragged handle
  // displaces the same sides in each member's own axes, fixing the far sides.
  function peerEdit(anchor, after, member, action) {
    if (member === anchor) return after;
    const dw = after.width - anchor.width, dh = after.height - anchor.height;
    if (action && ['left', 'right', 'top', 'bottom'].some(side => action.includes(side))) {
      const dx = action.includes('left') ? -dw : dw, dy = action.includes('top') ? -dh : dh;
      return resize(member, action, turn({x:dx, y:dy}, member.angle));
    }
    return { ...member, cx: member.cx + (after.cx - anchor.cx), cy: member.cy + (after.cy - anchor.cy),
      width: Math.max(MIN_SIZE, member.width + dw), height: Math.max(MIN_SIZE, member.height + dh),
      angle: after.angle === anchor.angle ? member.angle : normalize(member.angle + (after.angle - anchor.angle)) };
  }
  function seedSpot(entry, mask, spot) {
    const row = mask.rows[spot.rowIndex];
    const refsForRow = mask.referenceZeroCentresCrop.slice(spot.rowIndex * 2, spot.rowIndex * 2 + 2);
    const zero = spot.side === 'both' ? [(refsForRow[0][0]+refsForRow[1][0])/2, (refsForRow[0][1]+refsForRow[1][1])/2] : refsForRow[spot.side === 'right' ? 1 : 0];
    const width = Math.min((row.nominalSpotWidthUm ?? mask.nominalSpotSideUm) / entry.pixelSizeUm, entry.cropWidth - 8);
    const height = Math.min(mask.nominalSpotSideUm / entry.pixelSizeUm, entry.cropHeight - 8);
    const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
    const anchors=mask.rows.flatMap(r=>[r.leftCentreUm,r.rightCentreUm]), refs=mask.referenceZeroCentresCrop;
    const avg=(points,axis)=>points.reduce((sum,p)=>sum+p[axis],0)/points.length;
    const mx=avg(anchors,0), my=avg(anchors,1), rx=avg(refs,0), ry=avg(refs,1);
    let dot=0, cross=0;
    anchors.forEach(([x,y],i)=>{ const u=refs[i][0]-rx, v=refs[i][1]-ry; dot+=(x-mx)*u+(y-my)*v; cross+=(x-mx)*v-(y-my)*u; });
    const orientation=Math.atan2(cross,dot), displacement=(spot.side === 'both' ? 0 : spot.order*row.nominalDisplacementUm/entry.pixelSizeUm);
    const cropCentre = {
      x: clamp(zero[0] + .5 + Math.cos(orientation)*displacement, width / 2 + 4, entry.cropWidth - width / 2 - 4),
      y: clamp(zero[1] + .5 + Math.sin(orientation)*displacement, height / 2 + 4, entry.cropHeight - height / 2 - 4),
    };
    const centre = inverseTransform(cropCentre, viewMatrix(entry, 'cropped'));
    return { cx: centre.x, cy: centre.y, width, height,
      angle: Math.atan2(Math.sin(2*(orientation - Math.atan2(entry.rawToCrop[1][0], entry.rawToCrop[0][0]))), Math.cos(2*(orientation - Math.atan2(entry.rawToCrop[1][0], entry.rawToCrop[0][0]))))/2,
      color: spot.color, label: spot.label };
  }
  function seedFromPeers(entry, peers, spot) {
    if (!peers.length) return null;
    const aligned = peers.map(({ entry: source, rect }) => ({
      centre: transform({ x: rect.cx, y: rect.cy }, viewMatrix(source, 'cropped')),
      width: rect.width, height: rect.height,
      angle: normalize(rect.angle + Math.atan2(source.rawToCrop[1][0], source.rawToCrop[0][0])),
    }));
    const mean = values => values.reduce((sum, value) => sum + value / values.length, 0);
    let width = mean(aligned.map(r => r.width)), height = mean(aligned.map(r => r.height));
    // Rectangles have 180-degree rotational symmetry. Choose the equivalent
    // mean nearest the first example; an exactly ambiguous mean keeps that angle.
    const sine = mean(aligned.map(r => Math.sin(2 * r.angle)));
    const cosine = mean(aligned.map(r => Math.cos(2 * r.angle)));
    const reference = aligned[0].angle;
    const angle = Math.hypot(sine, cosine) < 1e-8 ? reference
      : reference + normalize(2 * (.5 * Math.atan2(sine, cosine) - reference)) / 2;
    const c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
    const shrink = Math.min(1, (entry.cropWidth - 8) / (width * c + height * s),
      (entry.cropHeight - 8) / (width * s + height * c));
    width = Math.max(1, width * shrink); height = Math.max(1, height * shrink);
    const halfX = (width * c + height * s) / 2, halfY = (width * s + height * c) / 2;
    const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
    const centre = inverseTransform({
      x: clamp(mean(aligned.map(r => r.centre.x)), halfX + 4, entry.cropWidth - halfX - 4),
      y: clamp(mean(aligned.map(r => r.centre.y)), halfY + 4, entry.cropHeight - halfY - 4),
    }, viewMatrix(entry, 'cropped'));
    return { cx: centre.x, cy: centre.y, width, height,
      angle: normalize(angle - Math.atan2(entry.rawToCrop[1][0], entry.rawToCrop[0][0])),
      color: spot.color, label: spot.label };
  }
  // Preserve the exact dimensions and rotation while keeping a new copy in
  // the aligned crop whenever those dimensions can actually fit.
  function keepInsideCrop(rect, entry) {
    const matrix=viewMatrix(entry,'cropped'), centre=transform({x:rect.cx,y:rect.cy},matrix);
    const angle=rect.angle+Math.atan2(matrix[1][0],matrix[0][0]);
    const c=Math.abs(Math.cos(angle)),s=Math.abs(Math.sin(angle));
    const factor=Math.hypot(matrix[0][0],matrix[1][0]);
    const halfX=factor*(rect.width*c+rect.height*s)/2,halfY=factor*(rect.width*s+rect.height*c)/2;
    const fits=2*halfX<=entry.cropWidth && 2*halfY<=entry.cropHeight;
    const coordinate=(value,half,size)=>{
      if (2*half>size) return size/2;
      const padding=Math.min(4,(size-2*half)/2);
      return Math.max(half+padding,Math.min(size-half-padding,value));
    };
    const raw=inverseTransform({x:coordinate(centre.x,halfX,entry.cropWidth),
      y:coordinate(centre.y,halfY,entry.cropHeight)},matrix);
    return {rect:{...rect,cx:raw.x,cy:raw.y},fits};
  }
  // Both alignments are rigid transforms of the same native-pixel crop.
  // Unlike first placement, copying must not clamp or shrink a manually edited rectangle.
  function copyToDose(rect, source, destination) {
    const from = viewMatrix(source, 'cropped'), to = viewMatrix(destination, 'cropped');
    const centre = inverseTransform(transform({ x: rect.cx, y: rect.cy }, from), to);
    const rotation = m => Math.atan2(m[1][0], m[0][0]);
    const factor=(source.pixelSizeUm||1)/(destination.pixelSizeUm||1);
    return { ...rect, cx: centre.x, cy: centre.y, width:rect.width*factor,height:rect.height*factor,
      angle: normalize(rect.angle + rotation(from) - rotation(to)) };
  }
  const api = { turn, point, normalize, transform, inverseTransform, viewMatrix, measurements, withMeasurement,
    move, resize, corner: resize, rotate, peerEdit, seedSpot, seedFromPeers, keepInsideCrop, copyToDose };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.GratingGeometry = api;
})();

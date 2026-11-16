/* Popup positions are in browser-window coordinates, independent of image pan and zoom. */
'use strict';
(() => {
  const positions = new Map();
  const margin = 8;

  function restore(panel) {
    const position = positions.get(panel);
    if (!position) return false;
    if (!panel.getClientRects().length) return true;
    panel.classList.add('popup-positioned');
    const box = panel.getBoundingClientRect();
    const { clientWidth, clientHeight } = document.documentElement;
    const left = Math.max(margin, Math.min(position.left, clientWidth - box.width - margin));
    const top = Math.max(margin, Math.min(position.top, clientHeight - box.height - margin));
    panel.style.setProperty('--popup-left', left + 'px');
    panel.style.setProperty('--popup-top', top + 'px');
    return true;
  }
  function reset(panel) {
    positions.delete(panel);
    panel.classList.remove('popup-positioned');
    panel.style.removeProperty('--popup-left');
    panel.style.removeProperty('--popup-top');
  }

  const resize = new ResizeObserver(entries => {
    for (const {target} of entries) restore(target);
  });
  window.addEventListener('resize', () => positions.forEach((_, panel) => restore(panel)));
  for (const handle of document.querySelectorAll('[data-popup-drag-handle]')) {
    const panel = handle.closest('[data-draggable-popup]');
    resize.observe(panel);
    handle.title = 'Drag to move';
    let start = null;
    handle.addEventListener('pointerdown', event => {
      if (start || !event.isPrimary || event.button !== 0 || event.ctrlKey ||
          event.target.closest('button, input, select, textarea, a, [contenteditable="true"]')) return;
      const {left, top} = panel.getBoundingClientRect();
      start = {id:event.pointerId, x:event.clientX, y:event.clientY, left, top};
      event.preventDefault(); // Keep focus in the popup, including when a number field is active.
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', event => {
      if (start?.id !== event.pointerId) return;
      const dx = event.clientX - start.x, dy = event.clientY - start.y;
      if (!handle.classList.contains('popup-dragging') && Math.hypot(dx,dy) < 3) return;
      handle.classList.add('popup-dragging');
      positions.set(panel, {left:start.left + dx, top:start.top + dy});
      restore(panel);
    });
    function finish(event) {
      if (start?.id !== event.pointerId) return;
      start = null;
      handle.classList.remove('popup-dragging');
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    }
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.addEventListener(type, finish);
  }
  window.OM11PopupDrag = {restore, reset};
})();

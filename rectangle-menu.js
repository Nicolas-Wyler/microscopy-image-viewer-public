'use strict';
window.createRectangleMenu = function ({ layer, select, render, snap, remove, duplicate, getMode, applyMode, getSignalRange, setSignalRange, exportIntegral, getSmoothing, setSmoothing, getPositionMethod, setPositionMethod }) {
  const popup = document.getElementById('rectangle-menu'), commands = popup.querySelector('[role=menu]');
  const status = popup.querySelector('[role=status]');
  const buttons = [...commands.querySelectorAll('button')];
  const stored=window.OM10Session.get('rectangleCreationSettings',{});
  let target = null, mode = stored.shapeMode==='integral'?'integral':'square';
  let lastSettings={shapeMode:mode,positionMethod:stored.positionMethod==='inflection'?'inflection':'maximum',smoothingSigma:Number.isFinite(stored.smoothingSigma)&&stored.smoothingSigma>=0?stored.smoothingSigma:0,signalRange:Number.isFinite(stored.signalRange)&&stored.signalRange>=0&&stored.signalRange<=100?stored.signalRange:window.OM10Session.get('integralDummyPercent',75)};
  function remember(){
    if(!target)return;
    lastSettings={shapeMode:mode,positionMethod:getPositionMethod(target.id),smoothingSigma:getSmoothing(target.id),signalRange:getSignalRange(target.id)};
    window.OM10Session.set('rectangleCreationSettings',lastSettings);
  }
  const modeButtons = [...popup.querySelectorAll('[data-mode]')];
  const squareButtons = buttons.filter(button => ['canny', 'midpoint'].includes(button.dataset.command));
  const placeholder = popup.querySelector('.integral-placeholder');
  const smoothControl = popup.querySelector('.integral-smooth'), smoothInput = smoothControl.querySelector('input');
  const signalControl = popup.querySelector('.integral-signal-range'), signalInput = signalControl.querySelector('input');
  const snapControl = popup.querySelector('.snap-range'), snapInput = snapControl.querySelector('input');
  function setMode(value, update = true) {
    mode = value;
    modeButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
    squareButtons.forEach(button => { button.hidden = mode === 'integral'; });
    signalControl.hidden = mode !== 'integral';
    snapControl.hidden = mode !== 'square';
    snapInput.value = percent('square');
    if (target) signalInput.value = percent('integral', target.id);
    placeholder.hidden = true;
    smoothControl.hidden = mode !== 'integral';
    if (target) smoothInput.value = getSmoothing(target.id);
    commands.querySelector('[data-command=export-integral]').hidden = mode !== 'integral';
    const method=target ? getPositionMethod(target.id) : 'maximum';
    for (const name of ['maximum','inflection']) {
      const button=commands.querySelector(`[data-command=${name}]`);
      button.hidden=mode !== 'integral';
      button.setAttribute('aria-pressed', String(method===name));
      button.querySelector(`[data-${name}-state]`).textContent=method===name ? '✓' : '';
    }
    status.textContent = '';
    if (target && update && !popup.hidden) { place(); render(); }
  }
  modeButtons.forEach(button => button.addEventListener('click', () => {
    if (!target) return;
    applyMode(button.dataset.mode);
    setMode(button.dataset.mode); remember();
  }));

  function applySmoothing() {
    if (!target || !smoothInput.reportValidity()) return;
    const value=smoothInput.valueAsNumber;
    if (!Number.isFinite(value) || value < 0) return;
    if (value !== getSmoothing(target.id)) { setSmoothing(target.id,value); render(); }
    remember();
  }
  smoothInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); applySmoothing(); }
  });
  smoothInput.addEventListener('change', applySmoothing);

  function applyDirectSignalRange() {
    if (!target || !signalInput.reportValidity()) return;
    const value=signalInput.valueAsNumber;
    if (!Number.isFinite(value) || value < 0 || value > 100) return;
    if (value !== getSignalRange(target.id)) setSignalRange(target.id,value);
    remember(); render();
  }
  signalInput.addEventListener('input', () => { if (signalInput.validity.valid) render(); });
  signalInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); applyDirectSignalRange(); }
  });
  signalInput.addEventListener('change', applyDirectSignalRange);

  function applyDirectSnapRange() {
    if (!target || !snapInput.reportValidity()) return;
    const value = snapInput.valueAsNumber;
    if (!Number.isFinite(value) || value < 0 || value > 100) return;
    window.OM10Session.set('snapRange', value);
    render();
  }
  snapInput.addEventListener('input', () => { if (snapInput.validity.valid) render(); });
  snapInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); applyDirectSnapRange(); }
  });
  snapInput.addEventListener('change', applyDirectSnapRange);

  function percent(activeMode = mode, id = target?.id) {
    const saved = activeMode === 'integral' && id ? getSignalRange(id) : window.OM10Session.get(activeMode === 'integral' ? 'integralDummyPercent' : 'snapRange', 75);
    return Number.isFinite(saved) && saved >= 0 && saved <= 100 ? saved : 75;
  }
  function fraction(activeMode = mode, id = target?.id) {
    if (activeMode === 'integral' && target && id === target.id && document.activeElement === signalInput && signalInput.validity.valid) return signalInput.valueAsNumber / 100;
    if (activeMode === 'square' && target && mode === 'square' && document.activeElement === snapInput && snapInput.validity.valid) return snapInput.valueAsNumber / 100;
    return percent(activeMode, id) / 100;
  }
  function place() {
    if (window.OM11PopupDrag?.restore(popup)) return;
    const box = popup.getBoundingClientRect();
    function offset(pointer, size, limit) {
      const near = pointer + 4;
      return Math.max(4, Math.min(limit - size - 4, near + size + 4 <= limit ? near : pointer - size - 4));
    }
    popup.style.left = offset(target.x, box.width, innerWidth) + 'px';
    popup.style.top = offset(target.y, box.height, innerHeight) + 'px';
  }
  function close(restoreFocus = false) {
    if (!target) return;
    const source = target.source;
    if (document.activeElement === smoothInput) applySmoothing();
    if (document.activeElement === signalInput) applyDirectSignalRange();
    if (document.activeElement === snapInput) applyDirectSnapRange();
    remember(); target = null; popup.hidden = true;
    if (restoreFocus && source.isConnected) source.focus({ preventScroll: true });
    render();
  }
  function open(shape, x, y, keyboard = false) {
    close();
    window.OM11PopupDrag?.reset(popup);
    const source = shape.querySelector('[data-action=move]');
    source.focus({ preventScroll: true }); // Finish a pending sidebar edit.
    select(shape.dataset.outlineId);
    target = { id: shape.dataset.outlineId, source, x, y };
    status.textContent = ''; commands.hidden = false;
    setMode(getMode(shape.dataset.outlineId), false); remember();
    buttons.forEach(button => { button.disabled = false; });
    popup.hidden = false; place();
    (keyboard ? buttons.find(button => !button.hidden) : commands).focus({ preventScroll: true }); render();
  }
  layer.addEventListener('contextmenu', event => {
    const shape = event.target.closest('[data-outline-id]');
    if (!shape) return;
    event.preventDefault();
    open(shape, event.clientX, event.clientY);
  });
  layer.addEventListener('keydown', event => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    const shape = event.target.closest('[data-outline-id]');
    if (!shape) return;
    event.preventDefault();
    const box = shape.querySelector('[data-action=move]').getBoundingClientRect();
    open(shape, box.left + box.width/2, box.top + box.height/2, true);
  });
  commands.addEventListener('click', async event => {
    const action = event.target.closest('button')?.dataset.command;
    const current = target;
    if (!action || !current) return;
    if (action === 'maximum' || action === 'inflection') { setPositionMethod(current.id, action); setMode(mode); remember(); return; }
    if (action === 'export-integral') {
      status.textContent = exportIntegral(current.id) || 'CSV downloaded.'; place(); return;
    }
    if (action === 'remove') { close(); remove(current.id); return; }
    if (action === 'duplicate') { close(); duplicate(current.id); return; }
    if (!fraction()) { status.textContent = 'Set a snap range above 0%.'; place(); return; }
    commands.focus({ preventScroll: true });
    buttons.forEach(button => { button.disabled = true; });
    try {
      const message = await snap(current, action, fraction());
      if (target !== current) return;
      if (!message) { close(true); return; }
      status.textContent = message;
    } catch (error) {
      if (target !== current) return;
      status.textContent = 'Could not read the Canny image.';
      console.warn('Rectangle snap failed', error);
    }
    buttons.forEach(button => { button.disabled = false; });
    place(); commands.querySelector('[data-command="' + action + '"]').focus({ preventScroll: true });
  });
  popup.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); close(true); return;
    }
    if (event.target === smoothInput || event.target === signalInput || event.target === snapInput || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
    event.stopPropagation();
    const key = event.key.toLowerCase();
    const visibleButtons = buttons.filter(button => !button.hidden && !button.disabled);
    const shortcut = visibleButtons.find(button => button.getAttribute('aria-keyshortcuts')?.toLowerCase().split(' ').includes(key));
    if (shortcut && !event.shiftKey) {
      event.preventDefault();
      if (!event.repeat && !shortcut.disabled) shortcut.click();
      return;
    }
    const index = visibleButtons.indexOf(document.activeElement);
    const next = { ArrowDown: (index+1)%visibleButtons.length, ArrowUp: index <= 0 ? visibleButtons.length-1 : index-1,
      Home: 0, End: visibleButtons.length-1 }[event.key];
    if (next !== undefined) { event.preventDefault(); visibleButtons[next].focus(); }
  });
  popup.addEventListener('focusout', event => {
    if (event.relatedTarget && !popup.contains(event.relatedTarget)) close();
  });
  document.addEventListener('pointerdown', event => { if (target && !popup.contains(event.target)) close(); }, true);
  document.addEventListener('scroll', event => { if (target && !popup.contains(event.target)) close(); }, true);
  window.addEventListener('resize', () => {
    if (target && !window.OM11PopupDrag?.restore(popup)) close();
  });
  window.addEventListener('blur', () => close());
  function positionStatus(id, message) { if (target?.id === id && mode === 'integral') status.textContent = message || ''; }
  return { close, fraction, positionStatus, defaults:()=>({...lastSettings}), get mode() { return mode; }, get target() { return target; } };
};

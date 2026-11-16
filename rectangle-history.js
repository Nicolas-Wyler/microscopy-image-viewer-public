/* One undo step per rectangle edit or import, across doses. Store only touched rectangles. */
'use strict';
(() => {
  const fields = ['cx', 'cy', 'width', 'height', 'angle', 'label', 'color', 'snapMode', 'shapeMode', 'signalRange', 'useMaximum', 'smoothingSigma', 'positionMethod'];
  function same(a, b) {
    return a === b || Boolean(a && b && fields.every(field => a[field] === b[field]));
  }

  function createRectangleHistory(session) {
    function stacks() {
      const saved = session.get('rectangleHistory');
      return Array.isArray(saved?.undo) && Array.isArray(saved?.redo) ? saved : { undo: [], redo: [] };
    }
    function record(changes) {
      const edited = changes.filter(change => !same(change.before, change.after));
      if (edited.length) {
        const history = stacks();
        history.undo.push(edited);
        history.redo.length = 0;
        session.set('rectangleHistory', history);
      }
    }
    function replay(forward, readDose, writeDoses) {
      const history = stacks(), { undo, redo } = history;
      const source = forward ? redo : undo, target = forward ? undo : redo;
      const changes = source.at(-1);
      if (!changes) return [];
      const doses = new Map();
      for (const { filename, id, before, after } of changes) {
        if (!doses.has(filename)) {
          const current = readDose(filename);
          doses.set(filename, { filename, items: new Map(current.items), selected: [...(current.selected || [])] });
        }
        const dose = doses.get(filename);
        if (!same(dose.items.get(id), forward ? before : after)) {
          throw new Error('The rectangle has changed since this edit in ' + filename + '.');
        }
        const restored = forward ? after : before;
        if (restored) {
          dose.items.set(id, restored);
          if (!dose.selected.includes(id)) dose.selected.push(id);
        } else {
          dose.items.delete(id);
          dose.selected = dose.selected.filter(selectedId => selectedId !== id);
        }
      }
      // A failed batch leaves both stacks in place so the operation can be retried.
      writeDoses([...doses.values()]);
      target.push(source.pop());
      session.set('rectangleHistory', history);
      return [...doses.keys()];
    }
    return { record, replay };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = createRectangleHistory;
  else window.createRectangleHistory = createRectangleHistory;
})();

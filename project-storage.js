/* Preserve legacy localStorage records and store new edits in IndexedDB. */
'use strict';
(() => {
  const values = new Map(), pending = new Set();
  let database, failed = null;
  function warn(error) {
    failed = error || new Error('IndexedDB write failed');
    console.error('Project storage error:', failed);
    const node = document.getElementById('rectangle-save-status');
    if (node) { node.textContent = 'Save failed: export your work before closing this page.'; node.classList.add('save-error'); node.title = String(failed); }
    window.dispatchEvent(new Event('om13-storage-status'));
  }
  const ready = new Promise((resolve, reject) => {
    const request = indexedDB.open('OM13_imagefree_ProjectStorage', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('records');
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Project storage is blocked by another window.'));
    request.onsuccess = () => {
      database = request.result;
      database.onversionchange = () => { database.close(); warn(new Error('Project storage closed for an upgrade.')); };
      const tx = database.transaction('records', 'readonly');
      const cursor = tx.objectStore('records').openCursor();
      cursor.onsuccess = () => { const c = cursor.result; if (c) { values.set(c.key, c.value); c.continue(); } };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error || new Error('Project storage read aborted.'));
    };
  });
  ready.catch(warn);
  function persist(key, value) {
    if (failed) throw failed;
    if (!database) throw new Error('Project storage is still loading.');
    const tx = database.transaction('records', 'readwrite');
    tx.objectStore('records').put(value, key); // null tombstones hide older localStorage values
    let complete;
    const done = new Promise((resolve, reject) => { complete = {resolve, reject}; });
    pending.add(done);
    queueMicrotask(() => window.dispatchEvent(new Event('om13-storage-status')));
    tx.oncomplete = () => { pending.delete(done); complete.resolve(); window.dispatchEvent(new Event('om13-storage-status')); };
    tx.onabort = () => { pending.delete(done); const error = tx.error || new Error('Project storage write aborted.'); warn(error); complete.reject(error); };
    done.catch(() => {}); // flush() observes failures; keep an unsaved in-memory copy for export
    values.set(key, value);
  }
  window.OM13Storage = {
    ready,
    getItem(key) { return values.has(key) ? values.get(key) : window.localStorage.getItem(key); },
    setItem(key, value) { persist(key, String(value)); },
    removeItem(key) { persist(key, null); },
    async flush() { while (pending.size) await Promise.all([...pending]); if (failed) throw failed; },
    entries(prefix) {
      const found=new Map();try{for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key?.startsWith(prefix))found.set(key,localStorage.getItem(key));}}catch(_){}
      for(const [key,value] of values)if(key.startsWith(prefix)){if(value===null)found.delete(key);else found.set(key,value);}
      return [...found].map(([key,value])=>[key.slice(prefix.length),value]);
    },
    async writeScope(prefix,records) {
      await this.flush();const tx=database.transaction('records','readwrite'),store=tx.objectStore('records');
      for(const [suffix,value] of records)store.put(value,prefix+suffix);
      await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||new Error('Could not restore viewer settings.'));tx.onerror=()=>{};});
      for(const [suffix,value] of records)values.set(prefix+suffix,value);
    },
    get pending() { return pending.size; },
    get error() { return failed; }
  };
  window.addEventListener('beforeunload', event => {
    if (pending.size || failed) { event.preventDefault(); event.returnValue = ''; }
  });
})();

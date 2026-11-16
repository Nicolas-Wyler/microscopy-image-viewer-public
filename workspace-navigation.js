/* Keep the standalone viewer's own session when navigating between screens. */
'use strict';
(() => {
  const key='om13-standalone-viewer-hash';
  try {
    const link=document.getElementById('open-image-viewer');
    if(link){const saved=sessionStorage.getItem(key);if(/^#work=[0-9a-f-]{36}$/i.test(saved||''))link.hash=saved;}
    else if(document.getElementById('project-csv')?.dataset.project==='generic-standalone-cleanup' && /^#work=[0-9a-f-]{36}$/i.test(location.hash))sessionStorage.setItem(key,location.hash);
  } catch (_) { /* Navigation still works if session storage is unavailable. */ }
})();

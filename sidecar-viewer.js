/* Show the selected image's exact Leica XML without fetching file:// URLs. */
'use strict';
window.createSidecarViewer = function (getEntry) {
  const button=document.getElementById('open-sidecar');
  const dialog=document.getElementById('sidecar-dialog');
  const title=document.getElementById('sidecar-title');
  const content=document.getElementById('sidecar-content');
  let request=0;
  button.addEventListener('click',async()=>{
    const entry=getEntry();
    if (!entry?.sidecarFile && (!entry?.sidecarSrc || !entry.sidecarSha256)) return;
    const current=++request, key=entry.sidecarSha256;
    title.textContent=(entry.sourceFilename || entry.filename)+' · '+entry.sidecarFilename;
    content.textContent='Loading sidecar…';
    dialog.showModal();
    if(entry.sidecarFile){try{const raw=await entry.sidecarFile.text();if(current===request&&dialog.open)content.textContent=raw;}catch(error){if(current===request&&dialog.open)content.textContent='Could not read this sidecar.';}return;}
    const show=()=>{
      if (current !== request || !dialog.open) return;
      const raw=window.OM10SidecarContents?.[key];
      content.textContent=typeof raw === 'string' ? raw : 'Could not load this sidecar.';
    };
    if (typeof window.OM10SidecarContents?.[key] === 'string') { show(); return; }
    const script=document.createElement('script');
    script.src=entry.sidecarSrc;
    script.onload=()=>{script.remove();show();};
    script.onerror=()=>{script.remove();show();};
    document.head.append(script);
  });
  document.getElementById('sidecar-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
  return { update(entry) { button.disabled=!entry?.sidecarFile && (!entry?.sidecarSrc || !entry?.sidecarSha256); } };
};

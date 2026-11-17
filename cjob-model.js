/* CJOB coordinates are in µm; mask pitch and wavelength are in nm. */
'use strict';
((root,factory)=>{const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CjobModel=api;})(globalThis,()=>{
  function quantity(text,kind){
    const match=String(text).trim().match(/^([+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(nm|[µμu]m|mm)?$/i);
    if(!match)return null;
    const value=Number(match[1]);if(!Number.isFinite(value)||value<=0)return null;
    const unit=(match[2]|| (kind==='wavelength'?'nm':'um')).toLowerCase();
    const nm=unit==='nm'?value:unit==='mm'?value*1e6:value*1000;
    return kind==='wavelength'?nm:nm/1000;
  }
  // Mirror only the predicted wafer pattern, leaving the mask design unchanged.
  function predictedGrating(grating){return {...grating,x:-grating.x};}
  function displacement(wavelengthNm,gapUm,pitchNm){
    if(!Number.isFinite(wavelengthNm)||!Number.isFinite(gapUm)||!Number.isFinite(pitchNm)||wavelengthNm<=0||gapUm<=0||pitchNm<=0||wavelengthNm>=pitchNm)return null;
    return gapUm*Math.tan(Math.asin(wavelengthNm/pitchNm));
  }
  function expandPlacements(centres,repetitions){
    if(centres.length>10000)throw new Error('The CJOB repetition count is unsupported.');
    let offsets=centres.map(([x,y])=>({x,y,indices:[]}));
    for(const {count,vector,space} of repetitions){
      if(!Number.isInteger(count)||count<1||count>1000||offsets.length*count>10000)throw new Error('The CJOB repetition count is unsupported.');
      const pitch=[vector[0]+space[0],vector[1]+space[1]];
      offsets=offsets.flatMap(({x,y,indices})=>Array.from({length:count},(_,i)=>({x:x+(i-(count-1)/2)*pitch[0],y:y+(i-(count-1)/2)*pitch[1],indices:[...indices,i+1]})));
    }
    return offsets;
  }
  function parse(xml){
    const doc=new DOMParser().parseFromString(xml,'application/xml');
    if(doc.querySelector('parsererror')||doc.documentElement?.localName!=='cjob')throw new Error('This file is not a valid CJOB XML file.');
    const exposures=[...doc.getElementsByTagName('exposure')].filter(x=>x.getAttribute('enabled')!=='false');
    const hasGratings=e=>[...e.getElementsByTagName('pattern')].some(p=>/(?:^|_)p\d+(?:\.\d+)?nm(?:_|\.)/i.test(p.getAttribute('name')||''));
    const exposure=exposures.find(x=>/^GR$/i.test(x.getAttribute('name')||'')) || exposures.find(x=>/(?:^|_)GR$/i.test(x.getAttribute('name')||'')&&hasGratings(x)) || exposures.find(hasGratings) || exposures.find(x=>x.getElementsByTagName('pattern').length && !/marker|membrane|photon|(?:^|_)PS(?:_|$)/i.test(x.getAttribute('name')||''));
    if(!exposure)throw new Error('No enabled pattern exposure was found in this CJOB.');
    const children=(node,name)=>[...node.children].filter(x=>x.localName===name);
    function point(s){const parts=String(s||'').split(',').map(Number);if(parts.length!==2||parts.some(x=>!Number.isFinite(x)))throw new Error('The CJOB contains an invalid coordinate.');return parts;}
    function placementsDetailed(node){
      const allPositions=children(node,'position'),pos=allPositions.filter(position=>position.getAttribute('enabled')!=='false');
      const centres=allPositions.length ? pos.map(p=>{rejectUnknownTransforms(p);return point(p.getAttribute('coord'));}) : [[0,0]];
      const repetitions=children(node,'repetition').filter(rep=>rep.getAttribute('enabled')!=='false').map(rep=>{rejectUnknownTransforms(rep);return {count:Number(rep.getAttribute('count')),vector:point(rep.getAttribute('vector')),space:rep.hasAttribute('space')?point(rep.getAttribute('space')):[0,0]};});
      return expandPlacements(centres,repetitions);
    }
    const placements=node=>placementsDetailed(node).map(p=>[p.x,p.y]);
    const transform=/^(rotation|rotate|angle|mirror|flip|scale|transform|transformation)$/i;
    function rejectUnknownTransforms(node){
      if([...node.attributes].some(attr=>transform.test(attr.name))||[...node.children].some(child=>child.getAttribute('enabled')!=='false'&&transform.test(child.localName)))throw new Error('This CJOB uses a transform that is not supported yet.');
    }
    const sadp=[...xml.matchAll(/<!--([\s\S]*?)-->/g)].some(comment=>/SADP/i.test(comment[1])&&/p\s*\/\s*2/i.test(comment[1]));
    // The design often keeps pattern dimensions in a CJOB comment; do not guess
    // sizes for jobs whose separate GPF geometry is not described there.
    const dimensions=new Map();let commonDimensions=null;
    for(const comment of xml.matchAll(/<!--([\s\S]*?)-->/g)) {
      const match=comment[1].match(/gratings\s+(\d+(?:\.\d+)?)\s*(?:um|µm)\s+high;\s*width in x\s+([^;]+?)\s*(?:um|µm)\b/i);
      if(match)for(const pair of match[2].matchAll(/p(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/gi))dimensions.set(Number(pair[1]),{width:Number(pair[2]),height:Number(match[1])});
      const common=comment[1].match(/\bGPFs?\s*:[\s\S]*?\b(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:um|µm)\b/i);
      if(common)commonDimensions={width:Number(common[1]),height:Number(common[2])};
    }
    const windows=[],warnings=new Set();let total=0;
    if(!/^GR$/i.test(exposure.getAttribute('name')||''))warnings.add(`Showing exposure ${exposure.getAttribute('name')||'unnamed'}.`);
    function matchesRange(element,indices){
      const range=element.getAttribute('range')||'';if(!/^\d+,\d+$/.test(range))throw new Error('This CJOB uses a plugin range that is not supported yet.');
      const [a,b]=range.split(',').map(Number);return a===(indices[0]||1)&&b===(indices[1]||1);
    }
    function visitChildren(node,x,y,window,indices,doseOffset,doseKnown){
      const dropped=children(node,'dropout').some(entry=>matchesRange(entry,indices));
      if(!dropped)for(const child of [...node.children])if(child.localName==='layout'||child.localName==='pattern')walk(child,x,y,window,doseOffset,doseKnown);
      for(const plugin of children(node,'plugin'))if(matchesRange(plugin,indices)){rejectUnknownTransforms(plugin);for(const child of [...plugin.children])if(child.localName==='layout'||child.localName==='pattern')walk(child,x,y,window,doseOffset,doseKnown);}
    }
    function walk(node,x,y,window,doseOffset=0,doseKnown=true){
      if(node.getAttribute('enabled')==='false')return;
      rejectUnknownTransforms(node);
      for(const placed of placementsDetailed(node)){
        const nx=x+placed.x,ny=y+placed.y;let offset=doseOffset,known=doseKnown;
        for(const update of children(node,'doseupdate').filter(x=>x.getAttribute('enabled')!=='false')){
          const reps=children(node,'repetition').filter(x=>x.getAttribute('enabled')!=='false'),varying=reps.map((r,i)=>Number(r.getAttribute('count'))>1?i:-1).filter(i=>i>=0),step=Number(update.getAttribute('value'));
          if(update.getAttribute('oper')==='+'&&update.getAttribute('upon')==='scanorder'&&varying.length===1&&Number.isFinite(step))offset+=(placed.indices[varying[0]]-1)*step;
          else {known=false;warnings.add('Some electron-dose updates have an unsupported scan order; their doses are left blank.');}
        }
        if(node.localName==='pattern'){
          const name=node.getAttribute('name')||'Unnamed pattern',match=name.match(/(?:^|_)p(\d+(?:\.\d+)?)nm(?:_|\.)/i);
          if(!window)return;
          const pitch=match?Number(match[1]):null,vertical=/_Vertical(?:_|\.)/i.test(name),horizontal=/_Horizontal(?:_|\.)/i.test(name);
          const pitchFactor=1;
          const effective=pitch && pitchFactor!==null?pitch*pitchFactor:null;
          const size=dimensions.get(pitch)||commonDimensions||null;
          const beams=children(node,'beam').filter(beam=>beam.getAttribute('enabled')!=='false');
          const rawDose=beams.length===1?beams[0].getAttribute('dose'):null;
          const dose=known && rawDose!==null && rawDose.trim()!=='' && Number.isFinite(Number(rawDose)) && Number(rawDose)>=0?Number(rawDose)+offset:null;
          window.gratings.push({x:nx-window.x,y:ny-window.y,name,pitch,pitchFactor,effectivePitch:effective,orientation:vertical?'vertical':horizontal?'horizontal':null,width:size?.width ?? null,height:size?.height ?? null,dose});
          if(!size)warnings.add('Grating dimensions were not found in the CJOB; those outlines and spot footprints are omitted.');
          if(!pitch)warnings.add('Some pattern names do not specify a pitch; their diffraction spots are omitted.');
          if(!vertical&&!horizontal)warnings.add('Some pattern names do not specify a grating orientation; their diffraction spots are omitted.');
          if(++total>10000)throw new Error('The CJOB contains too many grating instances.');
        }else visitChildren(node,nx,ny,window,placed.indices,offset,known);
      }
    }
    const roots=children(exposure,'layout'),exposurePositions=placements(exposure);
    for(let ancestor=exposure;ancestor;ancestor=ancestor.parentElement)rejectUnknownTransforms(ancestor);
    for(const [ex,ey] of exposurePositions) for(const layout of roots){
      if(layout.getAttribute('enabled')==='false')continue;
      const poses=placementsDetailed(layout);
      for(const placed of poses){
        const window={name:layout.getAttribute('name')||'Window',x:ex+placed.x,y:ey+placed.y,gratings:[]};
        if(poses.length>1||exposurePositions.length>1)window.name+=` (${window.x}, ${window.y} µm)`;
        rejectUnknownTransforms(layout);
        visitChildren(layout,window.x,window.y,window,placed.indices,0,true);
        if(window.gratings.length)windows.push(window);
      }
    }
    const direct=children(exposure,'pattern');if(direct.length)for(const [ex,ey] of exposurePositions){const window={name:exposure.getAttribute('name')||'Exposure',x:ex,y:ey,gratings:[]};for(const pattern of direct)walk(pattern,ex,ey,window);if(window.gratings.length)windows.push(window);}
    if(!windows.length)throw new Error('No pattern instances were found in this exposure.');
    return {windows,warnings:[...warnings],sadpDocumented:sadp};
  }
  return {quantity,displacement,predictedGrating,expandPlacements,parse};
});

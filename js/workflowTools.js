import { emitInteractionMotion } from './interactionMotion.js';

const mounts = new WeakMap();
const features = [
  ['range','Range editing','./rangeEditor.js','initializeRangeEditor'],
  ['timeline','Arrangement timeline','./arrangementTimeline.js','initializeArrangementTimeline'],
  ['practice','Practice and calibration','./practiceTransport.js','initializePracticeTools'],
  ['performance','Performance view','./performanceView.js','initializePerformanceView'],
];
/** Optional progressive tools: one unavailable module must not disable transport. */
export async function initializeWorkflowTools(root, options = {}, loader = path => import(path)) {
  if (!root?.append) return null;
  if (mounts.has(root)) return mounts.get(root);
  const doc=root.ownerDocument,handles=[],sections=[];
  let disposed=false;
  const controller={destroy(){if(disposed)return;disposed=true;for(const h of handles)h?.destroy?.();for(const s of sections)s.remove();mounts.delete(root);}};
  const promise=(async()=>{
    const status=doc.createElement('p');status.id='workflow-tools-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.textContent='Preparing editing and practice tools…';root.append(status);sections.push(status);
    const failures=[];
    for(const [id,label,url,exportName] of features){
      if(disposed||root.isConnected===false)break;
      const section=doc.createElement('div');section.id=`rehearsal-${id}-root`;section.className='rehearsal-feature workflow-feature';root.append(section);sections.push(section);
      try{
        const mod=await loader(url);
        if(disposed)break;
        if(typeof mod[exportName]!=='function')throw new TypeError('Feature entry point missing');
        const handle=await mod[exportName](section,{...options,launcher:id==='performance'?doc.getElementById('performance-view-btn'):undefined});
        if(disposed){handle?.destroy?.();break;}handles.push(handle);
      }catch{failures.push(label);section.textContent=`${label} is unavailable. Reload to retry; other controls remain usable.`;console.warn(`Workflow feature unavailable: ${id}`);}
    }
    if(!disposed){
      status.textContent=failures.length?`Unavailable: ${failures.join(', ')}.`:'Editing previews never change music until applied. Timing correction and library backups stay on this device.';
      if(root.isConnected && status.isConnected)emitInteractionMotion(status,failures.length?'refuse':'ready');
    }
    return controller;
  })();
  mounts.set(root,promise);
  return promise;
}

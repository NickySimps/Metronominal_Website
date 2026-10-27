import AppState from './appState.js';
import { canEditPractice, getPracticeState, setPracticeConfig } from './practiceTransport.js';
const ids={enabled:'st-enable-toggle',startBpm:'st-start-bpm',bpmStep:'st-bpm-step',stepBars:'st-step-bars',targetBpm:'st-max-bpm',onMaxAction:'st-max-action',mode:'st-mode',warmupBars:'st-warmup-bars',rampBars:'st-ramp-bars',targetBars:'st-target-bars',recoveryBars:'st-recovery-bars',audibleBars:'st-audible-bars',silentBars:'st-silent-bars'};
let initialized=false;
const SpeedTrainerController={
  init(){
    if(initialized)return;initialized=true;
    const modal=document.getElementById('speed-trainer-modal'),btn=document.getElementById('speed-trainer-btn');
    if(modal){
      const body=modal.querySelector('.modal-content')||modal;
      const extension=document.createElement('div');extension.className='practice-grid';
      extension.innerHTML='<label>Mode<select id="st-mode"><option value="step">Stepped trainer</option><option value="ramp">Warmup → smooth ramp → target → recovery</option></select></label>'+[['warmup','Warmup',0],['ramp','Ramp',1],['target','Target hold',1],['recovery','Recovery ramp',1],['audible','Audible',1],['silent','Silent',0]].map(([id,label,min])=>`<label>${label} bars<input type="number" id="st-${id}-bars" min="${min}" max="128" step="1"></label>`).join('')+'<p>Practice bars use the first bar’s beat count at Play. Ramp BPM follows scheduled musical position; recovery ends at the starting BPM. Configure while stopped. Gaps skip shared clicks only; auditions and transport continue.</p>';
      body.append(extension);
      btn?.addEventListener('click',()=>{SpeedTrainerController.syncUIFromState();modal.style.display='block';});
      modal.querySelector('.close-button')?.addEventListener('click',()=>{modal.style.display='none';});
      modal.addEventListener('click',e=>{if(e.target===modal)modal.style.display='none';});
    }
    for(const id of Object.values(ids))document.getElementById(id)?.addEventListener('change',()=>{
      if(!canEditPractice()||AppState.isPlaying()){SpeedTrainerController.syncUIFromState();return;}
      const config=AppState.getPracticeConfig();
      for(const [key,id] of Object.entries(ids)){const el=document.getElementById(id);if(el)config[key]=key==='enabled'?el.checked:['mode','onMaxAction'].includes(key)?el.value:Number(el.value);}
      try{setPracticeConfig(config);}catch(e){const status=document.getElementById('st-status-text');if(status)status.textContent=e.message;return;}
      SpeedTrainerController.syncUIFromState();
    });
    for(const name of ['practiceconfigchange','playbackstatechange','syncrolechange','roomauthoritychange','songpositionchange'])document.addEventListener(name,SpeedTrainerController.syncUIFromState);
    SpeedTrainerController.syncUIFromState();
  },
  onBarCompleted(){SpeedTrainerController.updateStatus();},
  syncUIFromState(){const c=AppState.getPracticeConfig();for(const [key,id] of Object.entries(ids)){const el=document.getElementById(id);if(!el)continue;if(key==='enabled')el.checked=c[key];else el.value=c[key];el.disabled=!canEditPractice()||AppState.isPlaying();}SpeedTrainerController.updateStatus();},
  updateStatus(){const s=getPracticeState(),status=document.getElementById('st-status-text');document.getElementById('speed-trainer-btn')?.classList.toggle('active',s.config.enabled);if(status)status.textContent=!canEditPractice()?'Host-controlled practice. '+(s.config.enabled?s.phase:'Inactive'):s.config.enabled?`${s.phase}: ${s.config.startBpm} → ${s.config.targetBpm} BPM. ${s.config.audibleBars} audible / ${s.config.silentBars} silent bars.`:'Speed Trainer is inactive.';},
  getState(){const c=AppState.getPracticeConfig();return{...c,maxBpm:c.targetBpm,completedBars:Math.floor(getPracticeState().position/getPracticeState().beatsPerBar)};}
};
export default SpeedTrainerController;

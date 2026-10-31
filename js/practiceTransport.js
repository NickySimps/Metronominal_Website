import AppState, { validatePracticeConfig } from './appState.js';
import { emitInteractionMotion } from './interactionMotion.js';
import * as Room from './webrtc.js';
import { getSlotDurationSeconds, getTotalSlots } from './beatTiming.js';
export { validatePracticeConfig };
const clone = value => JSON.parse(JSON.stringify(value));
export function canEditPractice() { return !Room.isSynchronizationJoined() || window.isHost === true; }
export function setPracticeConfig(config) {
  if (!canEditPractice()) throw new Error('Only the host can configure practice');
  if (AppState.isPlaying()) throw new Error('Stop playback before changing practice');
  if(config?.enabled && Room.isSynchronizationJoined() && !Room.supportsRoomCapability('practice-v1'))throw new Error('This synchronization server does not support shared practice; update the server first.');
  AppState.setPracticeConfig(config);
  void Room.sendState(AppState.getCurrentStateForPreset(true));
  return getPracticeState();
}
function segments(c, beatsPerBar) {
  const b = beatsPerBar;
  if (c.mode === 'step') {
    const direction = Math.sign(c.targetBpm - c.startBpm), result=[];
    const steps=Math.ceil(Math.abs(c.targetBpm-c.startBpm)/c.bpmStep);
    for(let i=0;i<steps;i++) result.push({length:c.stepBars*b,from:c.startBpm+direction*i*c.bpmStep,to:c.startBpm+direction*i*c.bpmStep});
    return [...result,{length:Infinity,from:c.targetBpm,to:c.targetBpm}];
  }
  return [{length:c.warmupBars*b,from:c.startBpm,to:c.startBpm},{length:c.rampBars*b,from:c.startBpm,to:c.targetBpm},{length:c.targetBars*b,from:c.targetBpm,to:c.targetBpm},{length:c.recoveryBars*b,from:c.targetBpm,to:c.startBpm},{length:Infinity,from:c.startBpm,to:c.startBpm}];
}
function integral(segment, beats) {
  const slope=Number.isFinite(segment.length)&&segment.length>0?(segment.to-segment.from)/segment.length:0;
  return Math.abs(slope)<1e-12 ? 60*beats/segment.from : 60*Math.log((segment.from+slope*beats)/segment.from)/slope;
}
function stepCycleBeats(c, beatsPerBar) {
  return (Math.ceil(Math.abs(c.targetBpm-c.startBpm)/c.bpmStep)+1)*c.stepBars*beatsPerBar;
}
export function practiceSecondsAtBeat(c, beat, beatsPerBar=4) {
  if(c.mode==='step' && c.onMaxAction==='reset') {
    const length=stepCycleBeats(c,beatsPerBar),cycles=Math.floor(Math.max(0,beat)/length),hold={...c,onMaxAction:'hold'};
    return cycles*practiceSecondsAtBeat(hold,length,beatsPerBar)+practiceSecondsAtBeat(hold,Math.max(0,beat)%length,beatsPerBar);
  }
  let seconds=0, remaining=Math.max(0,beat);
  for(const s of segments(c,beatsPerBar)){const n=Math.min(remaining,s.length);seconds+=integral(s,n);remaining-=n;if(remaining<=0)break;}
  return seconds;
}
export function practiceTempoAtBeat(c,beat,beatsPerBar=4) {
  if(c.mode==='step' && c.onMaxAction==='reset')return practiceTempoAtBeat({...c,onMaxAction:'hold'},Math.max(0,beat)%stepCycleBeats(c,beatsPerBar),beatsPerBar);
  let remaining=Math.max(0,beat);
  for(const s of segments(c,beatsPerBar)){if(remaining<s.length || !Number.isFinite(s.length))return s.from+(Number.isFinite(s.length)&&s.length?(s.to-s.from)*remaining/s.length:0);remaining-=s.length;}
  return c.startBpm;
}
let epoch=null, beatsPerBar=4, pending=null, pendingRevision=-1;
const scheduledBeats=[];
export function beginPractice(audioTime, beat=0) {
  observeAudioRoute(AppState.getAudioContext());
  beatsPerBar=AppState.getTracks()[0]?.barSettings[0]?.beats||4;
  epoch=audioTime-practiceSecondsAtBeat(AppState.getPracticeConfig(),beat,beatsPerBar);
  scheduledBeats.length=0;
}
function beatAtSeconds(c,seconds) {
  if(c.mode==='step' && c.onMaxAction==='reset') {
    const length=stepCycleBeats(c,beatsPerBar),hold={...c,onMaxAction:'hold'},duration=practiceSecondsAtBeat(hold,length,beatsPerBar);
    return Math.floor(Math.max(0,seconds)/duration)*length+beatAtSeconds(hold,Math.max(0,seconds)%duration);
  }
  let remaining=Math.max(0,seconds),beat=0;
  for(const s of segments(c,beatsPerBar)) {
    const duration=Number.isFinite(s.length)?integral(s,s.length):Infinity;
    if(remaining<duration){const k=Number.isFinite(s.length)&&s.length?(s.to-s.from)/s.length:0;return beat+(Math.abs(k)<1e-12?remaining*s.from/60:s.from*Math.expm1(remaining*k/60)/k);}
    remaining-=duration;beat+=s.length;
  }
  return beat;
}
export function getPracticeScheduling(audioTime,slotBeats,baseTempo) {
  const c=AppState.getPracticeConfig();
  if(!c.enabled || epoch===null)return{duration:slotBeats*60/baseTempo,audible:true,tempo:baseTempo,position:0};
  const position=beatAtSeconds(c,audioTime-epoch);
  const bar=Math.floor((position+1e-7)/beatsPerBar);
  return {stop:c.mode==='step' && c.onMaxAction==='stop' && position+1e-7>=stepCycleBeats(c,beatsPerBar),position,tempo:practiceTempoAtBeat(c,position,beatsPerBar),duration:practiceSecondsAtBeat(c,position+slotBeats,beatsPerBar)-practiceSecondsAtBeat(c,position,beatsPerBar),audible:bar%(c.audibleBars+c.silentBars)<c.audibleBars};
}
export function getPracticeGateEvents(audioTime, endTime) {
  const c=AppState.getPracticeConfig();
  if(!c.enabled || epoch===null || !c.silentBars)return [{audioTime,audible:true}];
  const position=beatAtSeconds(c,audioTime-epoch);
  const bar=Math.floor((position+1e-7)/beatsPerBar),cycle=c.audibleBars+c.silentBars;
  const events=[{audioTime,audible:bar%cycle<c.audibleBars}];
  for(let next=bar+1;next<=bar+512;next++) {
    const time=epoch+practiceSecondsAtBeat(c,next*beatsPerBar,beatsPerBar);
    if(time>endTime+1e-7)break;
    const audible=next%cycle<c.audibleBars;
    if(audible!==events.at(-1).audible)events.push({audioTime:time,audible});
  }
  return events;
}
export function noteScheduledBeat(audioTime,mainBeat) {
  if(mainBeat){scheduledBeats.push(audioTime);if(scheduledBeats.length>128)scheduledBeats.shift();}
}
export function getPracticeState() {
  const c=AppState.getPracticeConfig(),ctx=AppState.getAudioContext();
  const position=epoch===null?0:beatAtSeconds(c,(ctx?.currentTime||0)-epoch);
  const totalBars=c.warmupBars+c.rampBars+c.targetBars+c.recoveryBars;
  return {config:c,playing:AppState.isPlaying(),position,beatsPerBar,phase:!c.enabled?'inactive':c.mode==='step'?'step':position< c.warmupBars*beatsPerBar?'warmup':position<(c.warmupBars+c.rampBars)*beatsPerBar?'ramp':position<(c.warmupBars+c.rampBars+c.targetBars)*beatsPerBar?'target':position<totalBars*beatsPerBar?'recovery':'complete',pending:getPendingSongChange()};
}
export function validateSongDraft(song) {
  if(!song || typeof song!=='object' || Array.isArray(song) || Object.keys(song).some(k=>!['version','enabled','name','sections'].includes(k)) || song.version!==2 || typeof song.enabled!=='boolean' || typeof song.name!=='string' || song.name.length>80 || !Array.isArray(song.sections) || !song.sections.length || song.sections.length>32)return false;
  let previous=-1;
  const max=AppState.getTracks()[0]?.barSettings.length||1;
  const safe=song.sections.every(s=>{if(!s||Object.keys(s).some(k=>!['name','startBar','tempo','repeats','tracks'].includes(k))||typeof s.name!=='string'||!s.name.length||s.name.length>48||!Number.isInteger(s.startBar)||s.startBar<=previous||s.startBar>=max||!Number.isInteger(s.tempo)||s.tempo<20||s.tempo>300||!Number.isInteger(s.repeats)||s.repeats<1||s.repeats>16)return false;previous=s.startBar;return true;});
  if(!safe||song.sections[0].startBar!==0)return false;
  const state=AppState.getMusicalSnapshot();return AppState.validateNetworkState({...state,song});
}
function nextBoundary(minimumAudioTime) {
  const track=AppState.getTracks()[0];if(!track?.barSettings.length)throw new Error('No musical boundary available');
  let bar=track.currentBar,beat=track.currentBeat,time=track.nextBeatTime,repeat=track.songRepeatIteration||0;
  for(let i=0;i<65536;i++) {
    if(beat===0 && time>=minimumAudioTime)return{audioTime:time,bar};
    const data=track.barSettings[bar];time+=getPracticeScheduling(time,getSlotDurationSeconds(data,beat,1),AppState.getPlaybackTempo(bar)).duration;
    if(++beat>=getTotalSlots(data)){beat=0;const next=AppState.getNextSongPosition(bar,repeat,track.barSettings.length);bar=next.bar;repeat=next.repeatIteration;}
  }
  throw new Error('Could not find a bounded musical boundary');
}
export function queueSongChange(song,{sectionIndex}={}) {
  if(!canEditPractice())throw new Error('Only the host can queue a song change');
  if(!validateSongDraft(song))throw new RangeError('Invalid complete song draft');
  if(sectionIndex!==undefined && (!Number.isInteger(sectionIndex)||!song.sections[sectionIndex]))throw new RangeError('Invalid section index');
  if(!AppState.isPlaying()){AppState.setSong(clone(song));if(sectionIndex!==undefined)AppState.applySongSectionForBar(song.sections[sectionIndex].startBar,sectionIndex);void Room.sendState(AppState.getCurrentStateForPreset(true));return{applied:true};}
  const ctx=AppState.getAudioContext();
  const boundary=nextBoundary(Math.max(ctx.currentTime+0.75,...AppState.getTracks().map(t=>t.nextBeatTime+0.001)));
  const proposal={version:1,song:clone(song),sectionIndex:sectionIndex??null,startBar:sectionIndex===undefined?boundary.bar:song.sections[sectionIndex].startBar,effectiveAt:Date.now()+Room.getTimeOffset()+(boundary.audioTime-ctx.currentTime)*1000};
  if(Room.isSynchronizationJoined()) {
    if(!Room.sendSongChangeCommand(proposal))throw new Error('Song-boundary synchronization is unavailable');
    return{...proposal,status:'awaiting-authority'};
  }
  receiveSongChange({...proposal,revision:pendingRevision+1});return getPendingSongChange();
}
export function receiveSongChange(message) {
  if(!Number.isInteger(message.revision)||message.revision<=pendingRevision)return false;
  pendingRevision=message.revision;
  if(message.cancelled){clearPendingSongChange();return true;}
  if(message.version!==1||!validateSongDraft(message.song)||!Number.isFinite(message.effectiveAt)||!Number.isInteger(message.startBar)||message.startBar<0||message.startBar>63)return false;
  const ctx=AppState.getAudioContext();
  pending={...clone(message),audioTime:ctx?ctx.currentTime+(message.effectiveAt-Room.getTimeOffset()-Date.now())/1000:null};
  document.dispatchEvent(new CustomEvent('pendingSongChange'));return true;
}
export function applyPendingSongAtBoundary(nextAudioTime) {
  if(!pending)return false;
  const ctx=AppState.getAudioContext();
  if(pending.audioTime===null)pending.audioTime=ctx.currentTime+(pending.effectiveAt-Room.getTimeOffset()-Date.now())/1000;
  // Every track is scheduled chronologically, so no old-arrangement slot may cross this seam.
  // Clock samples/output clocks may disagree by a few milliseconds. Claim the
  // matching slot before it is submitted, never one entire beat afterwards.
  if(nextAudioTime+0.025<pending.audioTime)return false;
  const change=pending;pending=null;
  AppState.setSong(change.song);
  const index=change.sectionIndex===null?AppState.getSongSectionForBar(change.startBar).index:change.sectionIndex;
  AppState.applySongSectionForBar(change.startBar,index);
  for(const track of AppState.getTracks()){track.currentBar=change.startBar%track.barSettings.length;track.currentBeat=0;track.songRepeatIteration=0;track.nextBeatTime=change.audioTime;}
  document.dispatchEvent(new CustomEvent('songchangecommitted',{detail:{revision:change.revision,effectiveAt:change.effectiveAt,audioTime:change.audioTime,startBar:change.startBar}}));
  document.dispatchEvent(new CustomEvent('pendingSongChange'));return true;
}
export function getPendingSongChange(){return pending?clone(pending):null;}
function clearPendingSongChange(){pending=null;document.dispatchEvent(new CustomEvent('pendingSongChange'));}
export function cancelPendingSongChange(){
  if(!canEditPractice())return false;
  if(Room.isSynchronizationJoined())return Room.sendSongChangeCommand(null);
  clearPendingSongChange();return true;
}
let outputOffsetMs=0, storageError=null, recheckReason='Check alignment after changing output devices';
const observedContexts=new WeakSet();
function alignmentInvalidated(reason) {
  recheckReason=reason;cancelCalibration();
  document.dispatchEvent(new CustomEvent('localtimingchange'));
}
function observeAudioRoute(ctx) {
  if(!ctx || observedContexts.has(ctx))return;
  observedContexts.add(ctx);
  ctx.addEventListener('sinkchange',()=>alignmentInvalidated('Output route changed — recheck alignment'));
}
navigator.mediaDevices?.addEventListener?.('devicechange',()=>alignmentInvalidated('Output devices changed — recheck alignment'));
try {const n=Number(localStorage.getItem('metronominal.outputCorrectionMs'));if(Number.isFinite(n)&&n>=-200&&n<=500)outputOffsetMs=n;}catch(error){storageError=error.message;}
export function setLocalOutputOffsetMs(ms){
  if(typeof ms!=='number'||!Number.isFinite(ms)||ms < -200 || ms > 500)throw new RangeError('Output correction must be -200 to 500 ms');
  if(AppState.isPlaying())throw new Error('Stop playback before changing local output correction');
  outputOffsetMs=ms;AppState.setLatencyOffset(ms);
  try{localStorage.setItem('metronominal.outputCorrectionMs',String(ms));storageError=null;}catch(error){storageError=error.message;}
  return getLocalTimingState();
}
export function getLocalOutputOffsetSeconds(){return AppState.getLatencyOffset()/1000;}
export function getCorrectionSchedulingLead(){return Math.max(0,-getLocalOutputOffsetSeconds());}
let schedulingWarning=null;
export function reportMissedOutputCorrection(){schedulingWarning='Scheduling headroom was exhausted; correction could not be honored for a late click.';}
export function getLocalTimingState(){const ctx=AppState.getAudioContext();return{outputOffsetMs:AppState.getLatencyOffset(),schedulingWarning,storageError,recheckReason,outputLatencyMs:ctx&&Number.isFinite(ctx.outputLatency)?ctx.outputLatency*1000:null,baseLatencyMs:ctx&&Number.isFinite(ctx.baseLatency)?ctx.baseLatency*1000:null,measurement:'Browser estimates only; no acoustic measurement. Tap timing includes input and output latency.',tap:getTapTimingState()};}
storageError=AppState.setLatencyOffset(outputOffsetMs)||storageError;
let taps=[];
export function recordPracticeTap(audioTime=AppState.getAudioContext()?.currentTime){
  if(!Number.isFinite(audioTime)||!scheduledBeats.length)return null;
  const nearest=scheduledBeats.reduce((a,b)=>Math.abs(b-audioTime)<Math.abs(a-audioTime)?b:a);
  const errorMs=(audioTime-nearest)*1000;
  if(Math.abs(errorMs)>1000)return null;
  taps.push(errorMs);if(taps.length>32)taps.shift();return getTapTimingState();
}
export function getTapTimingState(){if(!taps.length)return{count:0,meanMs:null,spreadMs:null,tendency:'No taps'};const mean=taps.reduce((a,b)=>a+b,0)/taps.length;return{count:taps.length,meanMs:mean,spreadMs:Math.sqrt(taps.reduce((a,b)=>a+(b-mean)**2,0)/taps.length),tendency:mean < -10?'rush':mean>10?'drag':'centered'};}
export function initializePracticeTools(root,{refreshUI=()=>{}}={}){
  if(!root||root.dataset.practiceInitialized)return;
  root.dataset.practiceInitialized='true';
  observeAudioRoute(AppState.getAudioContext());
  root.innerHTML='<p>Advanced practice is configured in the existing Speed Trainer.</p><label>Local output correction (ms; positive = later)<input data-output-offset type="number" min="-200" max="500" step="1"></label><button type="button" data-calibrate>Click / flash alignment</button><button type="button" data-tap>Tap timing feedback</button><output data-practice-status aria-live="polite"></output>';
  const input=root.querySelector('[data-output-offset]'),status=root.querySelector('output');input.value=outputOffsetMs;
  const render=()=>{const s=getLocalTimingState();status.textContent=`${s.measurement} Output estimate: ${s.outputLatencyMs===null?'unsupported':s.outputLatencyMs.toFixed(1)+' ms'}. ${s.recheckReason}. ${s.storageError?'Storage unavailable; correction is session-only.':''} ${s.tap.count?`${s.tap.tendency}: ${s.tap.meanMs.toFixed(1)} ms; spread ${s.tap.spreadMs.toFixed(1)} ms`:''}`;};
  input.addEventListener('change',()=>{
    const before=getLocalTimingState().outputOffsetMs;
    try{
      const accepted=setLocalOutputOffsetMs(Number(input.value));input.setCustomValidity('');render();
      if(accepted.outputOffsetMs!==before)emitInteractionMotion(input,accepted.storageError?'adjust':'save');
    }catch(e){input.setCustomValidity(e.message);input.reportValidity();emitInteractionMotion(input,'refuse');}
  });
  root.querySelector('[data-tap]').addEventListener('pointerdown',()=>{const accepted=recordPracticeTap();render();emitInteractionMotion(root.querySelector('[data-tap]'),accepted?({rush:'accent',drag:'ghost',centered:'confirm'}[accepted.tendency]||'adjust'):'refuse');});
  root.querySelector('[data-calibrate]').addEventListener('click',async()=>{try{await startCalibration(root);render();}catch(error){status.textContent=error.message;emitInteractionMotion(root.querySelector('[data-calibrate]'),'refuse');}});
  document.addEventListener('localtimingchange',render);
  document.addEventListener('pendingSongChange',()=>{render();refreshUI();});
  document.addEventListener('playbackstatechange',()=>{input.disabled=AppState.isPlaying();root.querySelector('[data-calibrate]').disabled=AppState.isPlaying();render();});
  window.addEventListener('focus',render);render();
}
let calibrationGeneration=0, calibrationFrame=null;
const calibrationSources=new Set();
let calibrationFeedbackRoot=null, calibrationPresentationDone=false;
function acknowledgeCalibrationCompletion(generation){
  if(generation!==calibrationGeneration||!calibrationFeedbackRoot||!calibrationPresentationDone||calibrationSources.size)return;
  const root=calibrationFeedbackRoot;calibrationFeedbackRoot=null;
  emitInteractionMotion(root.querySelector('[data-calibrate]')||root,'confirm');
}
export function cancelCalibration(){
  const feedbackRoot=calibrationFeedbackRoot;calibrationFeedbackRoot=null;
  calibrationGeneration++;if(calibrationFrame!==null)cancelAnimationFrame(calibrationFrame);calibrationFrame=null;
  for(const source of calibrationSources){try{source.stop();}catch{}}calibrationSources.clear();
  document.querySelectorAll('.practice-flash').forEach(root=>root.classList.remove('practice-flash'));
  if(feedbackRoot)emitInteractionMotion(feedbackRoot.querySelector('[data-calibrate]')||feedbackRoot,'cancel');
}
export async function startCalibration(root){
  if(AppState.isPlaying())throw new Error('Stop playback before the click / flash exercise');
  const ctx=AppState.getAudioContext()||AppState.initializeAudioContext();
  if(!ctx)throw new Error('Web Audio is unsupported');
  observeAudioRoute(ctx);
  cancelCalibration();const generation=calibrationGeneration;
  await ctx.resume();if(generation!==calibrationGeneration)return null;
  if(ctx.state!=='running')throw new Error('Audio is not running; activate audio and retry');
  calibrationFeedbackRoot=root;calibrationPresentationDone=false;
  const start=ctx.currentTime+0.5,events=[];
  for(let i=0;i<4;i++){
    const nominal=start+i*0.65,audioTime=nominal+getLocalOutputOffsetSeconds();
    const source=ctx.createOscillator(),gain=ctx.createGain();source.frequency.value=1320;source.connect(gain);gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.0001,audioTime);gain.gain.exponentialRampToValueAtTime(0.15,audioTime+0.002);gain.gain.exponentialRampToValueAtTime(0.0001,audioTime+0.04);
    calibrationSources.add(source);source.onended=()=>{calibrationSources.delete(source);source.disconnect();gain.disconnect();acknowledgeCalibrationCompletion(generation);};source.start(audioTime);source.stop(audioTime+0.045);
    let stamp=null;try{stamp=ctx.getOutputTimestamp?.();}catch{}
    const mapped=stamp&&Number.isFinite(stamp.contextTime)&&Number.isFinite(stamp.performanceTime)&&stamp.performanceTime>0;
    const outputLatency=Number.isFinite(ctx.outputLatency)?ctx.outputLatency:null;
    const estimatedAt=mapped?stamp.performanceTime+(nominal-stamp.contextTime)*1000:performance.now()+(nominal-ctx.currentTime+(outputLatency??0))*1000;
    events.push({audioTime,estimatedAt,presentationEstimate:true,outputEstimateAvailable:!!mapped||outputLatency!==null});
  }
  let index=0,flashUntil=0;
  const frame=now=>{
    if(generation!==calibrationGeneration)return;
    if(index<events.length&&now>=events[index].estimatedAt){const detail={...events[index++],presentedAt:now};flashUntil=now+100;root?.classList.add('practice-flash');document.dispatchEvent(new CustomEvent('calibrationframe',{detail}));}
    if(now>=flashUntil)root?.classList.remove('practice-flash');
    if(index<events.length||now<flashUntil)calibrationFrame=requestAnimationFrame(frame);else{calibrationFrame=null;calibrationPresentationDone=true;acknowledgeCalibrationCompletion(generation);}
  };
  calibrationFrame=requestAnimationFrame(frame);emitInteractionMotion(root?.querySelector('[data-calibrate]')||root,'pending');return{events:clone(events),measurement:'Estimated output mapping and RAF presentation only; no microphone or acoustic measurement.'};
}
for(const name of ['roomauthoritychange','syncrolechange','historyboundary'])document.addEventListener(name,e=>{if(name==='historyboundary' && e.detail?.source==='network')return;clearPendingSongChange();pendingRevision=-1;cancelCalibration();});
document.addEventListener('playbackstatechange',e=>{if(e.detail?.playing===true)cancelCalibration();if(e.detail?.playing===false){epoch=null;scheduledBeats.length=0;clearPendingSongChange();}});

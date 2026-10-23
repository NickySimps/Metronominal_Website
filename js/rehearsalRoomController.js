import { getRehearsalRoomState, getSyncDiagnostics, setRehearsalReadiness, requestRehearsalControl,
  approveRehearsalControl, reconnectSynchronization, resyncRehearsalRoom,
  restoreOwnRehearsalRoom } from './webrtc.js';

const initialized = new WeakMap();
export function initializeRehearsalRoomControls(root) {
  if (!root) return;
  if (initialized.has(root)) return initialized.get(root);
  root.classList.add('rehearsal-room');
  const create = (tag, text, parent = root) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    parent.append(node); return node;
  };
  create('h3','Rehearsal room');
  const status = create('p'); status.setAttribute('role','status');
  const settings = create('div'); settings.className = 'rehearsal-actions';
  const nameLabel = create('label','Local peer label (not personal information)',settings);
  const name = create('input',null,nameLabel); name.maxLength = 40; name.type = 'text';
  name.autocomplete = 'off'; name.value = getRehearsalRoomState().localName;
  const readyLabel = create('label','',settings);
  const ready = create('input',null,readyLabel); ready.type='checkbox';
  readyLabel.append(document.createTextNode('I am ready'));
  const button = (text, fn) => {const b=create('button',text,settings);b.type='button';b.addEventListener('click',fn);return b;};
  const request = button('Request control',()=>requestRehearsalControl());
  const reconnect = button('Reconnect',()=>reconnectSynchronization());
  const resync = button('Resync room',()=>resyncRehearsalRoom());
  const restore = button('Restore my room',()=>restoreOwnRehearsalRoom());
  const report = () => {
    name.setCustomValidity('');
    if (!setRehearsalReadiness(ready.checked,name.value)) {
      if (/[<>\x00-\x1f\x7f]/.test(name.value)) name.setCustomValidity('Use a plain peer label, up to 40 characters.');
    }
  };
  ready.addEventListener('change',report); name.addEventListener('change',report);
  create('p','Readiness is self-reported. Audio and clock describe software only; they do not prove physical audibility.');
  const grid = create('div'); grid.dataset.rehearsalGrid=''; grid.className='rehearsal-grid';
  const requests = create('div'); requests.className='rehearsal-requests';
  const render = () => {
    const s=getRehearsalRoomState();
    status.textContent = s.recoveryMessage || (!s.joined ? `Room ${s.connectionState}. Reconnect or restore your own saved room.`
      : !s.supported ? 'This server does not support rehearsal readiness. No readiness claims are available.'
      : !s.hostConnected ? 'Host disconnected. Playback is stopped; waiting for the rightful host to recover. No participant is promoted.'
      : `${s.isHost ? 'Host' : 'Participant'} · ${s.participants.length} connected`);
    ready.disabled = !s.supported || !s.joined;
    ready.checked = s.explicitReady;
    name.disabled = !s.supported || !s.joined;
    request.disabled = !s.supported || !s.joined || s.isHost || !s.hostConnected || s.requests.includes(s.ownPeerId);
    reconnect.disabled = s.connectionState==='connecting';
    resync.disabled = !s.joined;
    restore.disabled = !s.canRestoreOwnRoom || (s.joined && s.isHost);
    grid.replaceChildren(); requests.replaceChildren();
    if (!s.supported || !s.joined) return;
    const table=create('table',null,grid), head=create('thead',null,table), header=create('tr',null,head);
    for(const title of ['Peer','Ready','Connection','Clock','Audio','RTT']) create('th',title,header).scope='col';
    const body=create('tbody',null,table);
    const diagnostics = getSyncDiagnostics();
    const synchronizedNow = diagnostics.timeSyncReady && Number.isFinite(diagnostics.clockOffset)
      ? Date.now() + diagnostics.clockOffset : null;
    for(const p of s.participants) {
      const row=create('tr',null,body);
      const age = synchronizedNow === null ? NaN : synchronizedNow - p.reportedAt;
      const stale = !p.reportedAt || !Number.isFinite(age) || age < -1000 || age > 10000;
      const values=[`${p.name}${p.peerId===s.ownPeerId?' (you)':''}${p.role==='host'?' · host':''}`,
        p.ready===null?'Unknown (older client)':p.ready?'Ready (self-report)':'Not ready',
        p.connected?'Connected':'Disconnected',stale?'Unknown / stale':p.clockQuality,
        stale?'Unknown / stale':p.audioState,p.rtt===null?'—':`${Math.round(p.rtt)} ms`];
      for(const v of values)create('td',v,row);
    }
    if(s.isHost && s.requests.length) {
      create('h4','Control requests',requests);
      for(const id of s.requests) {
        const p=s.participants.find(p=>p.peerId===id); if(!p)continue;
        const line=create('p',`${p.name} requested control. `,requests);
        const approve=create('button','Approve and hand off',line); approve.type='button';
        approve.disabled=s.playing;
        approve.addEventListener('click',()=>approveRehearsalControl(id));
      }
      if(s.playing)create('p','Stop playback before approving a handoff.',requests);
    }
  };
  document.addEventListener('rehearsalroomchange',render);
  const cleanup=()=>{document.removeEventListener('rehearsalroomchange',render);initialized.delete(root);root.replaceChildren();};
  initialized.set(root,cleanup);render();return cleanup;
}

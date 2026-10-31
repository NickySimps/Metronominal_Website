import { getRehearsalRoomState, getSyncDiagnostics, setRehearsalReadiness, requestRehearsalControl,
  approveRehearsalControl, reconnectSynchronization, resyncRehearsalRoom,
  restoreOwnRehearsalRoom } from './webrtc.js';
import { emitInteractionMotion } from './interactionMotion.js';

function snapshotConfirmedParticipants(participants) {
  const map = new Map();
  if (!Array.isArray(participants)) return map;
  for (const p of participants) {
    if (!p || typeof p.peerId !== 'string') continue;
    map.set(p.peerId, {
      peerId: p.peerId,
      name: typeof p.name === 'string' ? p.name : '',
      ready: p.ready === null ? null : Boolean(p.ready),
      connected: Boolean(p.connected),
      role: typeof p.role === 'string' ? p.role : ''
    });
  }
  return map;
}

function getConfirmedConnectedIds(participantsMap) {
  const set = new Set();
  for (const [peerId, p] of participantsMap) {
    if (p.connected) set.add(peerId);
  }
  return set;
}

function diffConnectedIds(prevSet, nextSet) {
  let added = false;
  let removed = false;
  for (const id of nextSet) {
    if (!prevSet.has(id)) added = true;
  }
  for (const id of prevSet) {
    if (!nextSet.has(id)) removed = true;
  }
  return { added, removed };
}

function hasConfirmedReadinessOrLabelChange(prevMap, nextMap) {
  if (!prevMap) return false;
  for (const [peerId, next] of nextMap) {
    const prev = prevMap.get(peerId);
    if (!prev || !prev.connected || !next.connected) continue;
    if (prev.name !== next.name || prev.ready !== next.ready) return true;
  }
  return false;
}

function getConfirmedConsistentHostId(state, participantsMap) {
  if (!state.supported || !state.joined || !state.hostConnected) return null;
  if (typeof state.hostPeerId !== 'string' || !state.hostPeerId) return null;
  const hostEntry = participantsMap.get(state.hostPeerId);
  if (!hostEntry || !hostEntry.connected || hostEntry.role !== 'host') return null;
  if (typeof state.ownPeerId !== 'string' || !state.ownPeerId) return null;
  const ownEntry = participantsMap.get(state.ownPeerId);
  if (!ownEntry || !ownEntry.connected) return null;
  const expectedIsHost = state.hostPeerId === state.ownPeerId;
  if (Boolean(state.isHost) !== expectedIsHost) return null;
  if ((ownEntry.role === 'host') !== expectedIsHost) return null;
  return state.hostPeerId;
}

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
  const heading = create('h3','Rehearsal room');
  const status = create('p'); status.setAttribute('role','status');
  const emit = (target, kind) =>
    emitInteractionMotion(target, kind) ||
    emitInteractionMotion(status, kind) ||
    emitInteractionMotion(heading, kind);
  const settings = create('div'); settings.className = 'rehearsal-actions';
  const nameLabel = create('label','Local peer label (not personal information)',settings);
  const name = create('input',null,nameLabel); name.maxLength = 40; name.type = 'text';
  name.autocomplete = 'off'; name.value = getRehearsalRoomState().localName;
  const readyLabel = create('label','',settings);
  const ready = create('input',null,readyLabel); ready.type='checkbox';
  readyLabel.append(document.createTextNode('I am ready'));
  let previousParticipants = null;
  let previousConnectedIds = null;
  let confirmedHostPeerId = null;
  let hasInitialBaseline = false;
  let wasJoined = false;
  let pendingJoinAction = null;
  const button = (text, fn) => {const b=create('button',text,settings);b.type='button';b.addEventListener('click',fn);return b;};
  const request = button('Request control', () => {
    emit(request, requestRehearsalControl() ? 'pending' : 'refuse');
  });
  const reconnect = button('Reconnect', () => {
    pendingJoinAction = 'reconnect';
    emit(reconnect, 'pending');
    reconnectSynchronization();
  });
  const resync = button('Resync room', () => {
    emit(resync, resyncRehearsalRoom() ? 'pending' : 'refuse');
  });
  const restore = button('Restore my room', () => {
    pendingJoinAction = 'restore';
    if (!restoreOwnRehearsalRoom()) {
      pendingJoinAction = null;
      emit(restore, 'refuse');
      return;
    }
    emit(restore, 'pending');
  });
  const report = (event) => {
    const anchor = event?.currentTarget instanceof Element ? event.currentTarget : name;
    name.setCustomValidity('');
    if (!setRehearsalReadiness(ready.checked,name.value)) {
      if (/[<>\x00-\x1f\x7f]/.test(name.value)) name.setCustomValidity('Use a plain peer label, up to 40 characters.');
      emit(anchor,'refuse');
      return;
    }
    emit(anchor,'pending');
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
    if (!s.supported || !s.joined) {
      const lostJoined = wasJoined && hasInitialBaseline;
      wasJoined = false;
      previousParticipants = null;
      previousConnectedIds = null;
      confirmedHostPeerId = null;
      if (lostJoined) emit(status,'disconnect');
      return;
    }
    wasJoined = true;
    const nextParticipants = snapshotConfirmedParticipants(s.participants);
    const nextConnectedIds = getConfirmedConnectedIds(nextParticipants);
    const ownEntry = typeof s.ownPeerId === 'string' ? nextParticipants.get(s.ownPeerId) : null;
    const ownConnected = Boolean(ownEntry && ownEntry.connected);
    const restoreReady = pendingJoinAction !== 'restore' || Boolean(
      ownConnected && s.isHost && s.hostConnected && s.hostPeerId === s.ownPeerId && ownEntry.role === 'host'
    );
    const consistentHostId = getConfirmedConsistentHostId(s, nextParticipants);
    let emitConnect = false;
    let emitDisconnect = false;
    let emitHandoff = false;
    let emitReady = false;
    if (previousConnectedIds === null) {
      if (ownConnected && restoreReady) {
        if (hasInitialBaseline || pendingJoinAction !== null) {
          emitConnect = true;
        }
        hasInitialBaseline = true;
        pendingJoinAction = null;
        previousConnectedIds = nextConnectedIds;
        previousParticipants = nextParticipants;
        confirmedHostPeerId = consistentHostId;
      }
    } else if (ownConnected && restoreReady) {
      const presenceDiff = diffConnectedIds(previousConnectedIds, nextConnectedIds);
      emitConnect = presenceDiff.added;
      emitDisconnect = presenceDiff.removed;
      emitReady = hasConfirmedReadinessOrLabelChange(previousParticipants, nextParticipants);
      emitHandoff = Boolean(
        confirmedHostPeerId &&
        consistentHostId &&
        consistentHostId !== confirmedHostPeerId &&
        previousConnectedIds.has(consistentHostId)
      );
      previousConnectedIds = nextConnectedIds;
      previousParticipants = nextParticipants;
      if (!s.hostConnected) {
        confirmedHostPeerId = null;
      } else if (consistentHostId) {
        confirmedHostPeerId = consistentHostId;
      }
    }
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
        approve.addEventListener('click',()=>{
          emit(approve, approveRehearsalControl(id) ? 'pending' : 'refuse');
        });
      }
      if(s.playing)create('p','Stop playback before approving a handoff.',requests);
    }
    if (emitConnect) emit(status,'connect');
    if (emitDisconnect) emit(status,'disconnect');
    if (emitHandoff) emit(status,'handoff');
    if (emitReady) emit(status,'ready');
  };
  document.addEventListener('rehearsalroomchange',render);
  const cleanup=()=>{
    previousParticipants=null;
    previousConnectedIds=null;
    confirmedHostPeerId=null;
    pendingJoinAction=null;
    hasInitialBaseline=false;
    wasJoined=false;
    document.removeEventListener('rehearsalroomchange',render);
    initialized.delete(root);
    root.replaceChildren();
  };
  initialized.set(root,cleanup);render();return cleanup;
}

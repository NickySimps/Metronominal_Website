import Monitoring from './monitoring.js';

function render() {
  const root = document.getElementById('personal-monitoring');
  if (!root) return;
  const { volume, muted, tracks } = Monitoring.getState();
  const percent = `${Math.round(volume * 100)}%`;
  root.querySelector('#monitor-summary').textContent = muted ? 'Muted' : percent;
  const input = root.querySelector('#monitor-volume');
  input.value = String(volume);
  input.setAttribute('aria-valuetext', percent);
  root.querySelector('#monitor-volume-value').textContent = percent;
  const button = root.querySelector('#monitor-mute');
  button.textContent = muted ? 'Unmute my sound' : 'Mute my sound';
  button.setAttribute('aria-pressed', String(muted));
  const rows = root.querySelector('#monitor-tracks');
  const signature = JSON.stringify(tracks.map(track => track.label));
  if (rows.dataset.signature !== signature) {
    rows.querySelectorAll('.monitor-row').forEach(row => row.remove());
    tracks.forEach((track, index) => {
      const row = document.createElement('div');
      row.className = 'monitor-row';
      row.innerHTML = `<label for="monitor-track-${index}"></label>
        <input id="monitor-track-${index}" class="monitor-track-volume" data-monitor-track="${index}" type="range" min="0" max="1" step="0.01">
        <output for="monitor-track-${index}"></output>
        <button type="button" data-monitor-mute="${index}" aria-pressed="false"></button>`;
      row.querySelector('label').textContent = `${track.label} listening level`;
      rows.appendChild(row);
    });
    rows.dataset.signature = signature;
  }
  tracks.forEach((track, index) => {
    const input = root.querySelector(`#monitor-track-${index}`);
    const percent = `${Math.round(track.volume * 100)}%`;
    input.value = String(track.volume);
    input.setAttribute('aria-valuetext', percent);
    input.parentElement.querySelector('output').textContent = percent;
    const button = root.querySelector(`[data-monitor-mute="${index}"]`);
    button.textContent = `${track.muted ? 'Unmute' : 'Mute'} ${track.label} for me`;
    button.setAttribute('aria-pressed', String(track.muted));
  });
}

const MonitoringController = {
  initialize() {
    if (document.getElementById('personal-monitoring')) return;
    const anchor = document.querySelector('.bar-display');
    if (!anchor) return;
    const root = document.createElement('details');
    root.id = 'personal-monitoring';
    root.innerHTML = `
      <summary>My sound <span id="monitor-summary">100%</span></summary>
      <div class="monitor-body">
        <p>Only changes what you hear on this device. The host still controls shared playback and track settings.</p>
        <div class="monitor-row">
          <label for="monitor-volume">Device listening level</label>
          <input id="monitor-volume" type="range" min="0" max="1" step="0.01" value="1">
          <output id="monitor-volume-value" for="monitor-volume">100%</output>
          <button id="monitor-mute" type="button" aria-pressed="false">Mute my sound</button>
        </div>
        <fieldset id="monitor-tracks"><legend>Track listening levels</legend></fieldset>
        <p>Device level also affects count-in and previews. Track levels reset when track names/count change or you leave this room; they are not saved. You cannot bring back a track muted by the host.</p>
        <button id="monitor-reset" type="button">Reset listening mix</button>
      </div>`;
    anchor.before(root);
    root.querySelector('#monitor-volume').addEventListener('input', event => Monitoring.setVolume(event.target.value));
    root.querySelector('#monitor-mute').addEventListener('click', () => Monitoring.setMuted(!Monitoring.getState().muted));
    root.querySelector('#monitor-reset').addEventListener('click', () => Monitoring.reset());
    root.addEventListener('input', event => {
      if (event.target.matches('[data-monitor-track]')) Monitoring.setTrackVolume(Number(event.target.dataset.monitorTrack), event.target.value);
    });
    root.addEventListener('click', event => {
      const button = event.target.closest('[data-monitor-mute]');
      if (!button) return;
      const index = Number(button.dataset.monitorMute);
      Monitoring.setTrackMuted(index, !Monitoring.getState().tracks[index].muted);
    });
    document.addEventListener('monitoringchange', render);
    let room = new URL(location.href).searchParams.get('room');
    document.addEventListener('syncrolechange', () => {
      const nextRoom = new URL(location.href).searchParams.get('room');
      if (room !== nextRoom) {
        room = nextRoom;
        Monitoring.resetTracks();
      }
    });
    render();
  },
};
export default MonitoringController;

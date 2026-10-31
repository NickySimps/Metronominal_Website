'use strict';
const { test, expect } = require('@playwright/test');

async function ready(page) {
  await page.route('https://cdn.jsdelivr.net/npm/three/**', async route => {
    // Keep this audio fixture on one genuine CDN build despite moving latest aliases.
    const response = await route.fetch({url: route.request().url().replace('/npm/three/', '/npm/three@0.187.0/')});
    await route.fulfill({response});
  });
  await page.route('**/script.js', route => route.abort());
  await page.goto('./');
  await page.evaluate(async () => {
    window.routes = [];
    const connect = AudioNode.prototype.connect;
    const disconnect = AudioNode.prototype.disconnect;
    AudioNode.prototype.connect = function(...args) { const result = connect.apply(this,args); routes.push({from:this,to:args[0],active:true}); return result; };
    AudioNode.prototype.disconnect = function(...args) { const result = disconnect.apply(this,args); for (const route of routes) if (route.from === this && (!args.length || args[0] === route.to)) route.active=false; return result; };
    window.a = (await import('/js/appState.js')).default;
    window.rec = (await import('/js/recordingManager.js')).default;
    window.engine = (await import('/js/metronomeEngine.js')).default;
    window.monitor = (await import('/js/monitoring.js')).default;
    (await import('/js/interactionMotion.js')).initializeInteractionMotion(document);
    if (!a.getTracks().length) a.addTrack();
    const context = a.initializeAudioContext();
    const buffer = context.createBuffer(1, context.sampleRate / 10, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = .3 * Math.sin(2 * Math.PI * 440 * i / context.sampleRate);
    a.setSoundBuffer('Generated click', buffer);
    a.updateTrack(0, { mainBeatSound: {sound:'Generated click',settings:{}}, subdivisionSound: {sound:'Generated click',settings:{}} });
    a.setTempo(240);
    monitor.setVolume(.6);
    rec.init();
    window.observed = [];
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes)
        if (node.nodeType === 1 && node.dataset.motionKind) observed.push(node.dataset.motionKind);
    }).observe(document.querySelector('[data-interaction-motion-root]'), {childList:true,subtree:true});
    window.nativeEvents = [];
    const NativeRecorder = window.MediaRecorder;
    window.MediaRecorder = class extends NativeRecorder {
      constructor(...args) {
        super(...args);
        this.addEventListener('start', () => nativeEvents.push('start'));
        this.addEventListener('stop', () => nativeEvents.push('stop'));
      }
    };
    window.nativeDestinations = [];
    const create = context.createMediaStreamDestination.bind(context);
    context.createMediaStreamDestination = () => { const node = create(); nativeDestinations.push(node); return node; };
    // Observe startup too: track initialization can allocate the normal output.
    window.output = monitor.getOutput(context);
    window.originalGain = output.gain.value;
    window.noMicrophone = 0;
    navigator.mediaDevices.getUserMedia = () => { noMicrophone++; throw Error('Microphone must not be requested'); };
  });
  await page.locator('#manage-recordings-btn').click();
  await page.locator('#loop-bars-select').selectOption('1');
  await page.evaluate(() => { observed = []; });
}

async function joinedHost(page, metadata) {
  const endpoint = metadata.precisionNativeSignalURL || 'ws://127.0.0.1:10000';
  await page.addInitScript(endpoint => {
    const NativeSocket = window.WebSocket;
    window.transportEvidence = [];
    window.WebSocket = class extends NativeSocket {
      constructor(url, protocols) {
        super(endpoint, protocols);
        this.addEventListener('message', event => {
          const message = JSON.parse(event.data);
          if (message.type === 'transport') transportEvidence.push({event:'authority', playing:message.playing});
        });
      }
    };
  }, endpoint);
  await ready(page);
  await page.evaluate(async () => {
    window.room = await import('/js/webrtc.js');
    await room.initializeWebRTC();
  });
  await expect.poll(() => page.evaluate(() => room.getRehearsalRoomState().joined && room.getRehearsalRoomState().isHost)).toBe(true);
  await page.evaluate(() => {
    room.enablePlayback();
    rec.openModal(); // The real join is an authority boundary; start in its new generation.
    const send = WebSocket.prototype.send;
    window.heldTransport = [];
    WebSocket.prototype.send = function(raw, ...args) {
      if (JSON.parse(raw).type === 'transport-command') {
        heldTransport.push(() => send.call(this, raw, ...args));
        return;
      }
      return send.call(this, raw, ...args);
    };
    window.releaseTransport = () => {
      WebSocket.prototype.send = send;
      for (const forward of heldTransport.splice(0)) forward();
    };
    document.addEventListener('playbackstatechange', () => transportEvidence.push({event:'playback', playing:a.isPlaying()}));
    observed = [];
  });
}

async function complete(page) {
  await expect.poll(() => page.evaluate(() => a.getRecordings().filter(name => name.startsWith('Loop ')).length)).toBe(1);
  await expect(page.locator('#record-loop-btn')).toBeEnabled();
}

async function released(page) {
  await expect.poll(() => page.evaluate(() => rec.loopSamplerRecorder === null && rec.loopSamplerDestination === null && rec.loopSamplerTimeoutId === null)).toBe(true);
  expect(await page.evaluate(() => nativeDestinations.every(node => node.stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true);
  expect(await page.evaluate(() => routes.filter(route => route.active && nativeDestinations.includes(route.to)).length)).toBe(0);
  expect(await page.evaluate(() => output.gain.value)).toBeCloseTo(.6, 4);
  expect(await page.evaluate(() => noMicrophone)).toBe(0);
  expect(await page.evaluate(() => routes.filter(route => route.active && route.from === output && route.to === a.getAudioContext().destination).length)).toBe(1);
  expect(await page.evaluate(() => rec.loopSamplerSession)).toBeNull();
}

test('native loop capture contains generated metronome audio and releases only its recording branch', async ({page}) => {
  await ready(page);
  await page.locator('#record-loop-btn').click();
  await expect.poll(() => page.evaluate(() => observed.includes('record-start'))).toBe(true);
  expect(await page.evaluate(() => ({speakers: routes.filter(route => route.active && route.from === output && route.to === a.getAudioContext().destination).length, branches: routes.filter(route => route.active && route.from === output && nativeDestinations.includes(route.to)).length}))).toEqual({speakers:1,branches:1});
  await complete(page);
  const signal = await page.evaluate(() => {
    const buffer = a.getSoundBuffer(a.getRecordings().find(name => name.startsWith('Loop ')));
    const samples = buffer.getChannelData(0);
    let peak=0, energy=0, nonzero=0;
    for (const value of samples) { peak=Math.max(peak,Math.abs(value)); energy+=value*value; if(Math.abs(value)>.001)nonzero++; }
    return {peak,rms:Math.sqrt(energy/samples.length),nonzero,duration:buffer.duration,playing:a.isPlaying(),kinds:observed};
  });
  console.log('Native decoded loop signal:', JSON.stringify(signal));
  expect(signal.peak).toBeGreaterThan(.02);
  expect(signal.rms).toBeGreaterThan(.005);
  expect(signal.nonzero).toBeGreaterThan(1000);
  expect(signal.duration).toBeGreaterThan(.5);
  expect(signal.playing).toBe(true);
  expect(signal.kinds).toContain('record-start');
  expect(signal.kinds).toContain('record-stop');
  expect(signal.kinds).toContain('sample');
  expect(signal.kinds).not.toContain('save');
  expect(signal.kinds.indexOf('record-start')).toBeLessThan(signal.kinds.indexOf('record-stop'));
  expect(signal.kinds.indexOf('record-stop')).toBeLessThan(signal.kinds.indexOf('sample'));
  expect(await page.evaluate(() => nativeEvents)).toEqual(['start','stop']);
  await released(page);
  await page.evaluate(() => engine.cancelPlayback());
});


test('joined host waits for authoritative playback before native loop capture', async ({page}, info) => {
  await joinedHost(page, info.config.metadata);
  try {
    await page.locator('#record-loop-btn').click();
    await expect.poll(() => page.evaluate(() => heldTransport.length)).toBe(1);
    expect(await page.evaluate(() => ({playing:a.isPlaying(), pending:rec.loopSamplerSession !== null, events:nativeEvents, refused:observed.includes('refuse')})))
      .toEqual({playing:false, pending:true, events:[], refused:false});
    await expect(page.locator('#record-loop-btn')).toBeDisabled();
    await page.evaluate(() => { transportEvidence = []; releaseTransport(); });
    await complete(page);
    const evidence = await page.evaluate(() => {
      const buffer = a.getSoundBuffer(a.getRecordings().find(name => name.startsWith('Loop ')));
      let peak=0, energy=0, nonzero=0;
      const data = buffer.getChannelData(0);
      for (const value of data) { peak=Math.max(peak,Math.abs(value)); energy+=value*value; if(Math.abs(value)>.001)nonzero++; }
      return {transport:transportEvidence, events:nativeEvents, peak,rms:Math.sqrt(energy/data.length),nonzero,playing:a.isPlaying(),kinds:observed};
    });
    console.log('Joined authoritative native loop:', JSON.stringify(evidence));
    expect(evidence.transport).toContainEqual({event:'authority',playing:true});
    expect(evidence.transport).toContainEqual({event:'playback',playing:true});
    expect(evidence.events).toEqual(['start','stop']);
    expect(evidence.peak).toBeGreaterThan(.02);
    expect(evidence.rms).toBeGreaterThan(.005);
    expect(evidence.nonzero).toBeGreaterThan(1000);
    expect(evidence.playing).toBe(true);
    expect(evidence.kinds).toContain('sample');
    expect(evidence.kinds).not.toContain('refuse');
    await released(page);
  } finally {
    await page.evaluate(() => { releaseTransport(); room.disconnect(); engine.cancelPlayback(); });
  }
});

for (const boundary of ['close', 'disconnect']) {
  test(`joined host pending playback cancels on ${boundary} without leaking capture or stale feedback`, async ({page}, info) => {
    await joinedHost(page, info.config.metadata);
    try {
      await page.locator('#record-loop-btn').click();
      await expect.poll(() => page.evaluate(() => heldTransport.length)).toBe(1);
      expect(await page.evaluate(() => rec.loopSamplerSession !== null)).toBe(true);
      await page.evaluate(() => { rec.startLoopSampler(); });
      expect(await page.evaluate(() => nativeDestinations.length)).toBe(1);
      if (boundary === 'close') await page.locator('#manage-recordings-modal .close-button').click();
      else await page.evaluate(() => room.disconnect());
      await expect(page.locator('#record-loop-btn')).toBeEnabled();
      await released(page);
      expect(await page.evaluate(() => nativeEvents)).toEqual([]);
      await page.evaluate(() => { observed = []; releaseTransport(); });
      if (boundary === 'close') {
        // Let the genuine delayed server authority start playback after cancellation.
        await expect.poll(() => page.evaluate(() => a.isPlaying())).toBe(true);
      }
      expect(await page.evaluate(() => ({events:nativeEvents, recordings:a.getRecordings(), kinds:observed})))
        .toEqual({events:[], recordings:[], kinds:[]});
      await released(page);
    } finally {
      await page.evaluate(() => { releaseTransport(); room.disconnect(); engine.cancelPlayback(); });
    }
  });
}

test('joined host playback wait times out boundedly and ignores a late authoritative start', async ({page}, info) => {
  await joinedHost(page, info.config.metadata);
  try {
    await page.locator('#record-loop-btn').click();
    await expect.poll(() => page.evaluate(() => heldTransport.length)).toBe(1);
    await expect.poll(() => page.evaluate(() => observed.includes('refuse')), {timeout:15000}).toBe(true);
    await expect(page.locator('#record-loop-btn')).toBeEnabled();
    await released(page);
    expect(await page.evaluate(() => nativeEvents)).toEqual([]);
    await page.evaluate(() => { observed = []; releaseTransport(); });
    await expect.poll(() => page.evaluate(() => a.isPlaying())).toBe(true);
    expect(await page.evaluate(() => ({events:nativeEvents,recordings:a.getRecordings(),kinds:observed})))
      .toEqual({events:[],recordings:[],kinds:[]});
  } finally {
    await page.evaluate(() => { releaseTransport(); room.disconnect(); engine.cancelPlayback(); });
  }
});

for (const boundary of ['close', 'backdrop', 'roomauthoritychange', 'syncrolechange']) {
  test(`active native loop capture immediately releases on ${boundary} boundary`, async ({page}) => {
    await ready(page);
    try {
      await page.locator('#loop-bars-select').selectOption('8');
      // Cover both the playback-wait path and capture begun during existing playback.
      if (['backdrop', 'syncrolechange'].includes(boundary)) await page.evaluate(() => engine.togglePlay());
      await page.locator('#record-loop-btn').click();
      await expect.poll(() => page.evaluate(() => nativeEvents.includes('start'))).toBe(true);
      const before = await page.evaluate(() => {
        window.cancelledRecorder = rec.loopSamplerRecorder;
        window.cancelledDestination = rec.loopSamplerDestination;
        return {
          state:cancelledRecorder.state,
          tracks:cancelledDestination.stream.getTracks().map(track => track.readyState),
          timer:rec.loopSamplerTimeoutId !== null,
          branches:routes.filter(route => route.active && route.from === output && route.to === cancelledDestination).length
        };
      });
      expect(before).toEqual({state:'recording',tracks:['live'],timer:true,branches:1});
      const immediate = await page.evaluate(boundary => {
        observed = [];
        if (boundary === 'close') document.querySelector('#manage-recordings-modal .close-button').click();
        else if (boundary === 'backdrop') document.getElementById('manage-recordings-modal').click();
        else document.dispatchEvent(new Event(boundary));
        return {
          state:cancelledRecorder.state,
          tracks:cancelledDestination.stream.getTracks().map(track => track.readyState),
          timer:rec.loopSamplerTimeoutId,
          branches:routes.filter(route => route.active && route.from === output && route.to === cancelledDestination).length,
          playing:a.isPlaying()
        };
      }, boundary);
      console.log('Active native loop boundary:', JSON.stringify({boundary,before,immediate}));
      // Read in the same task as cancellation: waiting until the 8-bar deadline is not cleanup.
      expect(immediate).toEqual({state:'inactive',tracks:['ended'],timer:null,branches:0,playing:true});
      await expect.poll(() => page.evaluate(() => nativeEvents), {timeout:2000}).toEqual(['start','stop']);
      await expect(page.locator('#record-loop-btn')).toBeEnabled();
      await released(page);
      expect(await page.evaluate(() => a.getRecordings())).toEqual([]);
      expect(await page.evaluate(() => observed)).toEqual(['close', 'backdrop'].includes(boundary) ? ['close'] : []);
      // A queued old native stop cannot seize a new session or publish a cancelled sample.
      await page.evaluate(() => { rec.openModal(); observed = []; });
      await page.locator('#loop-bars-select').selectOption('1');
      await page.locator('#record-loop-btn').click();
      await complete(page);
      expect(await page.evaluate(() => nativeEvents)).toEqual(['start','stop','start','stop']);
      await released(page);
    } finally {
      await page.evaluate(() => engine.cancelPlayback());
    }
  });
}

for (const stage of ['resume', 'constructor', 'start', 'decode', 'native-error']) {
  test(`loop sampler ${stage} failure refuses without saving and releases owned resources`, async ({page}) => {
    await ready(page);
    await page.evaluate(async stage => {
      const context = a.getAudioContext();
      // Inject only the failure boundary; successful recording/decoding remains native.
      if (stage === 'resume') {
        await context.suspend();
        context.resume = () => Promise.reject(new Error('Injected resume denial'));
      } else if (stage === 'constructor') {
        window.MediaRecorder = class { constructor() { throw new Error('Injected constructor failure'); } };
      } else if (stage === 'start') {
        MediaRecorder.prototype.start = () => { throw new Error('Injected native start failure'); };
      } else if (stage === 'decode') {
        context.decodeAudioData = () => Promise.reject(new Error('Injected decode failure'));
      }
    }, stage);
    await page.locator('#record-loop-btn').click();
    if (stage === 'native-error') {
      await expect.poll(() => page.evaluate(() => observed.includes('record-start'))).toBe(true);
      await page.evaluate(() => rec.loopSamplerRecorder.dispatchEvent(new Event('error')));
    }
    await expect.poll(() => page.evaluate(() => observed.includes('refuse'))).toBe(true);
    await expect(page.locator('#record-loop-btn')).toBeEnabled();
    expect(await page.evaluate(() => a.getRecordings())).toEqual([]);
    const kinds = await page.evaluate(() => observed);
    expect(kinds).not.toContain('sample');
    expect(kinds).not.toContain('save');
    if (['resume','constructor','start'].includes(stage)) expect(kinds).not.toContain('record-start');
    if (stage === 'decode') expect(kinds).toContain('record-stop');
    await released(page);
    await page.evaluate(() => engine.cancelPlayback());
  });
}

for (const boundary of ['close', 'authority']) {
  test(`pending native loop decode cannot publish after ${boundary} boundary or admit reentry`, async ({page}) => {
    await ready(page);
    await page.evaluate(() => {
      const context = a.getAudioContext();
      const decode = context.decodeAudioData.bind(context);
      context.decodeAudioData = async bytes => {
        window.decodeEntered = true;
        await new Promise(resolve => { window.releaseDecode = resolve; });
        return decode(bytes);
      };
    });
    await page.locator('#record-loop-btn').click();
    await expect.poll(() => page.evaluate(() => window.decodeEntered)).toBe(true);
    await expect(page.locator('#record-loop-btn')).toBeDisabled();
    await page.evaluate(() => rec.startLoopSampler());
    expect(await page.evaluate(() => nativeDestinations.length)).toBe(1);
    expect(await page.evaluate(() => nativeEvents)).toEqual(['start','stop']);
    expect(await page.evaluate(() => nativeDestinations[0].stream.getTracks().every(track => track.readyState === 'ended'))).toBe(true);
    if (boundary === 'close') await page.locator('#manage-recordings-modal .close-button').click();
    else await page.evaluate(() => document.dispatchEvent(new Event('roomauthoritychange')));
    await page.evaluate(() => { observed = []; releaseDecode(); });
    await expect.poll(() => page.evaluate(() => rec.loopSamplerSession)).toBeNull();
    expect(await page.evaluate(() => a.getRecordings())).toEqual([]);
    expect(await page.evaluate(() => observed)).toEqual([]);
    await released(page);
    await page.evaluate(() => engine.cancelPlayback());
  });
}

test('simultaneous setup calls allocate only one native capture session', async ({page}) => {
  await ready(page);
  await page.evaluate(() => { rec.startLoopSampler(); rec.startLoopSampler(); });
  await complete(page);
  expect(await page.evaluate(() => nativeDestinations.length)).toBe(1);
  expect(await page.evaluate(() => nativeEvents)).toEqual(['start','stop']);
  await released(page);
  await page.evaluate(() => engine.cancelPlayback());
});

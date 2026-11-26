const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture({ webAudio = true, resume = false } = {}) {
  const calls = { fetch: 0, decode: 0, context: 0, starts: 0, stops: 0, media: 0, plays: 0 };
  const resumes = [];
  const timers = new Map();
  let timerId = 0;
  let now = 0;
  class Context {
    constructor(options) {
      assert.equal(options.latencyHint, 'interactive');
      this.state = resume ? 'suspended' : 'running';
      calls.context++;
    }
    createGain() { return { gain: {}, connect() {} }; }
    async decodeAudioData() { calls.decode++; return {}; }
    createBufferSource() {
      return { connect() {}, disconnect() {}, start() { calls.starts++; }, stop() { calls.stops++; } };
    }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    resume() { return new Promise(resolve => resumes.push(() => { this.state = 'running'; resolve(); })); }
  }
  const window = webAudio ? { AudioContext: Context } : {};
  const context = vm.createContext({ window, performance: { now: () => now },
    fetch: async () => { calls.fetch++; return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) }; },
    Audio: class { constructor() { calls.media++; } pause() {} play() { calls.plays++; return Promise.resolve(); } },
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id) });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../content/interaction-audio.js'), 'utf8'), context);
  const audio = new window.CatstellaInteractionAudio(file => file);
  return { audio, calls, resumes, advance: value => { now += value; }, idle: () => { for (const fn of timers.values()) fn(); timers.clear(); } };
}

test('audio predecodes only two buffers; rapid taps neither fetch nor decode on the input path', async () => {
  const { audio, calls } = fixture();
  audio.configure(true);
  await audio.prepare();
  assert.equal(calls.fetch, 2);
  assert.equal(calls.decode, 2);
  for (let i = 0; i < 40; i++) audio.play(i % 2 ? 'release' : 'press');
  assert.equal(calls.starts, 40, 'ready context starts synchronously');
  assert.equal(calls.stops, 39, 'only one sound may be active');
  assert.equal(calls.fetch, 2);
  assert.equal(calls.decode, 2);
  assert.equal(calls.media, 0);
  audio.configure(false);
  audio.play();
  assert.equal(calls.starts, 40);
  audio.configure(true);
  await audio.prepare();
  assert.equal(calls.context, 1, 'settings changes reuse the engine and buffers');
});

test('a cold single tap queues immediately without waiting for device resume', async () => {
  const { audio, calls, resumes } = fixture({ resume: true });
  audio.configure(true);
  await audio.prepare();
  audio.play('press');
  assert.equal(calls.starts, 1, 'first click must not be dropped while the device wakes');
  audio.play('release');
  assert.equal(calls.starts, 2);
  assert.equal(calls.stops, 1, 'release replaces the pending press instead of queueing clicks');
  assert.equal(resumes.length, 1, 'pending device resume is shared');
  audio.configure(false);
  assert.equal(calls.stops, 2);
  resumes.splice(0).forEach(resolve => resolve());
  for(let i=0;i<4;i++)await Promise.resolve();
  assert.equal(calls.starts, 2, 'resume completion never creates a delayed sound');
  assert.equal(audio.context.state, 'suspended', 'a delayed resume must not leave a disabled engine running');
});

test('a visible idle page stays ready; only hiding or muting suspends audio', async () => {
  const { audio, calls, idle } = fixture();
  audio.configure(true);
  await audio.prepare();
  audio.play();
  idle();
  assert.equal(audio.context.state, 'running', 'no five-second idle suspension');
  audio.setVisible(false);
  assert.equal(audio.context.state, 'suspended');
  audio.play();
  assert.equal(calls.starts, 1, 'hidden pages cannot play sounds');
  assert.equal(audio.buffers.size, 2);
  assert.equal(calls.decode, 2);
});

test('blocked autoplay never emits an old sound after a later unrelated user gesture', async () => {
  const { audio, calls, resumes, idle } = fixture({ resume: true });
  audio.configure(true);
  await audio.prepare();
  audio.play();
  assert.equal(calls.starts, 1);
  idle();
  assert.equal(calls.stops, 1, 'unrendered source is discarded when autoplay remains blocked');
  resumes[0]();
  await Promise.resolve();
  assert.equal(calls.starts, 1, 'a later permission grant cannot create or replay a new sound');
});

test('unsupported Web Audio falls back to bounded, reusable media elements', () => {
  const { audio, calls } = fixture({ webAudio: false });
  audio.configure(true);
  for (let i = 0; i < 30; i++) audio.play(i % 2 ? 'release' : 'press');
  assert.equal(calls.media, 2);
  assert.equal(calls.plays, 30);
  audio.configure(false);
  audio.play();
  assert.equal(calls.plays, 30);
});

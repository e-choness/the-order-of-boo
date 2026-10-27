// Web Audio: sample playback (2D + HRTF-positional), synthesized FX, and a
// small procedural music engine that performs public-domain spooky classics with
// a music-box / celesta / pad ensemble whose intensity follows the stealth state.

import { settings, onSettings } from './settings';

const BASE = './assets/audio/';

export const SFX_LIST = [
  // 'snow' steps double as crunchy fallen leaves outdoors
  ...['carpet', 'wood', 'concrete', 'snow'].flatMap((s) => [0, 1, 2, 3, 4].map((i) => `sfx/step_${s}_${i}`)),
  ...['glass', 'wood', 'soft', 'plate', 'bell', 'metal'].flatMap((s) => [0, 1, 2].map((i) => `sfx/${s}_${i}`)),
  'sfx/book_open', 'sfx/book_flip', 'sfx/book_close', 'sfx/door_open', 'sfx/door_close',
  'sfx/creak_0', 'sfx/creak_1', 'sfx/creak_2', 'sfx/cloth_0', 'sfx/cloth_1', 'sfx/coins', 'sfx/latch',
  'sfx/click_metal', 'sfx/drawer', 'sfx/ui_hover', 'sfx/ui_click', 'sfx/ui_confirm', 'sfx/ui_back',
  'sfx/ui_error', 'sfx/suspicious', 'sfx/sparkle', 'sfx/magic_up', 'sfx/magic_down', 'sfx/pluck',
  'sfx/lamp_switch', 'sfx/pickup', 'sfx/page', 'sfx/toggle', 'sfx/bong',
  'music/win', 'music/clue', 'music/lose', 'music/spotted', 'music/partial', 'music/caught',
];

export interface PlayOpts {
  volume?: number;
  rate?: number;
  /** random +- detune on playback rate */
  vary?: number;
  pos?: { x: number; y: number; z: number };
  /** 0..1 how much this sound is muffled by walls */
  muffle?: number;
  bus?: 'sfx' | 'music' | 'ui';
}

type Note = [number | null, number]; // midi (null = rest), beats

export class AudioEngine {
  ctx: AudioContext;
  master: GainNode;
  sfxBus: GainNode;
  musicBus: GainNode;
  uiBus: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private reverb: ConvolverNode;
  private reverbSend: GainNode;
  private noiseBuf: AudioBuffer;
  music: MusicEngine;
  unlocked = false;

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(this.ctx.destination);
    this.sfxBus = this.ctx.createGain();
    this.musicBus = this.ctx.createGain();
    this.uiBus = this.ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);
    this.uiBus.connect(this.master);

    // Cosy room reverb, generated (no impulse files needed)
    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(2.2, 2.6);
    this.reverbSend = this.ctx.createGain();
    this.reverbSend.gain.value = 0.22;
    this.reverbSend.connect(this.reverb).connect(this.master);

    this.noiseBuf = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    this.music = new MusicEngine(this);
    this.applySettings();
    onSettings(() => this.applySettings());

    const unlock = () => {
      if (this.ctx.state !== 'running') this.ctx.resume();
      this.unlocked = true;
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  get reverbInput() { return this.reverbSend; }

  applySettings() {
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(settings.masterVolume, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(settings.sfxVolume, t, 0.05);
    this.uiBus.gain.setTargetAtTime(Math.min(1, settings.sfxVolume * 0.8), t, 0.05);
    this.musicBus.gain.setTargetAtTime(settings.musicVolume * 0.7, t, 0.05);
  }

  private makeImpulse(seconds: number, decay: number) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  async loadAll(onProgress?: (p: number) => void) {
    let done = 0;
    await Promise.all(
      SFX_LIST.map(async (name) => {
        try {
          const res = await fetch(`${BASE}${name}.ogg`);
          const arr = await res.arrayBuffer();
          const buf = await this.ctx.decodeAudioData(arr);
          this.buffers.set(name, buf);
        } catch {
          // A missing/undecodable sample should never break the game
        }
        done++;
        onProgress?.(done / SFX_LIST.length);
      }),
    );
  }

  setListener(pos: { x: number; y: number; z: number }, fwd: { x: number; y: number; z: number }) {
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(pos.x, t, 0.02);
      l.positionY.setTargetAtTime(pos.y, t, 0.02);
      l.positionZ.setTargetAtTime(pos.z, t, 0.02);
      l.forwardX.setTargetAtTime(fwd.x, t, 0.02);
      l.forwardY.setTargetAtTime(fwd.y, t, 0.02);
      l.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else {
      (l as any).setPosition(pos.x, pos.y, pos.z);
      (l as any).setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
    }
  }

  /** Play a sample. `name` may omit the variant index: "sfx/step_wood" picks 0..4 randomly. */
  play(name: string, o: PlayOpts = {}) {
    if (this.ctx.state !== 'running') return null;
    let buf = this.buffers.get(name);
    if (!buf) {
      const variants: AudioBuffer[] = [];
      for (let i = 0; i < 6; i++) {
        const b = this.buffers.get(`${name}_${i}`);
        if (b) variants.push(b);
      }
      if (variants.length) buf = variants[(Math.random() * variants.length) | 0];
    }
    if (!buf) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const vary = o.vary ?? 0.06;
    src.playbackRate.value = (o.rate ?? 1) * (1 + (Math.random() * 2 - 1) * vary);
    const g = this.ctx.createGain();
    g.gain.value = o.volume ?? 1;
    let node: AudioNode = src;
    if (o.muffle && o.muffle > 0.01) {
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 18000 * Math.pow(1 - Math.min(0.95, o.muffle), 2.2) + 300;
      node.connect(lp);
      node = lp;
      g.gain.value *= 1 - o.muffle * 0.55;
    }
    node.connect(g);
    const bus = o.bus === 'music' ? this.musicBus : o.bus === 'ui' ? this.uiBus : this.sfxBus;
    if (o.pos) {
      const p = this.ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = 1.2;
      p.rolloffFactor = 1.1;
      p.maxDistance = 40;
      p.positionX.value = o.pos.x;
      p.positionY.value = o.pos.y;
      p.positionZ.value = o.pos.z;
      g.connect(p).connect(bus);
      p.connect(this.reverbSend);
    } else {
      g.connect(bus);
      if (o.bus !== 'ui') g.connect(this.reverbSend);
    }
    src.start();
    return src;
  }

  ui(name: 'hover' | 'click' | 'confirm' | 'back' | 'error' | 'page' | 'toggle') {
    this.play(`sfx/ui_${name}`.replace('ui_page', 'page').replace('ui_toggle', 'toggle'), { bus: 'ui', volume: name === 'hover' ? 0.25 : 0.6 });
  }

  // ---------- synthesized FX ----------

  private env(g: GainNode, t: number, a: number, peak: number, d: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  /** Sparkling magical chime arpeggio. */
  chime(base = 84, count = 5, spread = 0.06, vol = 0.18, pos?: PlayOpts['pos']) {
    const t0 = this.ctx.currentTime;
    const out = this.spatialOut(pos, vol);
    const scale = [0, 4, 7, 11, 14, 16, 19, 23];
    for (let i = 0; i < count; i++) {
      const t = t0 + i * spread;
      const f = midiHz(base + scale[i % scale.length]);
      bell(this.ctx, out, f, t, 1.1, 0.5);
    }
  }

  /** Airy whoosh used for spells. */
  whoosh(dur = 0.8, up = true, vol = 0.25, pos?: PlayOpts['pos']) {
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2.5;
    bp.frequency.setValueAtTime(up ? 400 : 3200, t);
    bp.frequency.exponentialRampToValueAtTime(up ? 3600 : 300, t + dur);
    const g = this.ctx.createGain();
    this.env(g, t, dur * 0.35, vol, dur * 0.65);
    src.connect(bp).connect(g).connect(pos ? this.spatialOut(pos, 1) : this.sfxBus);
    g.connect(this.reverbSend);
    src.start(t);
    src.stop(t + dur + 0.1);
  }

  /** Ghostly double knock on wood + a rattle (Bump in the Night). */
  knock(pos?: PlayOpts['pos'], vol = 0.7) {
    const out = this.spatialOut(pos, vol);
    const t0 = this.ctx.currentTime;
    for (const [dt, v] of [[0, 1], [0.16, 0.8], [0.5, 0.6]] as const) {
      const t = t0 + dt;
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(180, t);
      o.frequency.exponentialRampToValueAtTime(70, t + 0.12);
      const g = this.ctx.createGain();
      this.env(g, t, 0.003, 0.9 * v, 0.14);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.2);
      const n = this.ctx.createBufferSource();
      n.buffer = this.noiseBuf;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 900;
      bp.Q.value = 1.4;
      const ng = this.ctx.createGain();
      this.env(ng, t, 0.002, 0.5 * v, 0.06);
      n.connect(bp).connect(ng).connect(out);
      n.start(t);
      n.stop(t + 0.1);
    }
  }

  /** Bony rattle shake (UI flourishes). */
  rattle(pos?: PlayOpts['pos'], dur = 1.2, vol = 0.5) {
    const out = this.spatialOut(pos, vol);
    const t0 = this.ctx.currentTime;
    const hits = Math.floor(dur * 9);
    for (let i = 0; i < hits; i++) {
      const t = t0 + i / 9 + Math.random() * 0.02;
      for (const f of [1700, 2300, 3100]) {
        const o = this.ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f * (1 + Math.random() * 0.03);
        const g = this.ctx.createGain();
        this.env(g, t, 0.003, 0.05, 0.12);
        const hp = this.ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 1200;
        o.connect(hp).connect(g).connect(out);
        o.start(t);
        o.stop(t + 0.2);
      }
    }
  }

  /** Low heartbeat thump for tension. */
  heartbeat(vol = 0.5) {
    const t = this.ctx.currentTime;
    for (const [dt, v] of [[0, 1], [0.18, 0.7]] as const) {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(70, t + dt);
      o.frequency.exponentialRampToValueAtTime(38, t + dt + 0.18);
      const g = this.ctx.createGain();
      this.env(g, t + dt, 0.01, vol * v, 0.2);
      o.connect(g).connect(this.sfxBus);
      o.start(t + dt);
      o.stop(t + dt + 0.3);
    }
  }

  /** A soft synthesized "huh?" vocal-ish blip for NPC suspicion. */
  murmur(pos: PlayOpts['pos'], pitch = 1, question = true, vol = 0.35) {
    const out = this.spatialOut(pos, vol);
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    const f0 = 140 * pitch;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(question ? f0 * 1.6 : f0 * 0.7, t + 0.32);
    const f1 = this.ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = 700 * pitch;
    f1.Q.value = 4;
    const f2 = this.ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = 1200 * pitch;
    f2.Q.value = 6;
    const g = this.ctx.createGain();
    this.env(g, t, 0.04, 0.6, 0.32);
    o.connect(f1).connect(g);
    o.connect(f2).connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + 0.45);
  }

  /** Short procedural "voice" babble while a subtitle line plays. */
  babble(pos: PlayOpts['pos'], seconds: number, pitch = 1, vol = 0.12) {
    const out = this.spatialOut(pos, vol);
    const t0 = this.ctx.currentTime;
    const syll = Math.max(2, Math.floor(seconds * 4.5));
    for (let i = 0; i < syll; i++) {
      if (Math.random() < 0.15) continue;
      const t = t0 + i * (seconds / syll);
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      const f = (120 + Math.random() * 60) * pitch;
      o.frequency.setValueAtTime(f, t);
      o.frequency.linearRampToValueAtTime(f * (0.85 + Math.random() * 0.4), t + 0.12);
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = (500 + Math.random() * 900) * pitch;
      bp.Q.value = 3;
      const g = this.ctx.createGain();
      this.env(g, t, 0.02, 0.5, 0.12);
      o.connect(bp).connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.18);
    }
  }

  /** Dog bark / cat meow / animatronic skeleton shriek & cackle, synthesized. */
  animal(kind: 'bark' | 'meow' | 'hiss' | 'purr' | 'beep' | 'shriek' | 'cackle', pos?: PlayOpts['pos'], vol = 0.6) {
    const out = this.spatialOut(pos, vol);
    const t = this.ctx.currentTime;
    if (kind === 'shriek') {
      // cheap-speaker scream: detuned saws sliding up, through a tinny bandpass
      for (const det of [0, 7, -5]) {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(380 + det * 10, t);
        o.frequency.exponentialRampToValueAtTime(1300 + det * 20, t + 0.35);
        o.frequency.exponentialRampToValueAtTime(900, t + 0.9);
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 2;
        const g = this.ctx.createGain();
        this.env(g, t, 0.03, 0.35, 0.9);
        o.connect(bp).connect(g).connect(out);
        o.start(t); o.stop(t + 1);
      }
      return;
    }
    if (kind === 'cackle') {
      // "mwa-ha-ha-ha": falling formant blips
      for (let i = 0; i < 5; i++) {
        const dt = i * 0.13;
        const o = this.ctx.createOscillator();
        o.type = 'square';
        o.frequency.setValueAtTime(260 - i * 18, t + dt);
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 800 - i * 60; bp.Q.value = 4;
        const g = this.ctx.createGain();
        this.env(g, t + dt, 0.01, 0.5, 0.09);
        o.connect(bp).connect(g).connect(out);
        o.start(t + dt); o.stop(t + dt + 0.12);
      }
      return;
    }
    if (kind === 'bark') {
      for (const dt of [0, 0.22]) {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(420, t + dt);
        o.frequency.exponentialRampToValueAtTime(180, t + dt + 0.14);
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 1.2;
        const g = this.ctx.createGain();
        this.env(g, t + dt, 0.01, 0.9, 0.15);
        o.connect(bp).connect(g).connect(out);
        o.start(t + dt); o.stop(t + dt + 0.2);
      }
    } else if (kind === 'meow') {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(500, t);
      o.frequency.linearRampToValueAtTime(820, t + 0.18);
      o.frequency.linearRampToValueAtTime(420, t + 0.55);
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = 3;
      bp.frequency.setValueAtTime(900, t);
      bp.frequency.linearRampToValueAtTime(1800, t + 0.2);
      bp.frequency.linearRampToValueAtTime(800, t + 0.55);
      const g = this.ctx.createGain();
      this.env(g, t, 0.06, 0.6, 0.5);
      o.connect(bp).connect(g).connect(out);
      o.start(t); o.stop(t + 0.65);
    } else if (kind === 'hiss') {
      const s = this.ctx.createBufferSource();
      s.buffer = this.noiseBuf;
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 2500;
      const g = this.ctx.createGain();
      this.env(g, t, 0.05, 0.5, 0.6);
      s.connect(hp).connect(g).connect(out);
      s.start(t); s.stop(t + 0.7);
    } else if (kind === 'purr') {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = 26;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 300;
      const g = this.ctx.createGain();
      this.env(g, t, 0.2, 0.5, 1.2);
      o.connect(lp).connect(g).connect(out);
      o.start(t); o.stop(t + 1.5);
    } else {
      for (const [dt, f] of [[0, 1760], [0.12, 2093]] as const) {
        const o = this.ctx.createOscillator();
        o.type = 'square'; o.frequency.value = f;
        const g = this.ctx.createGain();
        this.env(g, t + dt, 0.005, 0.25, 0.09);
        o.connect(g).connect(out);
        o.start(t + dt); o.stop(t + dt + 0.12);
      }
    }
  }

  private spatialOut(pos: PlayOpts['pos'] | undefined, vol: number): AudioNode {
    const g = this.ctx.createGain();
    g.gain.value = vol;
    if (pos) {
      const p = this.ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = 1.2;
      p.rolloffFactor = 1.1;
      p.positionX.value = pos.x;
      p.positionY.value = pos.y;
      p.positionZ.value = pos.z;
      g.connect(p).connect(this.sfxBus);
      p.connect(this.reverbSend);
    } else {
      g.connect(this.sfxBus);
      g.connect(this.reverbSend);
    }
    return g;
  }
}

export function midiHz(m: number) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/** FM-ish bell / celesta voice. */
function bell(ctx: AudioContext, out: AudioNode, f: number, t: number, dur: number, vol: number) {
  const partials: [number, number][] = [[1, 1], [2.0, 0.35], [3.01, 0.18], [4.2, 0.08]];
  for (const [mul, amp] of partials) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f * mul;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol * amp, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur / mul);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
}

// ---------------------------------------------------------------------------
// Procedural music

interface Song {
  name: string;
  bpm: number;
  beatsPerBar: number;
  melody: Note[];
  /** chords: [root midi, quality, beats] */
  chords: [number, 'M' | 'm' | '7' | 'm7' | 'M7', number][];
  /** optional ostinato played under everything (looped) */
  ostinato?: Note[];
  voice: 'musicbox' | 'celesta' | 'pizz';
}

const N = (s: string): Note[] =>
  s.trim().split(/\s+/).map((tok) => {
    const [n, b] = tok.split(':');
    return [n === 'r' ? null : noteToMidi(n), parseFloat(b)];
  });

function noteToMidi(n: string) {
  const m = /^([A-G])(b|#)?(\d)$/.exec(n);
  if (!m) throw new Error('bad note ' + n);
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1] as 'C'];
  const acc = m[2] === 'b' ? -1 : m[2] === '#' ? 1 : 0;
  return 12 * (parseInt(m[3]) + 1) + base + acc;
}

export const SONGS: Record<string, Song> = {
  // Chopin, Piano Sonata No. 2 (1839), "Marche funèbre" — slowed onto a creaky music box
  funeralMarch: {
    name: 'Marche funèbre (music box)',
    bpm: 58,
    beatsPerBar: 4,
    voice: 'musicbox',
    melody: N(`Bb4:1.5 Bb4:0.75 Bb4:0.25 Bb4:1.5 Db5:0.75 C5:0.25 C5:0.75 Bb4:0.25 Bb4:0.75 A4:0.25 Bb4:2
      Bb4:1.5 Bb4:0.75 Bb4:0.25 Bb4:1.5 Db5:0.75 C5:0.25 C5:0.75 Bb4:0.25 Bb4:0.75 A4:0.25 Bb4:2
      F5:1.5 Eb5:0.5 Db5:1 C5:1 Db5:1.5 C5:0.5 Bb4:1 A4:1 Bb4:1.5 C5:0.5 Db5:1 Eb5:1 C5:3 r:1
      Bb4:1.5 Bb4:0.75 Bb4:0.25 Bb4:1.5 Db5:0.75 C5:0.25 C5:0.75 Bb4:0.25 Bb4:0.75 A4:0.25 Bb4:2 r:2`),
    chords: [[46, 'm', 4], [41, '7', 4], [46, 'm', 4], [41, '7', 4], [46, 'm', 4], [41, '7', 4], [42, 'M', 4], [41, '7', 4], [46, 'm', 4], [41, '7', 4]],
  },
  // Grieg, "In the Hall of the Mountain King" (1875) — creeping pizzicato that speeds up with danger
  mountainKing: {
    name: 'In the Hall of the Mountain King',
    bpm: 108,
    beatsPerBar: 4,
    voice: 'pizz',
    ostinato: N('B3:1 F#3:1 B3:1 F#3:1'),
    melody: N(`B3:0.5 C#4:0.5 D4:0.5 E4:0.5 F#4:0.5 D4:0.5 F#4:1 F4:0.5 C#4:0.5 F4:1 E4:0.5 C4:0.5 E4:1
      B3:0.5 C#4:0.5 D4:0.5 E4:0.5 F#4:0.5 D4:0.5 F#4:0.5 B4:0.5 A4:0.5 F#4:0.5 D4:0.5 F#4:0.5 A4:2
      F#4:0.5 G#4:0.5 A#4:0.5 B4:0.5 C#5:0.5 A#4:0.5 C#5:1 D5:0.5 A#4:0.5 D5:1 C#5:0.5 A#4:0.5 C#5:1
      F#4:0.5 G#4:0.5 A#4:0.5 B4:0.5 C#5:0.5 A#4:0.5 C#5:0.5 F#5:0.5 E5:0.5 C#5:0.5 A#4:0.5 C#5:0.5 E5:2 r:4`),
    chords: [[47, 'm', 8], [42, '7', 8], [42, 'M', 8], [42, '7', 12]],
  },
  // Bach (attr.), Toccata and Fugue in D minor — the famous opening, on a glassy celesta "organ"
  toccata: {
    name: 'Toccata in D minor',
    bpm: 76,
    beatsPerBar: 4,
    voice: 'celesta',
    melody: N(`A5:0.25 G5:0.25 A5:1.5 r:0.5 G5:0.25 F5:0.25 E5:0.25 D5:0.25 C#5:1 D5:2 r:2
      A4:0.25 G4:0.25 A4:1.5 r:0.5 E4:0.5 F4:0.5 C#4:0.5 D4:2 r:2
      A3:0.25 G3:0.25 A3:1.5 r:0.5 G3:0.25 F3:0.25 E3:0.25 D3:0.25 C#3:1 D3:3 r:1
      D4:0.5 F4:0.5 A4:0.5 D5:0.5 C#5:0.5 E5:0.5 G5:0.5 Bb5:0.5 A5:2 F5:1 D5:1 E5:1 C#5:1 D5:4`),
    chords: [[38, 'm', 8], [38, 'm', 4], [45, '7', 4], [38, 'm', 8], [38, 'm', 4], [45, '7', 4], [38, 'm', 4]],
  },
};

const CHORD_INTERVALS = { M: [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], m7: [0, 3, 7, 10], M7: [0, 4, 7, 11] };

export class MusicEngine {
  private a: AudioEngine;
  private song: Song | null = null;
  private out: GainNode;
  private padBus: GainNode;
  private melBus: GainNode;
  private ostBus: GainNode;
  private percBus: GainNode;
  private timer: number | null = null;
  private nextTime = 0;
  private beat = 0; // global beat counter
  private melIdx = 0;
  private melBeat = 0;
  private melLen = 0;
  private chordLen = 0;
  private ostLen = 0;
  /** 0 calm, 0.5 suspicious, 1 alert */
  intensity = 0;
  private smoothI = 0;

  constructor(a: AudioEngine) {
    this.a = a;
    const ctx = a.ctx;
    this.out = ctx.createGain();
    this.out.connect(a.musicBus);
    this.out.connect(a.reverbInput);
    this.padBus = ctx.createGain();
    this.melBus = ctx.createGain();
    this.ostBus = ctx.createGain();
    this.percBus = ctx.createGain();
    for (const b of [this.padBus, this.melBus, this.ostBus, this.percBus]) b.connect(this.out);
  }

  play(id: keyof typeof SONGS | null, fade = 1.2) {
    const ctx = this.a.ctx;
    if (id && this.song === SONGS[id]) return;
    this.out.gain.cancelScheduledValues(ctx.currentTime);
    this.out.gain.setTargetAtTime(0, ctx.currentTime, fade / 4);
    const start = () => {
      this.stopTimer();
      this.song = id ? SONGS[id] : null;
      if (!this.song) return;
      this.melLen = this.song.melody.reduce((s, n) => s + n[1], 0);
      this.chordLen = this.song.chords.reduce((s, c) => s + c[2], 0);
      this.ostLen = this.song.ostinato ? this.song.ostinato.reduce((s, n) => s + n[1], 0) : 0;
      this.beat = 0;
      this.melIdx = 0;
      this.melBeat = 0;
      this.nextTime = ctx.currentTime + 0.1;
      this.out.gain.cancelScheduledValues(ctx.currentTime);
      this.out.gain.setTargetAtTime(0.9, ctx.currentTime, 0.4);
      this.timer = window.setInterval(() => this.schedule(), 40);
    };
    if (this.song) window.setTimeout(start, fade * 600);
    else start();
  }

  stop() { this.play(null); }

  private stopTimer() {
    if (this.timer != null) clearInterval(this.timer);
    this.timer = null;
  }

  private schedule() {
    const s = this.song;
    if (!s) return;
    const ctx = this.a.ctx;
    if (ctx.state !== 'running') { this.nextTime = ctx.currentTime + 0.1; return; }
    this.smoothI += (this.intensity - this.smoothI) * 0.05;
    const I = this.smoothI;
    const t = ctx.currentTime;
    this.padBus.gain.setTargetAtTime(0.10 + I * 0.10, t, 0.3);
    this.melBus.gain.setTargetAtTime(s.ostinato ? 0.12 + I * 0.25 : 0.32, t, 0.3);
    this.ostBus.gain.setTargetAtTime(0.16 + I * 0.14, t, 0.3);
    this.percBus.gain.setTargetAtTime(I > 0.3 ? (I - 0.3) * 0.6 : 0, t, 0.3);
    const bpm = s.bpm * (1 + I * 0.18);
    const step = 0.25; // schedule in 16ths
    const secPerStep = (60 / bpm) * step;
    while (this.nextTime < t + 0.2) {
      this.tick(this.nextTime, secPerStep / step);
      this.beat += step;
      this.nextTime += secPerStep;
    }
  }

  private tick(time: number, secPerBeat: number) {
    const s = this.song!;
    const ctx = this.a.ctx;
    const b = this.beat;
    // chords (pad + bass) on chord boundaries
    let acc = 0;
    const cb = b % this.chordLen;
    for (const [root, q, beats] of s.chords) {
      if (Math.abs(cb - acc) < 1e-6) {
        this.pad(time, root, q, beats * secPerBeat);
        this.bass(time, root - 12 + 12, secPerBeat * Math.min(beats, 2));
      }
      acc += beats;
    }
    // melody
    const mb = b % this.melLen;
    if (Math.abs(mb) < 1e-6) { this.melIdx = 0; this.melBeat = 0; }
    const mel = s.melody;
    if (this.melIdx < mel.length && Math.abs(mb - this.melBeat) < 1e-6) {
      const [m, beats] = mel[this.melIdx];
      if (m != null) this.voice(s.voice, this.melBus, time, midiHz(m), beats * secPerBeat);
      this.melBeat += beats;
      this.melIdx++;
    }
    // ostinato
    if (s.ostinato) {
      const ob = b % this.ostLen;
      let oa = 0;
      for (const [m, beats] of s.ostinato) {
        if (Math.abs(ob - oa) < 1e-6 && m != null) this.voice('musicbox', this.ostBus, time, midiHz(m + (Math.floor(b / 12) % 4 === 3 ? 12 : 0)), beats * secPerBeat);
        oa += beats;
      }
    }
    // rattling-bones shaker on off-beats when tense
    if (this.smoothI > 0.3 && Math.abs((b * 2) % 1) < 1e-6 && Math.abs(b % 1) > 0.4) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = 2600;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 1800;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(0.08, time + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.08);
      o.connect(hp).connect(g).connect(this.percBus);
      o.start(time); o.stop(time + 0.1);
    }
    // timpani-ish pulse on downbeats when alert
    if (this.smoothI > 0.6 && Math.abs(b % s.beatsPerBar) < 1e-6) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(98, time);
      o.frequency.exponentialRampToValueAtTime(55, time + 0.3);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(0.5, time + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.45);
      o.connect(g).connect(this.percBus);
      o.start(time); o.stop(time + 0.5);
    }
  }

  private voice(kind: Song['voice'], bus: AudioNode, t: number, f: number, dur: number) {
    const ctx = this.a.ctx;
    if (kind === 'musicbox' || kind === 'celesta') {
      bell(ctx, bus, f * (kind === 'musicbox' ? 2 : 1), t, Math.max(0.8, dur * 1.6), kind === 'musicbox' ? 0.35 : 0.45);
    } else {
      // pizzicato strings: filtered saw pluck
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(f * 6, t);
      lp.frequency.exponentialRampToValueAtTime(f * 1.2, t + 0.25);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(0.6, dur + 0.25));
      o.connect(lp).connect(g).connect(bus);
      o.start(t); o.stop(t + 0.7);
      bell(ctx, bus, f * 2, t, 0.6, 0.12);
    }
  }

  private pad(t: number, root: number, q: keyof typeof CHORD_INTERVALS, dur: number) {
    const ctx = this.a.ctx;
    for (const iv of CHORD_INTERVALS[q]) {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midiHz(root + 12 + iv);
        o.detune.value = det;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 900;
        lp.Q.value = 0.5;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.06, t + Math.min(0.6, dur * 0.3));
        g.gain.setValueAtTime(0.06, t + dur * 0.8);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.4);
        o.connect(lp).connect(g).connect(this.padBus);
        o.start(t); o.stop(t + dur + 0.5);
      }
    }
  }

  private bass(t: number, root: number, dur: number) {
    const ctx = this.a.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = midiHz(root);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.2);
    o.connect(g).connect(this.padBus);
    o.start(t); o.stop(t + dur + 0.3);
  }
}

export let audio: AudioEngine;
export function initAudio() {
  audio = new AudioEngine();
  return audio;
}

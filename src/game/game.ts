// A single mission in progress.

import * as THREE from 'three';
import type { Renderer } from '../core/renderer';
import type { Input } from '../core/input';
import { audio } from '../core/audio';
import { settings } from '../core/settings';
import type { ClueDef, Ledger, LevelDef } from '../levels/types';
import { Level } from '../world/level';
import { F } from '../world/physics';
import { lightLevelAt } from '../world/lights';
import { Player, BOO } from './player';
import { NPC } from './npc';
import type { Noise, NoiseKind } from './events';
import type { Disturbed, GameCtx, PlayerState } from './context';
import { Abilities, type AbilityId } from './abilities';
import {
  ChimneyExit, ClueItem, ContainerClue, CandyBowl, DoorInteract, HideSpot, Interactable,
  LampSwitch, NoteClue, PetTalk, SightToy, SleepListen, Throwable,
} from './interact';
import { preloadModels } from '../core/assets';

export interface GameUI {
  inspect(d: { title: string; text: string; object?: THREE.Object3D; category: string }, onClose: () => void): void;
  note(d: { title: string; body: string; paper: string }, onClose: () => void): void;
  isModalOpen(): boolean;
}

export interface Hud {
  update(g: Game, dt: number): void;
  toast(text: string, kind?: string): void;
  subtitle(speaker: string, text: string, seconds: number, color?: string): void;
  flashSlot(i: number): void;
  clueFound(c: ClueDef): void;
  hint(text: string | null): void;
}

export interface GameEvents {
  onEnd(result: MissionResult): void;
  onReport(g: Game): void;
  onPause(g: Game): void;
}

export interface MissionResult {
  outcome: 'report' | 'caught' | 'timeout';
  caughtBy?: string;
  ledger?: Ledger;
  wish?: string;
  stats: Game['stats'];
  time: number;
  clues: string[];
}

export class Game implements GameCtx {
  level: Level;
  player!: Player;
  npcs: NPC[] = [];
  abilities!: Abilities;
  interactables: Interactable[] = [];
  throwables: Throwable[] = [];
  playerVis = 0;
  /** visibility ignoring Fade — cats can see spirits */
  playerVisSpirit = 0;
  lightLevel = 0;
  playerState: PlayerState = { invisible: false, morphed: false, hiddenSpot: false, inBox: false, inCloud: false, sight: false };
  time = 0;
  detection = 0;
  found: { clue: ClueDef; t: number }[] = [];
  focus: Interactable | null = null;
  focusBlocked: string | null = null;
  holdProgress = 0;
  carrying: Throwable | null = null;
  hiding: HideSpot | null = null;
  private hideReturn: THREE.Vector3 | null = null;
  private hideYaw = 0;
  private hidePitch = 0;
  private disturbedList: Disturbed[] = [];
  private mistClouds: { pos: THREE.Vector3; t: number }[] = [];
  private perceiveTimer = 0;
  private lightTimer = 0;
  ended = false;
  paused = false;
  private convoDone = new Set<string>();
  private convoNext = new Map<string, number>();
  private convoPlays = new Map<string, number>();
  private activeConvo: { def: LevelDef['conversations'][number]; line: number; t: number; heard: boolean } | null = null;
  stats = { spotted: 0, misted: 0, mist: 0, spells: 0, candy: 0, broken: 0, lightsOut: 0, maxDetection: 0, pets: 0 };
  private anims: { f: (t: number) => void; t: number; dur: number }[] = [];
  private heartbeat = 0;
  private catchFlash = 0;
  showCones = settings.showVisionCones;
  tutorialStep = 0;
  flags = new Set<string>();
  private intro = 2.2;
  private boxMesh: THREE.Object3D | null = null;
  private wornBox: HideSpot | null = null;
  private hideWitnessed = false;
  private boxSince = 0;
  private moonStrength = 0.35;
  private lastChime = -1;

  constructor(
    public def: LevelDef,
    public renderer: Renderer,
    public input: Input,
    public ui: GameUI,
    public hud: Hud,
    public events: GameEvents,
    public loadout: [AbilityId, AbilityId],
  ) {
    this.level = new Level(def);
  }

  get scene() { return this.level.scene; }
  get world() { return this.level.world; }
  get nav() { return this.level.nav; }
  get fx() { return this.level.fx; }

  async load(onProgress: (p: number, label: string) => void) {
    onProgress(0.05, 'Carving the pumpkins…');
    await preloadModels(['characters/advancedCharacter.gltf']);
    await this.level.load(this.renderer.shadowMapSize, (p) => onProgress(0.05 + p * 0.6, 'Draping the cobwebs…'));
    const def = this.def;
    this.player = new Player(this.world, this.input, {
      noise: (pos, r, kind) => this.noise(pos, r, kind, true),
      creakAt: (x, z) => (def.creaks ?? []).some(([cx, cz]) => Math.hypot(cx - x, cz - z) < 0.45),
    });
    this.scene.add(this.player.camera);
    this.player.spawn(def.player.x, def.player.z, def.player.rot);
    onProgress(0.7, 'Waking up the household…');
    for (const nd of def.npcs) {
      const n = new NPC(nd, this);
      await n.init();
      this.npcs.push(n);
    }
    onProgress(0.85, 'Hiding the clues in the shadows…');
    this.abilities = new Abilities(this, this.loadout);
    this.buildInteractables();
    this.renderer.setScene(this.scene, this.player.camera);
    this.renderer.stealth.set('uFade', 1);
    // ghostly puff: drifting down the chimney
    const [cx, , cz] = def.chimney;
    this.fx.smoke.emit({ pos: new THREE.Vector3(cx, 0.6, cz), count: 30, posJitter: 0.8, spread: 1.2, life: [1.2, 2.2], size: [0.4, 0.8], endSize: 2.5, color: 0x6a6080, alpha: 0.6 });
    this.fx.burst(new THREE.Vector3(cx, 0.8, cz), [0x9dff7a, 0xbff6ff, 0xffffff], 40, 2);
    // the soot cloud from the chimney hides the Boo for a few seconds
    this.addMistCloud(new THREE.Vector3(def.player.x, 0, def.player.z), 7);
    onProgress(1, 'Ready');
  }

  private buildInteractables() {
    const def = this.def;
    for (const c of def.clues) {
      const s = c.source;
      if (s.kind === 'item') {
        const spot = s.spots[(Math.random() * s.spots.length) | 0];
        this.interactables.push(new ClueItem(c, spot, this));
      } else if (s.kind === 'note') {
        const spot = s.spots[(Math.random() * s.spots.length) | 0];
        this.interactables.push(new NoteClue(c, spot, this));
      } else if (s.kind === 'container') {
        const p = this.level.propById.get(s.propId);
        const label = /desk/i.test(s.propId) ? 'the desk drawer' : /night/i.test(s.propId) ? 'the nightstand' : /closet|wardrobe/i.test(s.propId) ? 'the wardrobe' : /fridge/i.test(s.propId) ? 'the fridge' : /trash/i.test(s.propId) ? 'the bin' : /box/i.test(s.propId) ? 'the toy box' : 'the drawers';
        if (p) this.interactables.push(new ContainerClue(c, s.propId, this, label));
      } else if (s.kind === 'sleeptalk') {
        const n = this.npcs.find((x) => x.def.id === s.npc);
        if (n) this.interactables.push(new SleepListen(n, c));
      }
    }
    // decoy containers with nothing inside (searching is a risk/reward)
    for (const p of this.level.props) {
      if (!p.def.id) continue;
      if (this.interactables.some((i) => i instanceof ContainerClue && i.propId === p.def.id)) continue;
      if (/drawer|nightstand|dresser|cabinet/i.test(p.def.id) && !this.def.hides.some((h) => h.propId === p.def.id)) {
        this.interactables.push(new ContainerClue(null, p.def.id, this, /night/i.test(p.def.id) ? 'the nightstand' : 'the drawers'));
      }
    }
    for (const l of this.level.lights) if (l.def.switchable) this.interactables.push(new LampSwitch(l));
    for (const d of this.level.doors) this.interactables.push(new DoorInteract(d));
    for (const h of def.hides) this.interactables.push(new HideSpot(h, this));
    for (const s of def.sightToys) this.interactables.push(new SightToy(s, this));
    for (const c of def.candy) this.interactables.push(new CandyBowl(c, this));
    for (const t of def.throwables) {
      const th = new Throwable(t, this);
      this.throwables.push(th);
      this.interactables.push(th);
    }
    for (const n of this.npcs) if (n.def.talk) this.interactables.push(new PetTalk(n));
    this.interactables.push(new ChimneyExit(this));
  }

  // ------------------------------------------------------------------ ctx API

  noise(pos: THREE.Vector3, radius: number, kind: NoiseKind, byPlayer = false, source?: string) {
    const n: Noise = { pos, radius, kind, byPlayer, t: this.time, source };
    for (const npc of this.npcs) npc.hear(n);
    if (byPlayer) this.lastNoise = { r: radius, t: this.time };
  }
  lastNoise = { r: 0, t: -10 };

  sound(name: string, pos: THREE.Vector3, volume = 1) {
    audio.play(name, { pos, volume });
  }

  subtitle(npc: NPC | { name: string; pos?: THREE.Vector3 }, text: string, seconds?: number) {
    if (!text) return;
    const pos = npc instanceof NPC ? npc.pos : npc.pos;
    const d = pos ? pos.distanceTo(this.player.pos) : 0;
    const inRange = d < 12 || (this.abilities?.active === 'sight' && this.abilities.sightToy && pos && pos.distanceTo(this.abilities.sightToy.pos) < 10);
    if (!inRange) return;
    const sec = seconds ?? Math.min(6, 1.6 + text.length * 0.045);
    if (npc instanceof NPC && npc.isHuman) audio.babble(npc.body.headWorld(), sec * 0.8, npc.def.voice ?? 1, 0.1);
    this.hud.subtitle(npc.name, text, sec, npc instanceof NPC ? colorFor(npc.def.id) : '#ffd36e');
  }

  onSpotted(npc: NPC) {
    this.stats.spotted++;
    audio.play('music/spotted', { bus: 'music', volume: 0.5, vary: 0 });
    audio.heartbeat(0.6);
    // pets that raise alarms bring the humans
    if (npc.def.raisesAlarm) {
      for (const n of this.npcs) if (n !== npc && n.isHuman) n.investigate(npc.pos.clone(), `What is it, ${npc.name}?`);
    }
    this.flags.add('spotted');
  }

  onCaught(npc: NPC) {
    if (this.ended) return;
    this.detection = 100;
    this.end('caught', npc.name);
  }

  fixThing(npc: NPC, f: { kind: string; ref: unknown; pos: THREE.Vector3 }) {
    if (f.kind === 'lamp') {
      const l = f.ref as import('../world/lights').LightSource;
      l.toggle(true);
      audio.play('sfx/lamp_switch', { pos: l.pos, volume: 0.6 });
    } else if (f.kind === 'item') {
      (f.ref as Disturbed).fix();
      audio.play('sfx/cloth', { pos: f.pos, volume: 0.4 });
    }
    void npc;
  }

  disturbed() { return this.disturbedList; }
  addDisturbed(d: Disturbed) { this.disturbedList.push(d); }
  removeDisturbed(d: Disturbed) { this.disturbedList = this.disturbedList.filter((x) => x !== d); }
  addMistCloud(pos: THREE.Vector3, t: number) { this.mistClouds.push({ pos, t }); }

  groundAt(p: THREE.Vector3) {
    return this.world.groundHeight(p.x, p.z, 0.1, p.y + 0.3, 0.3).y;
  }

  toast(text: string, kind?: string) { this.hud.toast(text, kind); }

  animate(f: (t: number) => void, dur: number) { this.anims.push({ f, t: 0, dur }); }

  cluesFound() { return this.found.length; }

  canAct() {
    return !this.paused && !this.ended && !this.ui.isModalOpen() && !this.hiding && this.intro <= 0;
  }

  humanWatching() {
    return this.npcs.some((n) => n.isHuman && n.seeing > 0.05 && n.state !== 'sleep');
  }

  focusedSightToy(): SightToy | null {
    const cam = this.player.camera;
    const dir = this.player.lookDir();
    let best: SightToy | null = null;
    let bestD = Infinity;
    for (const i of this.interactables) {
      if (!(i instanceof SightToy)) continue;
      const to = i.pos.clone().sub(cam.position);
      const d = to.length();
      if (d > i.reach) continue;
      const dot = to.normalize().dot(dir);
      if (dot < 0.97 - 0.05 / Math.max(1, d)) continue;
      if (d < bestD) { best = i; bestD = d; }
    }
    return best;
  }

  revealCluesNear(p: THREE.Vector3, r: number) {
    for (const i of this.interactables) {
      if (!i.glint || !i.enabled) continue;
      if (i.pos.distanceTo(p) > r) continue;
      this.fx.sparkle.emit({ pos: i.pos, count: 3, posJitter: 0.3, spread: 0.3, life: [0.6, 1.1], size: [0.06, 0.1], color: [0x9dff7a, 0xbff6ff, 0xffffff] });
    }
  }

  foundClue(c: ClueDef) {
    if (this.found.some((f) => f.clue.id === c.id)) return;
    this.found.push({ clue: c, t: this.time });
    audio.play('music/clue', { bus: 'music', volume: 0.45, vary: 0 });
    this.hud.clueFound(c);
    this.flags.add('clue');
    if (this.found.length === this.def.clues.length) this.toast('Every clue found! Float back up the chimney to file your report.', 'gold');
    else if (this.found.length === this.def.minCluesForReport) this.toast('Enough evidence to report — but more clues mean a surer verdict.', 'gold');
  }

  pickUp(t: Throwable) {
    if (this.carrying) return;
    this.carrying = t;
    t.state = 'carried';
    t.enabled = false;
    this.player.carryAnchor.attach(t.mesh);
    t.mesh.position.set(0, 0, 0);
    t.mesh.rotation.set(0.3, 0.4, 0);
    audio.play('sfx/pickup', { volume: 0.5 });
    if (t.disturbed && t.disturbed.kind === 'moved') { this.removeDisturbed(t.disturbed); t.disturbed = null; }
    this.flags.add('pickup');
  }

  talkToPet(n: NPC) {
    if (this.humanWatching()) return;
    if (this.carrying?.def.kind === 'treat' && n.def.treat && !n.befriended) {
      const t = this.carrying;
      this.carrying = null;
      this.scene.remove(t.mesh);
      t.state = 'broken';
      n.befriended = true;
      n.state = 'befriended';
      n.suspicion = 0;
      this.stats.pets++;
      audio.animal(n.def.kind === 'dog' ? 'bark' : 'purr', n.body.headWorld(), 0.4);
      this.fx.burst(n.body.headWorld(), [0xff8fa3, 0xffffff, 0xffd36e], 30, 1.2);
      this.fx.hearts.emit({ pos: n.body.headWorld(), count: 8, posJitter: 0.3, vel: new THREE.Vector3(0, 0.6, 0), spread: 0.4, life: [1.2, 2], size: [0.08, 0.14], color: [0xff6b8a, 0xff8fa3], spin: 0.5 });
      this.subtitle({ name: n.name, pos: n.pos }, n.def.kind === 'dog' ? '*happy tail thumping* You’re a ghost AND you have biscuits? Best night ever. I won’t bark, promise.' : '*purrs* Fine, little spirit. You may haunt here.', 5);
      return;
    }
    const lines = n.def.talk ?? [];
    if (!lines.length) return;
    n.talkedTo = true;
    if (n.def.kind === 'cat') audio.animal('purr', n.body.headWorld(), 0.4);
    let t = 0;
    lines.forEach((line, i) => {
      window.setTimeout(() => {
        if (this.ended) return;
        this.hud.subtitle(n.name, line, Math.min(6, 2 + line.length * 0.045), colorFor(n.def.id));
        if (i === lines.length - 1) {
          const clue = this.def.clues.find((c) => c.source.kind === 'talk' && c.source.npc === n.def.id);
          if (clue) window.setTimeout(() => this.foundClue(clue), 1200);
        }
      }, t * 1000);
      t += Math.min(6, 2 + line.length * 0.045) + 0.2;
    });
  }

  listenSleep(n: NPC, c: ClueDef) {
    const lines = (c.source as Extract<ClueDef['source'], { kind: 'sleeptalk' }>).lines;
    let t = 0;
    lines.forEach((line, i) => {
      window.setTimeout(() => {
        if (this.ended || n.state !== 'sleep') return;
        this.hud.subtitle(`${n.name} (asleep)`, line, 3.2, colorFor(n.def.id));
        if (i === lines.length - 1) window.setTimeout(() => this.foundClue(c), 800);
      }, t * 1000);
      t += 3.3;
    });
  }

  onNpcMisted(n: NPC) {
    this.flags.add('misted');
    if (n.isHuman) this.subtitle(n, ['Ooh… purple fog… so… sleepy…', 'Who turned on… the smoke machine…?', 'Five more minutes, Mum…', 'Is that… dry ice…? Zzz…'][(Math.random() * 4) | 0], 2.5);
  }

  enterHide(h: HideSpot) {
    if (this.carrying) { this.toast('Put down what you’re carrying first.', 'muted'); return; }
    if (h.def.kind === 'box') {
      // wear the box!
      this.hiding = null;
      this.playerState.inBox = true;
      this.player.hideBox = true;
      this.wornBox = h;
      this.boxSince = this.time;
      h.enabled = false;
      if (h.mesh) h.mesh.visible = false;
      this.player.crouched = true;
      this.player.pos.set(h.pos.x, this.player.pos.y, h.pos.z);
      this.toast('You are a box. Boxes are not haunted. Probably. Move slowly — [E] to climb out.');
      audio.play('sfx/cloth', { volume: 0.6 });
      this.flags.add('hide');
      return;
    }
    this.hiding = h;
    this.hideWitnessed = this.npcs.some((n) => n.isHuman && n.seeing > 0.12 && (n.state === 'alert' || n.state === 'search' || n.state === 'investigate' || n.suspicion > 0.5));
    if (this.hideWitnessed) this.toast('They saw where you went… if they come close, you’re done for.', 'muted');
    this.hideReturn = this.player.pos.clone();
    // the Boo's body is now at the hiding spot (for hearing, smell and bumping)
    this.player.pos.set(h.anchor.x, this.player.pos.y, h.anchor.z);
    this.hideYaw = h.lookYaw;
    this.hidePitch = 0;
    this.playerState.hiddenSpot = true;
    this.player.viewmodel.visible = false;
    audio.play(h.def.kind === 'closet' ? 'sfx/door_open' : h.def.kind === 'pumpkins' ? 'sfx/soft' : 'sfx/cloth', { volume: 0.5 });
    this.noise(this.player.pos.clone(), 1.5, 'search', true);
    this.flags.add('hide');
  }

  exitHide() {
    if (!this.hiding) return;
    const h = this.hiding;
    this.hiding = null;
    this.playerState.hiddenSpot = false;
    this.player.viewmodel.visible = true;
    if (this.hideReturn) this.player.pos.copy(this.hideReturn);
    audio.play(h.def.kind === 'closet' ? 'sfx/door_close' : 'sfx/cloth', { volume: 0.5 });
    this.input.clear();
  }

  openReport() {
    if (this.ended) return;
    this.events.onReport(this);
  }

  submitReport(wish: string, ledger: Ledger) {
    this.end('report', undefined, wish, ledger);
  }

  end(outcome: MissionResult['outcome'], caughtBy?: string, wish?: string, ledger?: Ledger) {
    if (this.ended) return;
    this.ended = true;
    this.abilities.endActive();
    this.events.onEnd({ outcome, caughtBy, wish, ledger, stats: { ...this.stats }, time: this.time, clues: this.found.map((f) => f.clue.id) });
  }

  // ------------------------------------------------------------------ update

  update(dt: number) {
    if (this.paused) return;
    dt = Math.min(dt, 1 / 20);
    const inp = this.input;
    this.time += dt;
    if (this.intro > 0) {
      this.intro -= dt;
      this.renderer.stealth.set('uFade', Math.max(0, this.intro / 2.2) ** 2);
    }
    for (let i = this.anims.length - 1; i >= 0; i--) {
      const a = this.anims[i];
      a.t += dt;
      a.f(Math.min(1, a.t / a.dur));
      if (a.t >= a.dur) this.anims.splice(i, 1);
    }

    const modal = this.ui.isModalOpen();
    const canMove = !modal && !this.ended && !this.hiding && this.abilities.active !== 'possess' && this.abilities.active !== 'sight' && this.intro <= 0.6;

    // look
    if (!modal && !this.ended) {
      if (this.hiding) {
        this.hideYaw -= inp.mouseDX * 0.0022;
        this.hidePitch = THREE.MathUtils.clamp(this.hidePitch - inp.mouseDY * 0.0022, -0.5, 0.4);
        const lim = 0.9;
        const d = angleDiff(this.hideYaw, this.hiding.lookYaw);
        if (Math.abs(d) > lim) this.hideYaw = this.hiding.lookYaw + Math.sign(d) * lim;
      } else if (!this.abilities.active || this.abilities.active === 'fade') {
        this.player.look(dt);
      }
    }

    // pause / journal
    if (inp.wasPressed('Tab') || inp.wasPressed('Escape') || inp.wasPressed('KeyJ')) {
      if (!modal && !this.ended) {
        if (this.abilities.active === 'sight' && inp.wasPressed('Escape')) { /* handled by sight */ } else this.events.onPause(this);
      }
    }
    // [3]: jump to report once every clue is found
    if (inp.wasPressed('Digit3') && this.found.length >= this.def.clues.length && this.canAct()) this.openReport();

    this.player.update(dt, canMove);
    if (this.intro > 0) {
      // drifting down the chimney: the camera sinks out of the flue
      const k = Math.max(0, this.intro - 0.3) / 1.9;
      this.player.camera.position.y += k * k * 1.6;
      if (Math.random() < dt * 20) this.fx.smoke.emit({ pos: this.player.camera.position.clone().add(new THREE.Vector3(0, 0.3, 0)), posJitter: 0.5, vel: new THREE.Vector3(0, -0.4, 0), spread: 0.3, life: [0.6, 1.2], size: [0.3, 0.5], endSize: 2, color: 0x4a4258, alpha: 0.5 });
    }
    if (this.hiding) {
      const cam = this.player.camera;
      cam.position.copy(this.hiding.anchor);
      cam.rotation.set(this.hidePitch, this.hideYaw, 0);
      if (inp.anyPressed('KeyE', 'Space') && !modal) this.exitHide();
    }
    this.abilities.update(dt);

    // carried item
    if (this.carrying && this.canAct()) {
      if (inp.wasPressed('Mouse0')) {
        const t = this.carrying;
        this.carrying = null;
        const from = new THREE.Vector3();
        t.mesh.getWorldPosition(from);
        t.throw(from, this.player.lookDir(), 7.5);
        this.player.cast();
        audio.whoosh(0.3, true, 0.12);
        this.flags.add('throw');
      } else if (inp.wasPressed('Mouse2') || inp.wasPressed('KeyG')) {
        const t = this.carrying;
        this.carrying = null;
        const at = this.player.pos.clone().addScaledVector(this.player.forward(), 0.45).setY(this.player.pos.y + 0.4);
        t.drop(at);
      }
    }
    for (const t of this.throwables) t.update(dt);

    // focus & interact
    this.updateFocus();
    if (this.canAct() && this.focus && !this.focusBlocked && !this.playerState.inBox) {
      const f = this.focus;
      if (f.verb() === 'E') {
        if (f.hold > 0) {
          if (inp.isDown('KeyE')) {
            this.holdProgress += dt / f.hold;
            if (this.holdProgress >= 1) { this.holdProgress = 0; f.use(this); }
          } else this.holdProgress = 0;
        } else if (inp.wasPressed('KeyE')) f.use(this);
      }
    } else {
      this.holdProgress = 0;
    }
    if (this.playerState.inBox && inp.wasPressed('KeyE') && this.canAct() && this.time - this.boxSince > 0.25) {
      this.playerState.inBox = false;
      this.player.hideBox = false;
      const h = this.wornBox;
      if (h) {
        h.enabled = true;
        h.pos.set(this.player.pos.x, 0.3, this.player.pos.z);
        if (h.mesh) {
          h.mesh.position.set(this.player.pos.x, this.player.pos.y, this.player.pos.z);
          h.mesh.rotation.y = this.player.yaw;
          h.mesh.visible = true;
        }
        // step out beside the box
        this.player.pos.addScaledVector(this.player.forward(), 0.45);
        this.world.moveCylinder(this.player.pos, BOO.radius, this.player.height, 0.3);
      }
      this.wornBox = null;
      audio.play('sfx/cloth', { volume: 0.5 });
    }

    // world & AI
    this.level.update(dt, this.time, this.player.camera.position);
    for (const c of this.level.clocks) {
      const [h1, h2] = c.userData.hands as THREE.Object3D[];
      const [hh, mm] = this.clock();
      h1.rotation.z = -(mm / 60) * Math.PI * 2;
      h2.rotation.z = -((hh % 12) / 12 + mm / 720) * Math.PI * 2;
    }
    this.updateVisibility(dt);
    this.perceiveTimer -= dt;
    if (this.perceiveTimer <= 0) {
      this.perceiveTimer = 0.1;
      for (const n of this.npcs) n.perceive();
    }
    for (const n of this.npcs) n.update(dt, this.time);
    for (const i of this.interactables) if (i instanceof PetTalk || i instanceof SleepListen || i instanceof DoorInteract) i.syncPos();
    // hiding right under someone's nose doesn't work
    if (this.hiding && this.hideWitnessed) {
      for (const n of this.npcs) {
        if (!n.isHuman || (n.state !== 'alert' && n.state !== 'search' && n.state !== 'investigate')) continue;
        if (Math.hypot(n.pos.x - this.hiding.anchor.x, n.pos.z - this.hiding.anchor.z) < 1.25) {
          n.say(this.hiding.def.kind === 'closet' ? 'Aha! A ghost in the closet — I KNEW it!' : this.hiding.def.kind === 'underBed' ? 'Gotcha! The monster under the bed!' : this.hiding.def.kind === 'pumpkins' ? 'That pumpkin has a SHEET on it!' : 'Peekaboo, little spook!', true);
          this.onCaught(n);
          break;
        }
      }
    }
    this.updateMotionLights();
    this.updateConversations(dt);
    this.updateDetection(dt);
    this.updateBoxMesh();
    for (let i = this.mistClouds.length - 1; i >= 0; i--) {
      this.mistClouds[i].t -= dt;
      if (this.mistClouds[i].t <= 0) this.mistClouds.splice(i, 1);
    }
    // clue glints so players can spot evidence
    if (Math.random() < dt * 3) {
      for (const i of this.interactables) {
        if (!i.glint || !i.enabled) continue;
        if (i.pos.distanceTo(this.player.pos) > 6) continue;
        if (Math.random() < 0.35) this.fx.light.emit({ pos: i.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.2, 0.05, (Math.random() - 0.5) * 0.2)), life: [0.5, 0.9], size: [0.05, 0.09], endSize: 0.2, color: 0xffc070, alpha: 0.9 });
      }
    }

    // the clock tolls on the half hour
    const [ch, cm] = this.clock();
    const slot = ch * 2 + (cm >= 30 ? 1 : 0);
    if (this.lastChime < 0) this.lastChime = slot;
    if (slot !== this.lastChime) {
      this.lastChime = slot;
      const n = cm >= 30 ? 1 : ((ch % 12) || 12);
      for (let i = 0; i < Math.min(n, 12); i++) window.setTimeout(() => audio.play('sfx/bong', { volume: 0.35, rate: 0.8 }), i * 900);
      const left = this.def.minutes * 60 - this.time;
      if (left < this.def.minutes * 60 * 0.3) this.toast(`🕰️ ${ch % 12 || 12}:${String(cm).padStart(2, '0')} — the witching hour is getting closer!`, 'gold');
    }
    // time limit
    if (this.time >= this.def.minutes * 60 && !this.ended) this.end('timeout');

    // audio listener + music
    const fwd = this.player.lookDir();
    audio.setListener(this.player.camera.position, fwd);
    const maxAware = Math.max(0, ...this.npcs.map((n) => (n.state === 'alert' ? 1 : n.state === 'search' ? 0.75 : n.awareness * 0.6)));
    audio.music.intensity = Math.max(maxAware, this.detection / 100);
    if (this.detection > 35) {
      this.heartbeat -= dt;
      if (this.heartbeat <= 0) { audio.heartbeat(0.25 + this.detection / 250); this.heartbeat = 1.2 - this.detection / 140; }
    }

    // screen effects
    const st = this.renderer.stealth;
    const anyAlert = this.npcs.some((n) => n.state === 'alert' && n.seeing > 0.05);
    st.set('uAlert', THREE.MathUtils.lerp(st.get('uAlert'), anyAlert ? 1 : this.detection > 60 ? 0.5 : 0, Math.min(1, dt * 4)));
    st.set('uSuspicion', THREE.MathUtils.lerp(st.get('uSuspicion'), Math.min(1, maxAware), Math.min(1, dt * 3)));
    this.catchFlash = Math.max(0, this.catchFlash - dt);
    st.set('uHurt', this.catchFlash * 0.5);

    this.hud.update(this, dt);
    this.tutorialTick();
  }

  clock(): [number, number] {
    const [h0, m0] = this.def.clockStart;
    const [h1, m1] = this.def.clockEnd;
    const span = (h1 * 60 + m1) - (h0 * 60 + m0);
    const mins = h0 * 60 + m0 + span * Math.min(1, this.time / (this.def.minutes * 60));
    return [Math.floor(mins / 60) % 24, Math.floor(mins % 60)];
  }

  private updateFocus() {
    this.focus = null;
    this.focusBlocked = null;
    if (!this.canAct() && !this.ui.isModalOpen()) return;
    if (this.abilities.active === 'possess' || this.abilities.active === 'sight') return;
    const cam = this.player.camera.position;
    const dir = this.player.lookDir();
    let best: Interactable | null = null;
    let bestScore = Infinity;
    for (const i of this.interactables) {
      if (!i.enabled) continue;
      const to = i.pos.clone().sub(cam);
      const along = to.dot(dir);
      if (along < 0 || along > i.reach) continue;
      const perp = to.clone().sub(dir.clone().multiplyScalar(along)).length();
      if (perp > i.radius) continue;
      if (i instanceof SightToy) {
        if (!this.abilities.keyFor('sight')) continue;
      }
      // occlusion: the world shouldn't be in front of it
      const hit = this.world.raycast(cam, dir, along, F.SIGHT, (c) => c.owner === (i as any).door);
      if (hit && hit.dist < along - i.radius - 0.05) continue;
      const score = along + perp * 3;
      if (score < bestScore) { bestScore = score; best = i; }
    }
    if (best) {
      const p = best.prompt(this);
      const b = best.blocked(this);
      if (p || b) {
        this.focus = best;
        this.focusBlocked = p ? b : b;
        if (p && !b) this.focusBlocked = null;
        if (!p) this.focusBlocked = b;
      }
    }
  }

  private updateVisibility(dt: number) {
    const ps = this.playerState;
    ps.invisible = this.abilities.active === 'fade';
    ps.morphed = this.abilities.active === 'possess';
    ps.sight = this.abilities.active === 'sight';
    ps.inCloud = this.mistClouds.some((c) => Math.hypot(c.pos.x - this.player.pos.x, c.pos.z - this.player.pos.z) < 1.6);
    this.lightTimer -= dt;
    if (this.lightTimer <= 0) {
      this.lightTimer = 0.12;
      // flashlights count as light too
      let extra = 0;
      for (const n of this.npcs) {
        const fl = n.body.flashlight;
        if (!fl) continue;
        const fp = new THREE.Vector3();
        fl.getWorldPosition(fp);
        const tp = new THREE.Vector3();
        fl.target.getWorldPosition(tp);
        const to = this.player.chest.sub(fp);
        const d = to.length();
        if (d < 9 && to.normalize().dot(tp.sub(fp).normalize()) > Math.cos(0.42) && this.world.lineClear(fp, this.player.chest, F.LIGHT)) extra += 0.9 * (1 - d / 9);
      }
      this.lightLevel = lightLevelAt(this.player.chest, this.level.lights, this.world, { dir: this.level.env.moonDir, strength: this.moonStrength }, extra);
    }
    let v = THREE.MathUtils.clamp((this.lightLevel - 0.08) / 0.7, 0.06, 1);
    if (this.player.crouched) v *= 0.55;
    const sp = this.player.speed;
    v *= sp < 0.2 ? 0.75 : this.player.sprinting ? 1.35 : 1;
    this.playerVisSpirit = ps.morphed || ps.hiddenSpot ? 0 : Math.min(1, ps.inCloud ? v * 0.1 : v);
    if (ps.invisible || ps.morphed || ps.hiddenSpot) v = 0;
    if (ps.inCloud) v *= 0.1;
    if (ps.inBox) v = sp > 0.2 ? 0.22 : 0;
    if (ps.sight) v = Math.min(v, 0.6); // body left standing still in place
    this.playerVis = Math.min(1, v);
  }

  private updateMotionLights() {
    for (const l of this.level.lights) {
      if (!l.def.motion) continue;
      const d = l.pos.distanceTo(this.player.pos);
      if (d < 2.6 && this.player.speed > 0.4 && !this.playerState.invisible && !this.playerState.hiddenSpot) {
        if (l.motionTimer <= 0) audio.play('sfx/click_metal', { pos: l.pos, volume: 0.3 });
        l.motionTimer = 6;
        l.toggle(l.on); // refresh visuals
      }
    }
  }

  private updateDetection(dt: number) {
    let rising = 0;
    for (const n of this.npcs) {
      // only people fill the meter — pets and animatronics raise the alarm instead
      if (n.isHuman && (n.state === 'alert' || n.state === 'search') && n.seeing > 0.05) rising = Math.max(rising, n.seeing);
    }
    if (rising > 0) this.detection = Math.min(100, this.detection + rising * 26 * dt);
    else this.detection = Math.max(0, this.detection - (this.npcs.some((n) => n.state === 'alert' || n.state === 'search') ? 1 : 4) * dt);
    this.stats.maxDetection = Math.max(this.stats.maxDetection, this.detection);
    if (this.detection >= 100 && !this.ended) {
      const by = this.npcs.filter((n) => n.state === 'alert').sort((a, b) => b.seeing - a.seeing)[0];
      this.catchFlash = 1;
      this.end('caught', by?.name);
    }
  }

  private updateBoxMesh() {
    if (this.playerState.inBox) {
      if (!this.boxMesh) {
        const box = new THREE.Group();
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.58, 0.62), new THREE.MeshStandardMaterial({ color: 0xb0814f, roughness: 0.95 }));
        mesh.position.y = 0.29;
        const tape = new THREE.Mesh(new THREE.BoxGeometry(0.63, 0.005, 0.1), new THREE.MeshStandardMaterial({ color: 0xd8b98a }));
        tape.position.y = 0.585;
        box.add(mesh, tape);
        this.boxMesh = box;
        this.scene.add(box);
      }
      this.boxMesh.position.copy(this.player.pos);
      this.boxMesh.rotation.y = this.player.yaw;
      this.boxMesh.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
    } else if (this.boxMesh && this.boxMesh.parent) {
      this.boxMesh.visible = true;
      this.scene.remove(this.boxMesh);
      this.boxMesh = null;
    }
  }

  // ------------------------------------------------------------------ conversations

  private updateConversations(dt: number) {
    const c = this.activeConvo;
    if (!c) {
      for (const def of this.def.conversations) {
        if (this.convoDone.has(def.id) || this.time < (this.convoNext.get(def.id) ?? def.at)) continue;
        const who = def.who.map((id) => this.npcs.find((n) => n.def.id === id)).filter(Boolean) as NPC[];
        if (who.some((n) => !n.calm || n.state === 'sleep')) continue;
        this.convoDone.add(def.id);
        this.activeConvo = { def, line: -1, t: 0, heard: false };
        const spot = new THREE.Vector3(def.where[0], 0, def.where[1]);
        who.forEach((n, i) => {
          const a = (i / Math.max(1, who.length)) * Math.PI * 2;
          const p = who.length > 1 ? spot.clone().add(new THREE.Vector3(Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55)) : spot.clone();
          n.state = 'converse';
          n.convoSpot = p;
          n.convoFace = who.length > 1 ? spot : null;
          n.goTo(p);
        });
        break;
      }
      return;
    }
    const who = c.def.who.map((id) => this.npcs.find((n) => n.def.id === id)!) as NPC[];
    // interrupted?
    if (who.some((n) => n.state !== 'converse')) {
      for (const n of who) if (n.state === 'converse') n.resume();
      this.activeConvo = null;
      this.convoDone.delete(c.def.id); // try again later
      this.convoNext.set(c.def.id, this.time + 40);
      return;
    }
    const gathered = who.every((n) => n.convoSpot && n.pos.distanceTo(n.convoSpot) < 0.6);
    if (!gathered) {
      c.t += dt;
      if (c.t > 25) { who.forEach((n) => n.resume()); this.activeConvo = null; }
      return;
    }
    c.t -= dt;
    if (c.t <= 0) {
      c.line++;
      if (c.line >= c.def.lines.length) {
        who.forEach((n) => n.resume());
        if (c.heard && c.def.clue) {
          const clue = this.def.clues.find((x) => x.id === c.def.clue);
          if (clue) this.foundClue(clue);
        } else if (c.def.clue && !c.heard) {
          // missed it — they’ll talk about it again later (a couple of times)
          const plays = (this.convoPlays.get(c.def.id) ?? 0) + 1;
          this.convoPlays.set(c.def.id, plays);
          if (plays < 3) {
            this.convoDone.delete(c.def.id);
            this.convoNext.set(c.def.id, this.time + 110);
          }
        }
        this.activeConvo = null;
        return;
      }
      const [id, text] = c.def.lines[c.line];
      const sp = who.find((n) => n.def.id === id) ?? who[0];
      const d = sp.pos.distanceTo(this.player.pos);
      const muffled = !this.world.lineClear(sp.eye(), this.player.eyePos, F.SOUND);
      const sightNear = this.abilities.active === 'sight' && this.abilities.sightToy && this.abilities.sightToy.pos.distanceTo(sp.pos) < 8;
      const hear = d < (muffled ? 5 : 9) || sightNear;
      const sec = Math.min(6.5, 2 + text.length * 0.05);
      if (hear) {
        c.heard = c.heard || c.line >= c.def.lines.length - 2 || c.line > 0;
        audio.babble(sp.body.headWorld(), sec * 0.8, sp.def.voice ?? 1, 0.12);
        this.hud.subtitle(sp.name, muffled && !sightNear ? `(muffled) ${text}` : text, sec, colorFor(sp.def.id));
      }
      c.t = sec + 0.3;
    }
  }

  private tutorialTick() {
    const steps = this.def.tutorial;
    if (!steps) return;
    const s = steps[this.tutorialStep];
    if (!s) { this.hud.hint(null); return; }
    this.hud.hint(s.text);
    const done = (() => {
      switch (s.until) {
        case 'move': return this.player.pos.distanceTo(new THREE.Vector3(this.def.player.x, 0, this.def.player.z)) > 2;
        case 'crouch': return this.player.crouched;
        case 'jump': return this.player.pos.y > 0.3;
        case 'lamp': return this.level.lights.some((l) => l.def.switchable && !l.on);
        default: return this.flags.has(s.until);
      }
    })();
    if (done) {
      this.tutorialStep++;
      audio.play('sfx/ui_confirm', { bus: 'ui', volume: 0.4 });
    }
  }

  dispose() {
    for (const n of this.npcs) n.dispose();
    // free GPU buffers (shared model geometry simply re-uploads if reused later)
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
      for (const mat of mats) mat.dispose();
    });
    this.scene.clear();
  }
}

const PALETTE = ['#ffd36e', '#9be7ff', '#ff8fa3', '#b6ffb0', '#d6b8ff', '#ffb36b'];
export function colorFor(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

function angleDiff(a: number, b: number) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export { BOO };

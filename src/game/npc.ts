// NPC brain: routines, perception (sight / hearing / smell), suspicion,
// investigation, chasing, stun, sleep, restoring lamps & doors, and barks.

import * as THREE from 'three';
import type { ActivityDef, NPCDef } from '../levels/types';
import { buildBody, type Body, type Pose } from './bodies';
import { F } from '../world/physics';
import type { Noise } from './events';
import type { GameCtx } from './context';
import { audio } from '../core/audio';

export type AIState = 'routine' | 'suspicious' | 'investigate' | 'alert' | 'search' | 'stunned' | 'sleep' | 'woken' | 'fix' | 'converse' | 'distracted' | 'befriended';

const DEFAULT_BARKS = {
  suspicious: ['Hm? What was that?', 'Did that sheet just… move?', 'Huh… cold spot.', 'Is someone there?', 'Was that a… no. Don’t be silly.'],
  alert: ['A GHOST! An actual ghost!', 'There’s something in the house!', 'Stop right there, spook!'],
  giveUp: ['Must be the wind.', 'Too many horror films tonight.', 'Just the house settling. Old houses settle.', 'I’m seeing things. Too much candy corn.'],
  lamp: ['Who blew the light out?', 'That lamp was on a minute ago…', 'Hmph. Drafty old house.'],
  broken: ['Oh no, what a mess!', 'How did that get there?', 'Who keeps leaving things on the floor?'],
};

export class NPC {
  def: NPCDef;
  body!: Body;
  pos = new THREE.Vector3();
  heading = 0;
  state: AIState = 'routine';
  suspicion = 0;
  /** 0..1 how much they currently see the player */
  seeing = 0;
  lastKnown = new THREE.Vector3();
  private path: THREE.Vector3[] = [];
  private pathIdx = 0;
  private goal: THREE.Vector3 | null = null;
  private timer = 0;
  activity: ActivityDef | null = null;
  private activityIdx = -1;
  stun = 0;
  private headYaw = 0;
  private headPitch = 0;
  private lookTarget: THREE.Vector3 | null = null;
  private barkCooldown = 0;
  private repathTimer = 0;
  speed = 0;
  pose: Pose = 'stand';
  befriended = false;
  talkedTo = false;
  fixTarget: { kind: 'lamp' | 'door' | 'item'; ref: unknown; pos: THREE.Vector3 } | null = null;
  convoSpot: THREE.Vector3 | null = null;
  convoFace: THREE.Vector3 | null = null;
  distractPos: THREE.Vector3 | null = null;
  cone!: THREE.Mesh;
  private coneMat!: THREE.MeshBasicMaterial;
  private sweep = 0;
  stuckTimer = 0;
  private lastPos = new THREE.Vector3();
  /** recently heard noises to avoid repeated reactions */
  private noticed = new WeakSet<object>();
  spottedOnce = false;
  hitByCheer = 0;
  private sleepiness = 0;
  private rootY = 0;
  private barkTimer = 0;
  private alertTime = 0;

  constructor(def: NPCDef, private ctx: GameCtx) {
    this.def = def;
  }

  /** in a routine nap (e.g. a kid in bed who isn't flagged asleep) */
  get dozing() {
    return this.state === 'routine' && this.activity?.anim === 'sleep' && this.timer >= 0;
  }

  get isHuman() { return !['dog', 'cat', 'animatronic'].includes(this.def.kind); }
  get isAnimatronic() { return this.def.kind === 'animatronic'; }
  get isPet() { return this.def.kind === 'dog' || this.def.kind === 'cat'; }
  get name() { return this.def.name; }
  get calm() { return this.state === 'routine' || this.state === 'converse' || this.state === 'sleep' || this.state === 'befriended' || this.state === 'fix' || this.state === 'distracted'; }
  get awareness() {
    if (this.state === 'alert') return 2;
    if (this.state === 'search') return 1.5;
    return Math.min(1, this.suspicion);
  }

  async init() {
    this.body = await buildBody(this.def);
    this.pos.set(this.def.start[0], 0, this.def.start[1]);
    this.lastPos.copy(this.pos);
    this.body.root.position.copy(this.pos);
    this.ctx.scene.add(this.body.root);
    // vision cone decal on the floor (like the original's detection radius)
    const range = this.sightRange;
    const fov = this.fov;
    const geo = new THREE.CircleGeometry(range, 28, -fov / 2 + Math.PI / 2, fov);
    geo.rotateX(-Math.PI / 2);
    this.coneMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.06, depthWrite: false, blending: THREE.AdditiveBlending });
    const alphaGrad = this.makeConeTexture();
    this.coneMat.map = alphaGrad;
    this.cone = new THREE.Mesh(geo, this.coneMat);
    this.cone.position.y = 0.015;
    this.cone.renderOrder = 1;
    this.ctx.scene.add(this.cone);
    if (this.def.asleep) {
      this.state = 'sleep';
      const a = this.def.activities.find((x) => x.anim === 'sleep') ?? this.def.activities[0];
      this.activity = a;
      this.pos.set(a.at[0], 0, a.at[1]);
      this.heading = THREE.MathUtils.degToRad(a.face ?? 0);
    } else {
      this.nextActivity();
    }
  }

  private makeConeTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.7, 'rgba(255,255,255,0.5)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }

  get sightRange() {
    const base = this.def.kind === 'cat' ? 7 : this.def.kind === 'dog' ? 7.5 : this.def.kind === 'animatronic' ? 3.4 : 9.5;
    return base * (this.def.sight ?? 1);
  }
  get fov() { return THREE.MathUtils.degToRad(this.def.kind === 'animatronic' ? 140 : this.isPet ? 120 : 105); }
  get walkSpeed() {
    const base = this.def.kind === 'kid' ? 0.95 : this.def.kind === 'elder' ? 0.8 : this.def.kind === 'animatronic' ? 0 : this.isPet ? 1.1 : 1.15;
    return base * (this.def.speed ?? 1);
  }
  get runSpeed() {
    const base = this.def.kind === 'kid' ? 2.4 : this.def.kind === 'elder' ? 1.7 : this.def.kind === 'animatronic' ? 0 : this.isPet ? 3.2 : 2.9;
    return base * (this.def.speed ?? 1);
  }

  eye() { return this.body.headWorld(); }
  forward() { return new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading)); }

  // ---------------------------------------------------------------- speech

  say(text: string, force = false) {
    if (!force && this.barkCooldown > 0) return;
    this.barkCooldown = 4 + Math.random() * 2;
    this.ctx.subtitle(this, text);
  }

  private bark(kind: keyof typeof DEFAULT_BARKS) {
    const list = this.def.barks?.[kind] ?? DEFAULT_BARKS[kind];
    if (this.isPet) {
      if (this.def.kind === 'dog') {
        audio.animal('bark', this.body.headWorld(), 0.8);
        if (kind === 'alert' || kind === 'suspicious') this.ctx.noise(this.pos.clone(), kind === 'alert' ? 11 : 6, 'bark', false, this.def.id);
      } else if (this.def.kind === 'cat') {
        audio.animal(kind === 'alert' ? 'hiss' : 'meow', this.body.headWorld(), 0.6);
        if (kind === 'alert') this.ctx.noise(this.pos.clone(), 6, 'hiss', false, this.def.id);
      }
      if (this.def.barks?.[kind]) this.say(list[(Math.random() * list.length) | 0]);
      return;
    }
    if (this.isAnimatronic) {
      audio.animal(kind === 'alert' ? 'shriek' : 'cackle', this.body.headWorld(), kind === 'alert' ? 0.8 : 0.4);
      if (kind === 'alert') this.ctx.noise(this.pos.clone(), 9, 'beep', false, this.def.id);
      if (this.def.barks?.[kind]) this.say(list[(Math.random() * list.length) | 0]);
      return;
    }
    audio.murmur(this.body.headWorld(), this.def.voice ?? 1, kind !== 'giveUp');
    this.say(list[(Math.random() * list.length) | 0]);
  }

  // ---------------------------------------------------------------- routine

  private nextActivity() {
    const acts = this.def.activities;
    if (!acts.length) return;
    if (this.activityIdx < 0) {
      // the first activity is authored, so missions open predictably
      this.activityIdx = 0;
      this.activity = acts[0];
      this.goTo(new THREE.Vector3(acts[0].at[0], 0, acts[0].at[1]));
      this.timer = -1;
      return;
    }
    let total = 0;
    for (const a of acts) total += a.weight ?? 1;
    let r = Math.random() * total;
    let idx = 0;
    for (let i = 0; i < acts.length; i++) {
      r -= acts[i].weight ?? 1;
      if (r <= 0) { idx = i; break; }
    }
    if (idx === this.activityIdx && acts.length > 1) idx = (idx + 1) % acts.length;
    this.activityIdx = idx;
    this.activity = acts[idx];
    this.goTo(new THREE.Vector3(this.activity.at[0], 0, this.activity.at[1]));
    this.timer = -1; // not started
  }

  goTo(p: THREE.Vector3) {
    this.goal = p.clone();
    const path = this.ctx.nav.findPath(this.pos, p);
    this.path = path ?? [p.clone()];
    this.pathIdx = 0;
    this.repathTimer = 2.5;
  }

  private arrived(eps = 0.25) {
    if (!this.goal) return true;
    const d = Math.hypot(this.pos.x - this.goal.x, this.pos.z - this.goal.z);
    if (d < eps) return true;
    // path exhausted next to a seat / bed whose centre lies inside furniture
    return this.pathIdx >= this.path.length && d < 1.7;
  }

  private followPath(dt: number, speed: number) {
    if (this.pathIdx >= this.path.length) { this.speed = 0; return; }
    const target = this.path[this.pathIdx];
    const dx = target.x - this.pos.x, dz = target.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.18) {
      this.pathIdx++;
      return;
    }
    const want = Math.atan2(dx, dz);
    this.turnTo(want, dt, 7);
    const facing = Math.cos(angleDiff(want, this.heading));
    const sp = speed * Math.max(0.15, facing);
    const step = Math.min(d, sp * dt);
    this.pos.x += (dx / d) * step;
    this.pos.z += (dz / d) * step;
    this.speed = sp;
    // doors ahead open automatically
    for (const door of this.ctx.level.doors) {
      if (door.open || door.locked) continue;
      if (door.center.distanceTo(this.pos) < 1.15) {
        door.setOpen(true, this.pos);
        this.ctx.sound('sfx/door_open', door.center, 0.5);
        this.ctx.noise(door.center.clone(), 3, 'door', false, this.def.id);
      }
    }
  }

  private turnTo(a: number, dt: number, k = 5) {
    this.heading += angleDiff(a, this.heading) * Math.min(1, k * dt);
  }

  private faceToward(p: THREE.Vector3, dt: number, k = 5) {
    this.turnTo(Math.atan2(p.x - this.pos.x, p.z - this.pos.z), dt, k);
  }

  // ---------------------------------------------------------------- perception

  /** Called ~10 Hz by the game. Returns visibility 0..1 of the player. */
  perceive(): number {
    if (this.state === 'stunned' || this.befriended || this.ctx.time < 3) return (this.seeing = 0);
    if (this.state === 'sleep' || this.dozing) return (this.seeing = 0);
    const p = this.ctx.player;
    // cats can see spirits: Fade doesn't fool them
    let pv = this.def.kind === 'cat' && this.ctx.playerState.invisible ? this.ctx.playerVisSpirit * 0.85 : this.ctx.playerVis;
    // motion sensors only trigger on movement
    if (this.isAnimatronic && p.speed < 0.3) pv = 0;
    const eye = this.eye();
    const targets = [p.chest, p.eyePos.clone()];
    let best = 0;
    // smell (dogs) — even Fade can't hide you from a good nose
    const d0 = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
    if (this.def.smell && d0 < this.def.smell && !this.ctx.playerState.morphed && !this.ctx.playerState.hiddenSpot) {
      best = Math.max(best, 0.55 * (1 - d0 / this.def.smell) + 0.25);
    }
    if (pv > 0.001) {
      for (const t of targets) {
        const to = t.clone().sub(eye);
        const dist = to.length();
        if (dist > this.sightRange) continue;
        const flat = new THREE.Vector3(to.x, 0, to.z).normalize();
        const headDir = new THREE.Vector3(Math.sin(this.heading + this.headYaw), 0, Math.cos(this.heading + this.headYaw));
        const ang = Math.acos(THREE.MathUtils.clamp(flat.dot(headDir), -1, 1));
        if (ang > this.fov / 2) continue;
        if (!this.ctx.world.lineClear(eye, t, F.SIGHT)) continue;
        const angF = ang < this.fov * 0.22 ? 1 : 0.55;
        const distF = Math.pow(1 - dist / this.sightRange, 0.6);
        // close range: even in the dark you get noticed
        const close = dist < 1.6 ? (1.6 - dist) * 0.5 : 0;
        // flashlight beam
        let torch = 0;
        if (this.body.flashlight && dist < 10 && ang < 0.45) torch = 0.8;
        best = Math.max(best, Math.min(1, (pv + torch) * angF * distF + close * Math.min(1, pv * 4 + 0.15)));
      }
    }
    this.seeing = best;
    return best;
  }

  hear(n: Noise) {
    if (this.state === 'stunned' || this.befriended && n.byPlayer) return;
    if (n.source === this.def.id) return;
    const d = n.pos.distanceTo(this.pos);
    const mult = this.def.hearing ?? 1;
    let radius = n.radius * mult;
    if (!this.ctx.world.lineClear(n.pos.clone().setY(1), this.pos.clone().setY(1), F.SOUND)) radius *= 0.55;
    if (d > radius) return;
    const loud = 1 - d / radius;
    if (this.state === 'sleep' || this.dozing) {
      this.sleepiness += loud * (n.kind === 'shatter' || n.kind === 'bark' || n.kind === 'knock' ? 1.5 : 0.5);
      if (this.sleepiness > 0.9) this.wake();
      return;
    }
    // pets barking: humans come and check where the pet is
    if ((n.kind === 'bark' || n.kind === 'hiss' || n.kind === 'beep') && this.isHuman) {
      if (this.state !== 'alert') this.investigate(n.pos, n.kind === 'bark' ? 'What is it, boy? Smell a ghost?' : n.kind === 'beep' ? 'Why is the skeleton screaming?!' : 'What’s gotten into you?');
      return;
    }
    if (this.isAnimatronic) return; // decorations don't listen
    if (this.isPet && n.kind === 'knock' && this.def.kind === 'cat') {
      this.distract(n.pos);
      return;
    }
    if (this.state === 'alert') {
      if (n.byPlayer) this.lastKnown.copy(n.pos);
      return;
    }
    const strong = n.kind === 'shatter' || n.kind === 'knock' || n.kind === 'creak' || loud > 0.55;
    if (strong) this.investigate(n.pos);
    else {
      this.suspicion = Math.min(0.95, this.suspicion + 0.18 * loud + 0.05);
      this.lookTarget = n.pos.clone();
      if (this.suspicion > 0.3 && this.state !== 'investigate') this.toSuspicious(n.pos);
    }
  }

  private wake() {
    this.sleepiness = 0;
    this.state = 'woken';
    this.timer = 7;
    this.pose = 'sitUp';
    audio.murmur(this.body.headWorld(), (this.def.voice ?? 1.4), true, 0.4);
    this.say(this.def.barks?.suspicious?.[0] ?? 'Mmh…? Is it trick-or-treat time…?', true);
  }

  investigate(p: THREE.Vector3, line?: string) {
    if (this.isAnimatronic) return;
    if (this.state === 'alert' || this.state === 'stunned' || this.befriended) return;
    if (this.state === 'sleep') { this.wake(); return; }
    this.state = 'investigate';
    this.lastKnown.copy(p);
    this.suspicion = Math.max(this.suspicion, 0.5);
    this.goTo(p);
    this.timer = 4 + Math.random() * 2;
    if (line && this.isHuman) this.say(line);
    else this.bark('suspicious');
  }

  distract(p: THREE.Vector3) {
    if (this.state === 'alert' || this.state === 'stunned') return;
    this.state = 'distracted';
    this.distractPos = p.clone();
    this.goTo(p);
    this.timer = 6;
  }

  private toSuspicious(p: THREE.Vector3) {
    if (this.state === 'suspicious' || this.state === 'investigate') return;
    this.state = 'suspicious';
    this.lastKnown.copy(p);
    this.lookTarget = p.clone();
    this.timer = 1.6;
    this.bark('suspicious');
    audio.play('sfx/suspicious', { pos: this.body.headWorld(), volume: 0.35 });
  }

  private toAlert() {
    if (this.state === 'alert') return;
    this.state = 'alert';
    this.alertTime = 0;
    this.suspicion = 1.2;
    this.spottedOnce = true;
    this.lastKnown.copy(this.ctx.player.pos);
    this.goTo(this.lastKnown);
    this.bark('alert');
    this.ctx.onSpotted(this);
  }

  stunFor(sec: number) {
    this.state = 'stunned';
    this.stun = sec;
    this.suspicion = 0;
    this.seeing = 0;
    this.path = [];
    this.speed = 0;
    this.hitByCheer++;
  }

  // ---------------------------------------------------------------- update

  update(dt: number, time: number) {
    this.barkCooldown -= dt;
    const vis = this.seeing;
    // ---- suspicion integration
    if (this.state !== 'stunned' && this.state !== 'sleep' && !this.befriended) {
      if (vis > 0.02) {
        const gain = this.state === 'alert' ? 3 : this.isPet ? 1.25 : 0.95;
        this.suspicion += vis * gain * dt;
        this.lookTarget = this.ctx.player.chest;
        if (this.suspicion > 0.28 && this.state !== 'alert' && this.state !== 'investigate') this.toSuspicious(this.ctx.player.pos);
        if (this.suspicion >= 1) this.toAlert();
        if (this.state === 'alert' || this.state === 'search') {
          this.lastKnown.copy(this.ctx.player.pos);
          if (this.state === 'search') this.toAlertFromSearch();
        }
        if (this.state === 'investigate' && this.suspicion > 0.65) this.lastKnown.copy(this.ctx.player.pos);
      } else {
        const decay = this.state === 'alert' ? 0.12 : this.state === 'investigate' || this.state === 'search' ? 0.08 : 0.22;
        this.suspicion = Math.max(0, this.suspicion - decay * dt);
      }
    }
    const pl = this.ctx.player;
    const distToPlayer = Math.hypot(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z);

    let pose: Pose = 'stand';
    this.speed = 0;
    switch (this.state) {
      case 'routine': {
        const a = this.activity;
        if (!a) break;
        if (this.timer < 0) {
          if (this.arrived(0.3)) {
            this.timer = a.min + Math.random() * (a.max - a.min);
            if (a.say && Math.random() < 0.6) this.say(a.say);
            if (a.seatY != null) this.body.setSitHeight(a.seatY);
          } else {
            this.followPath(dt, this.walkSpeed);
            pose = 'walk';
            this.repath(dt);
          }
        } else {
          pose = a.anim as Pose;
          if (a.face != null) this.turnTo(THREE.MathUtils.degToRad(a.face), dt, 4);
          this.pos.x += (a.at[0] - this.pos.x) * Math.min(1, dt * 4);
          this.pos.z += (a.at[1] - this.pos.z) * Math.min(1, dt * 4);
          this.timer -= dt;
          if (a.anim === 'look') this.headYaw = Math.sin(time * 0.7) * 0.9;
          if (this.timer <= 0) this.nextActivity();
        }
        this.checkWorld();
        break;
      }
      case 'suspicious': {
        if (this.lookTarget) this.faceToward(this.lookTarget, dt, 3);
        pose = 'look';
        this.timer -= dt;
        if (this.timer <= 0) {
          if (this.suspicion > 0.4) this.investigate(this.lastKnown);
          else if (this.suspicion < 0.1) this.resume();
          else this.timer = 0.8;
        }
        break;
      }
      case 'investigate':
      case 'search': {
        if (!this.arrived(0.5)) {
          this.followPath(dt, this.state === 'search' ? this.walkSpeed * 1.5 : this.walkSpeed * 1.15);
          pose = 'walk';
          this.repath(dt);
        } else {
          pose = 'look';
          this.sweep += dt;
          this.headYaw = Math.sin(this.sweep * 1.6) * 1.0;
          this.timer -= dt;
          if (this.timer <= 0) {
            if (this.state === 'search' && Math.random() < 0.5) {
              const p = this.ctx.nav.randomNear(this.lastKnown.x, this.lastKnown.z, 3);
              if (p) { this.goTo(p); this.timer = 2.5; break; }
            }
            this.bark('giveUp');
            this.resume();
          }
        }
        break;
      }
      case 'alert': {
        if (this.isAnimatronic) {
          // rooted to the spot: shriek while it sees movement, then reset
          pose = 'alert';
          this.alertTime += dt;
          if (vis > 0.05) this.alertTime = Math.min(this.alertTime, 1);
          else if (this.alertTime > 3.5) { this.suspicion = 0; this.resume(); }
          break;
        }
        pose = 'run';
        if (vis > 0.05) {
          if (!this.goal || this.goal.distanceTo(pl.pos) > 0.8) this.goTo(pl.pos);
        }
        if (this.isHuman && distToPlayer < 0.85 && vis > 0.05) this.ctx.onCaught(this);
        if (this.isPet && distToPlayer < 1.2) { pose = 'alert'; this.faceToward(pl.pos, dt, 6); this.speed = 0; break; }
        if (!this.arrived(0.5)) this.followPath(dt, this.runSpeed);
        else {
          pose = 'alert';
          if (vis < 0.05) {
            this.state = 'search';
            this.timer = 6;
            this.say(this.isHuman ? 'Where did it go?' : '');
          }
        }
        if (this.isPet && this.barkTimer <= 0) { this.bark('alert'); this.barkTimer = 2.2 + Math.random(); }
        this.barkTimer -= dt;
        // pets get bored of a motionless Boo
        this.alertTime += dt;
        if (this.isPet && this.alertTime > 10 && this.ctx.player.speed < 0.5) {
          this.alertTime = 0;
          this.suspicion = 0;
          if (this.def.kind === 'cat') audio.animal('meow', this.body.headWorld(), 0.3);
          this.resume();
          break;
        }
        if (this.isAnimatronic && Math.random() < dt * 0.8) this.bark('alert');
        break;
      }
      case 'stunned': {
        pose = 'stunned';
        this.stun -= dt;
        if (Math.random() < dt * 1.5) this.ctx.fx.zzz.emit({ pos: this.body.headWorld().add(new THREE.Vector3(0, 0.2, 0)), vel: new THREE.Vector3(0.05, 0.35, 0), life: [1.4, 2], size: [0.12, 0.18], endSize: 1.6, color: 0xbfe0ff, spin: 0.4, alpha: 0.9 });
        if (Math.random() < dt * 8) this.ctx.fx.glitter.emit({ pos: this.body.headWorld(), posJitter: 0.4, vel: new THREE.Vector3(0, 0.1, 0), life: [0.6, 1.2], size: [0.02, 0.04], color: [0xfff2a8, 0xff8fa3, 0x9be7ff] });
        if (this.stun <= 0) {
          this.say(this.isHuman ? ['Whoa… I dozed off standing up.', 'Why does it smell like… lavender fog?', 'Mmh? Oh. Right.', 'Sugar crash. Definitely a sugar crash.'][(Math.random() * 4) | 0] : '', true);
          this.resume();
        }
        break;
      }
      case 'sleep': {
        pose = this.activity?.anim === 'sleep' || this.def.asleep ? 'sleep' : 'lie';
        if (this.activity) {
          this.pos.x += (this.activity.at[0] - this.pos.x) * Math.min(1, dt * 4);
          this.pos.z += (this.activity.at[1] - this.pos.z) * Math.min(1, dt * 4);
          if (this.activity.face != null) this.turnTo(THREE.MathUtils.degToRad(this.activity.face), dt, 4);
        }
        this.sleepiness = Math.max(0, this.sleepiness - dt * 0.05);
        if (Math.random() < dt * 0.35) this.ctx.fx.zzz.emit({ pos: this.body.headWorld().add(new THREE.Vector3(0, 0.15, 0)), vel: new THREE.Vector3(0.04, 0.25, 0), life: [1.8, 2.4], size: [0.1, 0.14], endSize: 1.8, color: 0xd8e8ff, spin: 0.3, alpha: 0.75 });
        break;
      }
      case 'woken': {
        pose = 'sitUp';
        this.headYaw = Math.sin(time * 0.9) * 0.8;
        this.timer -= dt;
        if (vis > 0.15 && this.suspicion > 0.6) {
          this.say(this.def.barks?.alert?.[0] ?? 'MUM! DAD! THERE’S A GHOST IN MY ROOM!', true);
          this.ctx.noise(this.pos.clone(), 14, 'voice', false, this.def.id);
          this.ctx.onSpotted(this);
          this.suspicion = 0;
          this.timer = 4;
        }
        if (this.timer <= 0) {
          this.suspicion = 0;
          if (this.def.asleep) this.state = 'sleep';
          else this.resume();
        }
        break;
      }
      case 'fix': {
        const f = this.fixTarget;
        if (!f) { this.resume(); break; }
        if (!this.arrived(0.9)) {
          this.followPath(dt, this.walkSpeed * 1.1);
          pose = 'walk';
          this.repath(dt);
        } else {
          this.faceToward(f.pos, dt, 4);
          pose = 'clean';
          this.timer -= dt;
          if (this.timer <= 0) {
            this.ctx.fixThing(this, f);
            this.fixTarget = null;
            this.resume();
          }
        }
        break;
      }
      case 'converse': {
        if (this.convoSpot && !this.arrived(0.4)) {
          this.followPath(dt, this.walkSpeed);
          pose = 'walk';
          this.repath(dt);
        } else {
          pose = this.isPet ? 'sit' : 'talk';
          if (this.convoFace) this.faceToward(this.convoFace, dt, 3);
        }
        break;
      }
      case 'distracted': {
        if (this.distractPos && !this.arrived(0.6)) {
          this.followPath(dt, this.isPet ? this.runSpeed * 0.7 : this.walkSpeed * 1.2);
          pose = this.isPet ? 'run' : 'walk';
        } else {
          pose = this.isPet ? 'sniff' : 'look';
          this.headYaw = Math.sin(time * 1.3) * 0.6;
          this.timer -= dt;
          if (this.timer <= 0) this.resume();
        }
        break;
      }
      case 'befriended': {
        // follow the Boo around at a polite distance, tail wagging
        if (distToPlayer > 2.2) {
          if (!this.goal || this.goal.distanceTo(pl.pos) > 1.2) this.goTo(pl.pos);
          this.followPath(dt, this.walkSpeed * 1.6);
          pose = 'walk';
        } else {
          pose = 'sit';
          this.faceToward(pl.pos, dt, 3);
        }
        break;
      }
    }

    // bumping into the Boo
    if (this.isHuman && this.calm && this.state !== 'sleep' && this.state !== 'converse' && distToPlayer < 0.55 && this.speed > 0.2 && !this.ctx.playerState.invisible && !this.ctx.playerState.morphed && !this.ctx.playerState.hiddenSpot) {
      this.say('Whoa! Something cold just brushed my ankle!', true);
      this.suspicion = 1;
      this.toAlert();
    }

    // stuck detection
    if (this.speed > 0.1) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 1.5) {
        if (this.pos.distanceTo(this.lastPos) < 0.15 && this.goal) this.goTo(this.goal);
        this.stuckTimer = 0;
        this.lastPos.copy(this.pos);
      }
    }

    // head look at target
    if (this.lookTarget && (this.state === 'suspicious' || (this.state === 'alert' && vis > 0) || (vis > 0.05 && this.state !== 'stunned'))) {
      const e = this.eye();
      const to = this.lookTarget.clone().sub(e);
      const yaw = angleDiff(Math.atan2(to.x, to.z), this.heading);
      this.headYaw = THREE.MathUtils.clamp(yaw, -1.1, 1.1);
      this.headPitch = THREE.MathUtils.clamp(Math.atan2(to.y, Math.hypot(to.x, to.z)), -0.7, 0.5);
    } else if (this.state !== 'investigate' && this.state !== 'search' && !(this.state === 'routine' && this.activity?.anim === 'look') && this.state !== 'woken' && this.state !== 'distracted') {
      this.headYaw *= Math.max(0, 1 - dt * 3);
      this.headPitch *= Math.max(0, 1 - dt * 3);
    }

    // apply transforms
    this.body.root.position.copy(this.pos);
    // lying on a bed / sitting on a high seat
    const lying = pose === 'sleep' || pose === 'lie' || pose === 'sitUp';
    const bedY = lying && this.activity?.seatY != null && (this.state === 'sleep' || this.state === 'woken' || (this.state === 'routine' && this.timer >= 0)) ? this.activity.seatY : 0;
    this.rootY += (bedY - this.rootY) * Math.min(1, dt * 6);
    this.body.root.position.y = this.rootY;
    this.body.root.rotation.y = this.heading;
    const seated = this.state === 'routine' && this.timer >= 0 && this.activity?.seatY != null && pose !== 'sleep';
    this.body.update(dt, this.speed > 0.05 && (pose === 'walk' || pose === 'run') ? pose : pose === 'walk' || pose === 'run' ? 'stand' : pose, this.speed, this.headYaw, this.headPitch, time, seated || (this.state === 'converse' && false));
    this.updateCone(time);
  }

  private toAlertFromSearch() {
    this.state = 'alert';
    this.bark('alert');
    this.ctx.onSpotted(this);
  }

  private repath(dt: number) {
    this.repathTimer -= dt;
    if (this.repathTimer <= 0 && this.goal) this.goTo(this.goal);
  }

  resume() {
    this.state = this.befriended ? 'befriended' : this.def.asleep ? 'sleep' : 'routine';
    this.suspicion = Math.min(this.suspicion, 0.2);
    this.lookTarget = null;
    this.sweep = 0;
    if (this.state === 'sleep') {
      const a = this.def.activities.find((x) => x.anim === 'sleep') ?? this.def.activities[0];
      this.activity = a;
      this.goTo(new THREE.Vector3(a.at[0], 0, a.at[1]));
      // kids walk back to bed and fall asleep again
      this.state = 'routine';
      this.timer = -1;
      this.activityIdx = this.def.activities.indexOf(a);
      this.pendingSleep = true;
    } else if (this.state === 'routine') {
      this.nextActivity();
    }
  }
  private pendingSleep = false;

  /** Look at the world for things that are wrong (lights out, smashed potions, squashed pumpkins). */
  private checkWorld() {
    if (!this.isHuman) return;
    if (this.pendingSleep && this.activity?.anim === 'sleep' && this.timer >= 0) {
      this.pendingSleep = false;
      this.state = 'sleep';
      return;
    }
    if (Math.random() > 0.08) return;
    const eye = this.eye();
    const fwd = this.forward();
    for (const l of this.ctx.level.lights) {
      if (!l.def.watched || l.isLit() || !l.expectedOn) continue;
      const to = l.pos.clone().sub(eye);
      const d = to.length();
      if (d > 7) continue;
      if (to.normalize().dot(fwd) < 0.2) continue;
      if (!this.ctx.world.lineClear(eye, l.pos, F.SIGHT)) continue;
      this.bark('lamp');
      this.fixTarget = { kind: 'lamp', ref: l, pos: l.pos.clone().setY(0) };
      this.state = 'fix';
      this.suspicion = Math.max(this.suspicion, 0.25);
      this.goTo(this.ctx.nav.randomNear(l.pos.x, l.pos.z, 0.8) ?? l.pos.clone().setY(0));
      this.timer = 1.2;
      return;
    }
    for (const item of this.ctx.disturbed()) {
      if (this.noticed.has(item)) continue;
      const to = item.pos.clone().sub(eye);
      const d = to.length();
      if (d > 6) continue;
      if (to.normalize().dot(fwd) < 0.3) continue;
      if (!this.ctx.world.lineClear(eye, item.pos.clone().setY(item.pos.y + 0.1), F.SIGHT)) continue;
      this.noticed.add(item);
      this.bark('broken');
      this.fixTarget = { kind: 'item', ref: item, pos: item.pos.clone() };
      this.state = 'fix';
      this.suspicion = Math.max(this.suspicion, 0.35);
      this.goTo(item.pos.clone().setY(0));
      this.timer = 2;
      return;
    }
  }

  private updateCone(time: number) {
    const show = this.ctx.showCones && this.state !== 'sleep' && this.state !== 'stunned' && !this.befriended;
    this.cone.visible = show;
    if (!show) return;
    this.cone.position.set(this.pos.x, this.ctx.groundAt(this.pos) + 0.015, this.pos.z);
    this.cone.rotation.y = this.heading + this.headYaw;
    const c = this.state === 'alert' ? 0xff3344 : this.awareness > 0.25 ? 0xffb030 : 0xbfd8ff;
    this.coneMat.color.setHex(c);
    this.coneMat.opacity = this.state === 'alert' ? 0.22 + Math.sin(time * 10) * 0.06 : this.awareness > 0.25 ? 0.16 : 0.07;
  }

  dispose() {
    this.ctx.scene.remove(this.body.root);
    this.ctx.scene.remove(this.cone);
  }
}

export function angleDiff(a: number, b: number) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

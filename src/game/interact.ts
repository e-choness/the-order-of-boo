// Everything the Boo can interact with.

import * as THREE from 'three';
import type { Game } from './game';
import type { ClueDef, HideDef, SightToyDef, ThrowableDef } from '../levels/types';
import { cloneModel } from '../core/assets';
import { makeProp, kitScale } from '../world/props';
import { paperTexture } from '../world/textures';
import { F } from '../world/physics';
import { audio } from '../core/audio';
import type { LightSource } from '../world/lights';
import type { Door } from '../world/house';
import type { NPC } from './npc';
import type { Disturbed } from './context';

export abstract class Interactable {
  pos = new THREE.Vector3();
  radius = 0.35;
  /** seconds the key must be held (0 = instant) */
  hold = 0;
  enabled = true;
  /** show a soft glint so players can spot it */
  glint = false;
  abstract prompt(g: Game): string | null;
  abstract use(g: Game): void;
  /** the label shown greyed out when not usable */
  blocked(_g: Game): string | null { return null; }
  verb(): string { return 'E'; }
  get reach() { return 2.1; }
}

// ------------------------------------------------------------------ clues

export class ClueItem extends Interactable {
  mesh: THREE.Object3D;
  taken = false;
  constructor(public clue: ClueDef, spot: [number, number, number], g: Game) {
    super();
    const s = clue.source as Extract<ClueDef['source'], { kind: 'item' }>;
    this.mesh = s.model.startsWith('special/')
      ? specialModel(s.model)
      : makeProp({ m: s.model, x: 0, z: 0, s: s.scale ?? 1 });
    this.mesh.position.set(spot[0], spot[1], spot[2]);
    this.mesh.rotation.y = Math.random() * Math.PI * 2;
    g.scene.add(this.mesh);
    const b = new THREE.Box3().setFromObject(this.mesh);
    this.pos.copy(b.getCenter(new THREE.Vector3()));
    this.radius = Math.max(0.25, b.getSize(new THREE.Vector3()).length() * 0.5);
    this.glint = true;
  }
  prompt() { return this.taken ? null : `Examine ${this.clue.title}`; }
  use(g: Game) {
    if (this.taken) return;
    this.taken = true;
    this.enabled = false;
    audio.play('sfx/pickup', { volume: 0.6 });
    g.ui.inspect({
      title: this.clue.title,
      text: (this.clue.source as any).inspect ?? this.clue.text,
      object: this.mesh,
      category: this.clue.category,
    }, () => g.foundClue(this.clue));
    g.scene.remove(this.mesh);
  }
}

export class NoteClue extends Interactable {
  mesh: THREE.Object3D;
  read = false;
  constructor(public clue: ClueDef, spot: [number, number, number], g: Game) {
    super();
    const s = clue.source as Extract<ClueDef['source'], { kind: 'note' }>;
    if (s.model) {
      this.mesh = makeProp({ m: s.model, x: spot[0], y: spot[1], z: spot[2], s: s.scale ?? 1, rot: Math.random() * 40 - 20 });
    } else {
      const tex = paperTexture(s.paper, clue.id.length);
      const geo = new THREE.PlaneGeometry(s.paper === 'receipt' ? 0.12 : 0.21, s.paper === 'receipt' ? 0.26 : 0.27);
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, side: THREE.DoubleSide }));
      if (s.paper === 'screen') {
        (m.material as THREE.MeshStandardMaterial).emissive = new THREE.Color(0x4a7fbf);
        (m.material as THREE.MeshStandardMaterial).emissiveMap = tex;
        (m.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.4;
        m.position.set(spot[0], spot[1], spot[2]);
      } else {
        m.rotation.x = -Math.PI / 2;
        m.rotation.z = Math.random() * 0.8 - 0.4;
        m.position.set(spot[0], spot[1] + 0.006, spot[2]);
      }
      m.receiveShadow = true;
      this.mesh = m;
    }
    g.scene.add(this.mesh);
    this.pos.set(spot[0], spot[1] + 0.05, spot[2]);
    this.radius = 0.3;
    this.glint = true;
  }
  prompt() {
    const s = this.clue.source as Extract<ClueDef['source'], { kind: 'note' }>;
    const verb = s.paper === 'screen' ? 'Peek at' : s.paper === 'drawing' ? 'Look at' : 'Read';
    return `${verb} ${this.clue.title}`;
  }
  use(g: Game) {
    const s = this.clue.source as Extract<ClueDef['source'], { kind: 'note' }>;
    audio.play(s.paper === 'screen' ? 'sfx/click_metal' : 'sfx/page', { volume: 0.6 });
    g.ui.note({ title: this.clue.title, body: s.body, paper: s.paper }, () => {
      if (!this.read) {
        this.read = true;
        this.glint = false;
        g.foundClue(this.clue);
      }
    });
  }
}

export class ContainerClue extends Interactable {
  opened = false;
  constructor(public clue: ClueDef | null, public propId: string, g: Game, public label: string) {
    super();
    const p = g.level.propById.get(propId);
    if (p) {
      const b = new THREE.Box3().setFromObject(p.group);
      this.pos.copy(b.getCenter(new THREE.Vector3()));
      this.radius = Math.max(0.35, b.getSize(new THREE.Vector3()).length() * 0.35);
    }
    this.hold = 1.1;
    this.glint = !!clue;
  }
  prompt() { return this.opened ? null : `Search ${this.label}`; }
  use(g: Game) {
    if (this.opened) return;
    this.opened = true;
    this.enabled = false;
    this.glint = false;
    audio.play('sfx/drawer', { volume: 0.6, pos: this.pos });
    g.noise(this.pos.clone(), 2.2, 'search', true);
    // animate any drawer / door parts
    const p = g.level.propById.get(this.propId);
    if (p) {
      for (const [name, o] of p.parts) {
        if (/drawer/i.test(name)) g.animate((t) => { o.position.z = (o.userData.z0 ??= o.position.z) + 0.16 * t; }, 0.35);
        else if (/door/i.test(name)) g.animate((t) => { o.rotation.y = -1.4 * t; }, 0.4);
      }
    }
    if (this.clue) {
      const c = this.clue;
      const s = c.source as Extract<ClueDef['source'], { kind: 'container' }>;
      let obj: THREE.Object3D | undefined;
      if (s.model) obj = s.model.startsWith('special/') ? specialModel(s.model) : makeProp({ m: s.model, x: 0, z: 0 });
      window.setTimeout(() => {
        if (g.ended) return;
        g.ui.inspect({ title: c.title, text: s.inspect, object: obj, category: c.category }, () => g.foundClue(c));
      }, 350);
    } else {
      g.toast(['Nothing but socks and candy wrappers.', 'Just spare batteries and a fake moustache.', 'Empty — unless you count three dead spiders.'][(Math.random() * 3) | 0], 'muted');
    }
  }
}

// ------------------------------------------------------------------ world

export class LampSwitch extends Interactable {
  constructor(public light: LightSource) {
    super();
    this.pos.copy(light.pos);
    if (light.def.kind === 'floorLamp') this.pos.y = 1.1;
    if (light.def.kind === 'ceiling') { this.pos.y = 2.2; }
    this.radius = light.def.kind === 'ceiling' ? 0.35 : 0.3;
  }
  get reach() { return this.light.def.kind === 'ceiling' ? 2.6 : 2.0; }
  prompt() { return this.light.on ? 'Switch off light' : 'Switch on light'; }
  use(g: Game) {
    this.light.toggle();
    audio.play('sfx/lamp_switch', { pos: this.light.pos, volume: 0.7 });
    g.noise(this.light.pos.clone(), 2, 'switch', true);
    g.stats.lightsOut += this.light.on ? 0 : 1;
  }
}

export class DoorInteract extends Interactable {
  constructor(public door: Door) {
    super();
    this.pos.copy(door.center).setY(1.0);
    this.radius = 0.5;
  }
  prompt() { return this.door.locked ? null : this.door.open ? 'Close door' : 'Open door'; }
  /** focus the leaf itself when open, so looking through a doorway doesn't grab focus */
  syncPos() {
    if (this.door.open && Math.abs(this.door.angle) > 0.4) {
      this.door.leaf.updateWorldMatrix(true, false);
      const w = this.door.width * 0.5;
      this.pos.set(w, 1.0, 0).applyMatrix4(this.door.leaf.matrixWorld);
      this.radius = 0.35;
    } else {
      this.pos.copy(this.door.center).setY(1.0);
      this.radius = 0.5;
    }
  }
  blocked() { return this.door.locked ? 'Locked — Boos use chimneys' : null; }
  use(g: Game) {
    if (this.door.locked) {
      audio.play('sfx/latch', { pos: this.door.center, volume: 0.5 });
      return;
    }
    const opening = !this.door.open;
    this.door.setOpen(opening, g.player.pos);
    this.door.lastToggle = g.time;
    audio.play(opening ? 'sfx/door_open' : 'sfx/door_close', { pos: this.door.center, volume: 0.6 });
    g.noise(this.door.center.clone(), g.player.crouched ? 1.8 : 3.2, 'door', true);
  }
}

export class HideSpot extends Interactable {
  anchor = new THREE.Vector3();
  lookYaw = 0;
  mesh: THREE.Object3D | null = null;
  constructor(public def: HideDef, g: Game) {
    super();
    if (def.kind === 'box') {
      this.mesh = makeProp({ m: 'furniture/cardboardBoxClosed', x: def.x, z: def.z, rot: def.rot ?? 0, s: 1.1 });
      g.scene.add(this.mesh);
    } else if (def.kind === 'pumpkins') {
      this.mesh = pumpkinPile(def.x, def.z, def.rot ?? 0);
      g.scene.add(this.mesh);
    }
    const yaw = THREE.MathUtils.degToRad(def.rot ?? 0);
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    let base = new THREE.Vector3(def.x, 0, def.z);
    if (def.propId) {
      const p = g.level.propById.get(def.propId);
      if (p) base = new THREE.Box3().setFromObject(p.group).getCenter(new THREE.Vector3()).setY(0);
    }
    this.pos.copy(base).setY(def.kind === 'underBed' ? 0.25 : 0.7);
    this.radius = def.kind === 'closet' ? 0.5 : 0.45;
    const eyeY = { box: 0.4, curtain: 0.75, underBed: 0.14, closet: 0.85, pumpkins: 0.38 }[def.kind];
    this.anchor.copy(base).addScaledVector(fwd, def.kind === 'curtain' ? -0.05 : def.kind === 'underBed' ? 0.2 : 0).setY(eyeY);
    this.lookYaw = yaw + Math.PI;
  }
  prompt() {
    return {
      box: 'Hide in the box',
      curtain: 'Hide behind the curtain',
      underBed: 'Crawl under the bed',
      closet: 'Hide in the closet',
      pumpkins: 'Hide among the pumpkins',
    }[this.def.kind];
  }
  use(g: Game) { g.enterHide(this); }
}

export class SightToy extends Interactable {
  mesh: THREE.Object3D;
  eye = new THREE.Vector3();
  yaw: number;
  constructor(public def: SightToyDef, g: Game) {
    super();
    this.mesh = makeProp({ m: def.model, x: 0, z: 0, s: def.scale ?? 1 });
    this.mesh.position.set(def.x, def.y, def.z);
    this.mesh.rotation.y = THREE.MathUtils.degToRad(def.rot ?? 0);
    g.scene.add(this.mesh);
    const b = new THREE.Box3().setFromObject(this.mesh);
    this.pos.copy(b.getCenter(new THREE.Vector3()));
    this.eye.set(def.x, b.max.y - (b.max.y - b.min.y) * 0.2, def.z);
    this.radius = 0.3;
    this.yaw = THREE.MathUtils.degToRad(def.rot ?? 0) + Math.PI;
  }
  get reach() { return 14; }
  prompt(g: Game) {
    const k = g.abilities.keyFor('sight');
    return k ? `Spirit Sight: ${this.def.name}` : null;
  }
  verb() { return 'sight'; }
  use(g: Game) { g.abilities.trySight(this); }
}

export class ChimneyExit extends Interactable {
  constructor(g: Game) {
    super();
    const [x, , z] = g.level.def.chimney;
    this.pos.set(x, 0.6, z);
    this.radius = 0.6;
  }
  prompt(g: Game) {
    return g.cluesFound() >= g.level.def.minCluesForReport ? 'Float up the chimney — File your report' : null;
  }
  blocked(g: Game) {
    const need = g.level.def.minCluesForReport - g.cluesFound();
    return need > 0 ? `Chimney — find ${need} more clue${need > 1 ? 's' : ''} before reporting` : null;
  }
  use(g: Game) { g.openReport(); }
}

export class CandyBowl extends Interactable {
  left: number;
  sweets: THREE.Object3D[] = [];
  constructor(spot: { x: number; y: number; z: number }, g: Game, count = 3) {
    super();
    this.left = count;
    const bowl = makeProp({ m: 'spooky/candyBowl', x: spot.x, y: spot.y, z: spot.z });
    g.scene.add(bowl);
    // the "take ONE" sign every porch bowl has
    const note = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.07), new THREE.MeshStandardMaterial({ map: paperTexture('letter', 98) }));
    note.rotation.x = -Math.PI / 2;
    note.rotation.z = 0.3;
    note.position.set(spot.x - 0.22, spot.y + 0.005, spot.z + 0.05);
    g.scene.add(note);
    const kinds = ['food/lollypop', 'food/candyBar', 'food/apple'];
    for (let i = 0; i < count; i++) {
      const c = makeProp({ m: kinds[i % kinds.length], x: spot.x + Math.cos(i * 2.1) * 0.06, y: spot.y + 0.1 + i * 0.012, z: spot.z + Math.sin(i * 2.1) * 0.06, rot: i * 50, s: kinds[i % 3] === 'food/apple' ? 0.7 : 0.9 });
      g.scene.add(c);
      this.sweets.push(c);
    }
    this.pos.set(spot.x, spot.y + 0.1, spot.z);
    this.radius = 0.25;
  }
  prompt() { return this.left > 0 ? `Sneak a sweet (+1 ectoplasm) · ${this.left} left` : null; }
  use(g: Game) {
    if (this.left <= 0) return;
    this.left--;
    const c = this.sweets.pop();
    if (c) g.scene.remove(c);
    g.abilities.addCharge();
    g.stats.candy++;
    audio.play('sfx/soft', { volume: 0.4, rate: 1.6 });
    g.noise(this.pos.clone(), 1, 'eat', true);
    g.fx.burst(this.pos.clone(), [0xff9a3c, 0x9dff7a, 0xc9a2ff], 12, 0.6);
    g.toast(['The sign said “take ONE”. Ghosts can’t read. Officially.', 'Sugar rush! Your sheet glows a little brighter.', 'Ectoplasm restored. Wrapper stuffed in a shoe.'][this.left % 3]);
  }
}

// ------------------------------------------------------------------ throwables

export class Throwable extends Interactable {
  mesh: THREE.Object3D;
  vel = new THREE.Vector3();
  state: 'rest' | 'carried' | 'flying' | 'broken' = 'rest';
  origin: THREE.Vector3;
  originRot: THREE.Euler;
  private spin = new THREE.Vector3();
  size: number;
  disturbed: Disturbed | null = null;
  private shards: THREE.Object3D[] = [];
  constructor(public def: ThrowableDef, private g: Game) {
    super();
    if (def.kind === 'potion') this.mesh = potionBottle();
    else if (def.kind === 'pumpkin') this.mesh = recentre(makeProp({ m: 'spooky/pumpkinSmall', x: 0, z: 0 }));
    else {
      this.mesh = cloneModel(def.model);
      const s = kitScale(def.model) * (def.kind === 'book' ? 0.9 : 1);
      this.mesh.scale.setScalar(s);
      const b = new THREE.Box3().setFromObject(this.mesh);
      const c = b.getCenter(new THREE.Vector3());
      const wrap = new THREE.Group();
      this.mesh.position.sub(c);
      wrap.add(this.mesh);
      this.mesh = wrap;
    }
    const b = new THREE.Box3().setFromObject(this.mesh);
    this.size = Math.max(0.05, b.getSize(new THREE.Vector3()).y / 2);
    this.mesh.position.set(def.x, def.y + this.size, def.z);
    this.origin = this.mesh.position.clone();
    this.originRot = this.mesh.rotation.clone();
    g.scene.add(this.mesh);
    this.pos.copy(this.mesh.position);
    this.radius = Math.max(0.18, this.size * 1.4);
    this.mesh.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
  }
  get label() {
    return { potion: 'potion bottle', pumpkin: 'little pumpkin', toy: 'toy', book: 'book', candy: 'candy apple', treat: 'pet treat', can: 'soda can' }[this.def.kind];
  }
  prompt(g: Game) {
    if (this.state !== 'rest') return null;
    if (g.carrying) return null;
    return `Pick up ${this.label}`;
  }
  use(g: Game) { g.pickUp(this); }

  throw(from: THREE.Vector3, dir: THREE.Vector3, power: number) {
    this.state = 'flying';
    this.mesh.position.copy(from);
    this.vel.copy(dir).multiplyScalar(power).add(new THREE.Vector3(0, 1.6, 0));
    this.spin.set(Math.random() * 8, Math.random() * 8, Math.random() * 8);
    this.g.scene.attach(this.mesh);
    this.enabled = false;
  }

  drop(at: THREE.Vector3) {
    this.state = 'flying';
    this.g.scene.attach(this.mesh);
    this.mesh.position.copy(at);
    this.vel.set(0, 0, 0);
    this.spin.set(0, 0, 0);
    this.enabled = false;
  }

  update(dt: number) {
    if (this.state !== 'flying') return;
    const g = this.g;
    this.vel.y -= 9.8 * dt;
    const p = this.mesh.position;
    const step = this.vel.clone().multiplyScalar(dt);
    const len = step.length();
    let hit = len > 0 ? g.world.raycast(p, step.clone().normalize(), len + this.size * 0.6, F.MOVE) : null;
    // the floor
    if (!hit && p.y + step.y < this.size) {
      hit = { dist: Math.max(0, p.y - this.size), point: p.clone().setY(0), normal: new THREE.Vector3(0, 1, 0), collider: null as any };
    }
    if (hit) {
      const speed = this.vel.length();
      p.addScaledVector(step.normalize(), Math.max(0, hit.dist - this.size * 0.6));
      this.onImpact(speed, hit.point, hit.normal);
      if (this.state !== 'flying') return;
      // bounce
      const n = hit.normal;
      this.vel.addScaledVector(n, -2 * this.vel.dot(n)).multiplyScalar(0.35);
      if (n.y > 0.5 && Math.abs(this.vel.y) < 0.6) {
        this.vel.set(0, 0, 0);
        this.state = 'rest';
        this.enabled = true;
        p.y = hit.point.y + this.size;
        this.settle();
      }
    } else {
      p.add(step);
    }
    this.mesh.rotation.x += this.spin.x * dt;
    this.mesh.rotation.y += this.spin.y * dt;
    this.mesh.rotation.z += this.spin.z * dt;
    this.pos.copy(p);
  }

  private onImpact(speed: number, at: THREE.Vector3, _n: THREE.Vector3) {
    const g = this.g;
    if (speed < 0.6) return;
    const k = this.def.kind;
    if ((k === 'potion' && speed > 2.5) || (k === 'pumpkin' && speed > 3.2)) {
      this.shatter(at);
      return;
    }
    const snd = k === 'book' ? 'sfx/wood' : k === 'can' ? 'sfx/metal' : k === 'candy' || k === 'treat' || k === 'pumpkin' ? 'sfx/soft' : k === 'potion' ? 'sfx/glass' : 'sfx/wood';
    audio.play(snd, { pos: at, volume: Math.min(1, speed / 6) });
    g.noise(at.clone(), Math.min(8, 1.5 + speed * 1.1), 'impact', true);
    if (k === 'treat' || k === 'candy') {
      for (const n of g.npcs) if (n.def.kind === 'dog' && !n.befriended && n.pos.distanceTo(at) < 9) n.distract(at);
    }
  }

  private shatter(at: THREE.Vector3) {
    const g = this.g;
    this.state = 'broken';
    this.enabled = false;
    const splat = this.def.kind === 'pumpkin';
    audio.play(splat ? 'sfx/soft' : 'sfx/glass', { pos: at, volume: 1, rate: splat ? 0.6 : 1 });
    if (splat) audio.play('sfx/wood', { pos: at, volume: 0.7, rate: 0.7 });
    g.noise(at.clone(), splat ? 8 : 9, 'shatter', true);
    g.fx.burst(at.clone().setY(at.y + 0.05), splat ? [0xe8731c, 0xffb050, 0xf3e0a0] : [0x9dff7a, 0x3cff6a, 0xffffff], 30, 1.6);
    g.scene.remove(this.mesh);
    const mat = splat ? new THREE.MeshStandardMaterial({ color: 0xe8731c, roughness: 0.7, flatShading: true }) : new THREE.MeshStandardMaterial({ color: 0x3a8a4a, emissive: 0x3cff6a, emissiveIntensity: 0.8, roughness: 0.2 });
    if (!splat) {
      // a glowing puddle of spilled potion
      const pool = new THREE.Mesh(new THREE.CircleGeometry(0.22, 18), new THREE.MeshStandardMaterial({ color: 0x0a2a10, emissive: 0x3cff6a, emissiveIntensity: 0.9, transparent: true, opacity: 0.75, depthWrite: false }));
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(at.x, at.y + 0.008, at.z);
      g.scene.add(pool);
      this.shards.push(pool);
    }
    for (let i = 0; i < 9; i++) {
      const s = new THREE.Mesh(splat ? new THREE.IcosahedronGeometry(0.025 + Math.random() * 0.03, 0) : new THREE.TetrahedronGeometry(0.02 + Math.random() * 0.02), mat);
      s.position.set(at.x + (Math.random() - 0.5) * 0.5, at.y + 0.01, at.z + (Math.random() - 0.5) * 0.5);
      s.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      g.scene.add(s);
      this.shards.push(s);
    }
    const d: Disturbed = {
      pos: at.clone(),
      kind: 'broken',
      fix: () => {
        for (const s of this.shards) g.scene.remove(s);
        this.shards = [];
        g.removeDisturbed(d);
      },
    };
    this.disturbed = d;
    g.addDisturbed(d);
    g.stats.broken++;
  }

  private settle() {
    const g = this.g;
    if (this.mesh.position.distanceTo(this.origin) > 1.2 && !this.disturbed && this.def.kind !== 'treat' && this.def.kind !== 'candy') {
      const d: Disturbed = {
        pos: this.mesh.position.clone(),
        kind: 'moved',
        fix: () => {
          this.mesh.position.copy(this.origin);
          this.mesh.rotation.copy(this.originRot);
          this.pos.copy(this.origin);
          this.disturbed = null;
          g.removeDisturbed(d);
        },
      };
      this.disturbed = d;
      g.addDisturbed(d);
    } else if (this.disturbed) {
      this.disturbed.pos.copy(this.mesh.position);
    }
  }
}

// ------------------------------------------------------------------ npc interactions

export class PetTalk extends Interactable {
  constructor(public npc: NPC) { super(); this.radius = 0.45; }
  prompt(g: Game) {
    if (!this.npc.def.talk || this.npc.state === 'alert' || this.npc.state === 'stunned') return null;
    if (g.carrying?.def.kind === 'treat' && this.npc.def.treat && !this.npc.befriended) return `Offer the treat to ${this.npc.name}`;
    return this.npc.talkedTo ? `Chat with ${this.npc.name} again` : `Whisper to ${this.npc.name}`;
  }
  blocked(g: Game) {
    if (!this.npc.def.talk) return null;
    if (g.humanWatching()) return `${this.npc.name} won’t talk while humans are watching`;
    return null;
  }
  use(g: Game) { g.talkToPet(this.npc); }
  syncPos() {
    this.pos.copy(this.npc.body.headWorld());
  }
}

export class SleepListen extends Interactable {
  constructor(public npc: NPC, public clue: ClueDef) { super(); this.radius = 0.6; }
  prompt() {
    return this.npc.state === 'sleep' ? `Listen to ${this.npc.name} sleep-talk` : null;
  }
  use(g: Game) { g.listenSleep(this.npc, this.clue); }
  syncPos() { this.pos.copy(this.npc.body.headWorld()); }
}

// ------------------------------------------------------------------ procedural mini-props

/** Centre a model on its bounding box so it tumbles nicely when thrown. */
function recentre(o: THREE.Object3D): THREE.Group {
  const b = new THREE.Box3().setFromObject(o);
  const c = b.getCenter(new THREE.Vector3());
  o.position.sub(c);
  const wrap = new THREE.Group();
  wrap.add(o);
  return wrap;
}

export function potionBottle(color?: number): THREE.Group {
  const g = new THREE.Group();
  const cols = [0x3cff6a, 0xb04bff, 0xff7a1a, 0x4cc9f0];
  const c = color ?? cols[(Math.random() * cols.length) | 0];
  const pts = [new THREE.Vector2(0, -0.06), new THREE.Vector2(0.045, -0.06), new THREE.Vector2(0.055, -0.02), new THREE.Vector2(0.05, 0.02), new THREE.Vector2(0.018, 0.045), new THREE.Vector2(0.016, 0.08), new THREE.Vector2(0, 0.08)];
  const glass = new THREE.Mesh(new THREE.LatheGeometry(pts, 14), new THREE.MeshStandardMaterial({ color: 0x1a1a22, emissive: c, emissiveIntensity: 0.9, roughness: 0.12, metalness: 0.2 }));
  const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.015, 0.025, 8), new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.9 }));
  cork.position.y = 0.09;
  const label = new THREE.Mesh(new THREE.CylinderGeometry(0.0505, 0.0505, 0.03, 14, 1, true), new THREE.MeshStandardMaterial({ color: 0xeee2c4, roughness: 0.9, side: THREE.DoubleSide }));
  label.position.y = -0.03;
  g.add(glass, cork, label);
  return g;
}

/** The jack-o'-lantern a Boo possesses: big, grinning and lit from inside. */
export function possessPumpkin(): THREE.Group {
  const g = recentre(makeProp({ m: 'spooky/jackOLantern', x: 0, z: 0 }));
  g.children[0].position.y = 0;
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && (m.material as THREE.Material).name === 'lanternGlow') {
      m.material = (m.material as THREE.MeshStandardMaterial).clone();
      g.userData.glow = m.material;
    }
  });
  return g;
}

/** A heap of pumpkins and gourds big enough for a small ghost to crouch behind. */
export function pumpkinPile(x: number, z: number, rot: number): THREE.Group {
  const g = new THREE.Group();
  const parts: [string, number, number, number, number][] = [
    ['spooky/pumpkinLarge', 0, 0, 0, 1], ['spooky/pumpkin', 0.36, 0.05, 0.15, 1], ['spooky/pumpkin', -0.34, 0.1, 0.0, 1.1],
    ['spooky/pumpkinWhite', 0.12, 0.3, 0.2, 1], ['spooky/pumpkinSmall', -0.18, 0.32, 0.28, 1], ['spooky/gourds', 0.3, 0.36, 0, 1],
    ['spooky/pumpkinSmall', 0.05, -0.32, 0.4, 1], ['spooky/pumpkin', -0.05, -0.05, 0.38, 0.8],
  ];
  for (const [m, px, pz, py, sc] of parts) g.add(makeProp({ m, x: px, z: pz, y: py, s: sc, rot: px * 300 }));
  g.position.set(x, 0, z);
  g.rotation.y = THREE.MathUtils.degToRad(rot);
  return g;
}

/** Small procedural evidence props that the Kenney kits don't include. */
export function specialModel(name: string): THREE.Group {
  const g = new THREE.Group();
  const M = (c: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, ...extra });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  };
  switch (name) {
    case 'special/basketball': {
      add(new THREE.SphereGeometry(0.12, 24, 16), M(0xd8742c, { roughness: 0.8 }), 0, 0.1, 0).scale.y = 0.8; // a bit deflated
      for (const r of [0, Math.PI / 2]) {
        const t = add(new THREE.TorusGeometry(0.12, 0.004, 6, 32), M(0x222222), 0, 0.1, 0);
        t.rotation.y = r;
        t.scale.y = 0.8;
      }
      const eq = add(new THREE.TorusGeometry(0.12, 0.004, 6, 32), M(0x222222), 0, 0.1, 0);
      eq.rotation.x = Math.PI / 2;
      // little dino sticker
      add(new THREE.BoxGeometry(0.05, 0.03, 0.005), M(0x3a9a5a), 0, 0.13, 0.115);
      break;
    }
    case 'special/helmet': {
      const shell = add(new THREE.SphereGeometry(0.13, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), M(0x3a9a5a, { roughness: 0.35 }), 0, 0.02, 0);
      shell.scale.set(1, 0.9, 1.15);
      for (let i = 0; i < 5; i++) add(new THREE.ConeGeometry(0.02, 0.05, 4), M(0xf2c14e), 0, 0.14 - i * 0.012, -0.06 + i * 0.035).rotation.x = -0.3 + i * 0.15;
      add(new THREE.BoxGeometry(0.2, 0.015, 0.02), M(0x222222), 0, 0.02, 0.13);
      break;
    }
    case 'special/photo': {
      add(new THREE.BoxGeometry(0.18, 0.13, 0.015), M(0xc19a5b, { metalness: 0.4, roughness: 0.4 }), 0, 0.07, 0);
      const c = document.createElement('canvas');
      c.width = 128; c.height = 96;
      const x = c.getContext('2d')!;
      x.fillStyle = '#d9c9a8'; x.fillRect(0, 0, 128, 96);
      x.fillStyle = '#e8e2d6';
      x.beginPath(); x.ellipse(70, 52, 34, 18, 0, 0, Math.PI * 2); x.fill();
      for (let i = 0; i < 6; i++) { x.beginPath(); x.moveTo(48 + i * 9, 36); x.lineTo(53 + i * 9, 22); x.lineTo(58 + i * 9, 36); x.fill(); }
      x.fillStyle = '#c0392b'; x.fillRect(22, 40, 14, 28);
      x.fillStyle = '#f2d0b0'; x.beginPath(); x.arc(29, 34, 7, 0, Math.PI * 2); x.fill();
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      add(new THREE.PlaneGeometry(0.155, 0.11), new THREE.MeshStandardMaterial({ map: t }), 0, 0.07, 0.008);
      g.rotation.x = -0.25;
      break;
    }
    case 'special/catalog': {
      add(new THREE.BoxGeometry(0.21, 0.012, 0.28), M(0xe8384b), 0, 0.006, 0);
      add(new THREE.BoxGeometry(0.2, 0.004, 0.27), M(0xfdf6e3), 0, 0.014, 0);
      break;
    }
    case 'special/trophy': {
      add(new THREE.BoxGeometry(0.08, 0.03, 0.08), M(0x3a2a20), 0, 0.015, 0);
      add(new THREE.CylinderGeometry(0.01, 0.01, 0.05, 8), M(0xe8c062, { metalness: 0.9, roughness: 0.25 }), 0, 0.055, 0);
      add(new THREE.CylinderGeometry(0.045, 0.02, 0.06, 16), M(0xe8c062, { metalness: 0.9, roughness: 0.25 }), 0, 0.11, 0);
      break;
    }
    case 'special/skates': {
      for (const sx of [-0.05, 0.05]) {
        add(new THREE.BoxGeometry(0.07, 0.09, 0.2), M(0x2b3f7a), sx, 0.06, 0);
        add(new THREE.BoxGeometry(0.01, 0.02, 0.22), M(0xcfd8e0, { metalness: 0.9, roughness: 0.2 }), sx, 0.01, 0);
      }
      break;
    }
    case 'special/telescope': {
      const tube = add(new THREE.CylinderGeometry(0.035, 0.05, 0.4, 16), M(0x1b2a4a, { roughness: 0.3, metalness: 0.4 }), 0, 0.3, 0);
      tube.rotation.z = 0.9;
      for (const a of [0, 2.1, 4.2]) add(new THREE.CylinderGeometry(0.006, 0.006, 0.32, 6), M(0x8a8a8a), Math.cos(a) * 0.06, 0.15, Math.sin(a) * 0.06).rotation.set(Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3);
      break;
    }
    case 'special/drone': {
      add(new THREE.BoxGeometry(0.1, 0.03, 0.1), M(0x2a2a2a), 0, 0.03, 0);
      for (const [x, z] of [[0.08, 0.08], [-0.08, 0.08], [0.08, -0.08], [-0.08, -0.08]]) {
        add(new THREE.CylinderGeometry(0.045, 0.045, 0.005, 16), M(0x88c8ff, { transparent: true, opacity: 0.5 }), x, 0.05, z);
      }
      break;
    }
    case 'special/robot': {
      add(new THREE.BoxGeometry(0.1, 0.1, 0.08), M(0xc7ccd6, { metalness: 0.6, roughness: 0.3 }), 0, 0.08, 0);
      add(new THREE.BoxGeometry(0.07, 0.06, 0.06), M(0xc7ccd6, { metalness: 0.6, roughness: 0.3 }), 0, 0.16, 0);
      add(new THREE.SphereGeometry(0.012, 8, 6), M(0, { emissive: 0xff2030, emissiveIntensity: 3 }), 0, 0.16, 0.035);
      for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.006, 0.05, 0.006), M(0x8b5a2b), sx * 0.025, 0.21, 0).rotation.z = -sx * 0.4;
      break;
    }
    case 'special/phone': {
      add(new THREE.BoxGeometry(0.07, 0.008, 0.14), M(0x111111, { roughness: 0.2 }), 0, 0.004, 0);
      add(new THREE.PlaneGeometry(0.06, 0.12), new THREE.MeshStandardMaterial({ color: 0, emissive: 0x6fa8ff, emissiveIntensity: 1.2 }), 0, 0.0085, 0).rotation.x = -Math.PI / 2;
      break;
    }
    default: {
      add(new THREE.BoxGeometry(0.1, 0.1, 0.1), M(0xff00ff));
    }
  }
  return g;
}

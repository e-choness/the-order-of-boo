// Light sources that matter for both rendering and stealth (light meter).

import * as THREE from 'three';
import type { LightDef } from '../levels/types';
import { makeProp } from './props';
import type { FX } from '../fx/particles';
import { F, type PhysicsWorld } from './physics';

const DEFAULTS: Record<LightDef['kind'], { color: string; intensity: number; range: number; y: number; model?: string }> = {
  floorLamp: { color: '#ffcf8a', intensity: 4.5, range: 6.5, y: 1.55, model: 'furniture/lampRoundFloor' },
  tableLamp: { color: '#ffd29a', intensity: 3.5, range: 4.5, y: 0.5, model: 'furniture/lampRoundTable' },
  ceiling: { color: '#ffe2b8', intensity: 7, range: 7, y: 2.15, model: 'furniture/lampSquareCeiling' },
  wallLamp: { color: '#ffc77a', intensity: 3.5, range: 4.5, y: 1.7, model: 'furniture/lampWall' },
  lantern: { color: '#ff9440', intensity: 2.8, range: 4.8, y: 0.16, model: 'spooky/jackOLantern' },
  fire: { color: '#ff8a3c', intensity: 9, range: 6.5, y: 0.5 },
  candle: { color: '#ffb35c', intensity: 1.4, range: 2.8, y: 0.15 },
  tv: { color: '#8fb8ff', intensity: 3, range: 5, y: 0.9 },
  nightlight: { color: '#9fd0ff', intensity: 1.6, range: 3.2, y: 0.3 },
  fridge: { color: '#e8f6ff', intensity: 3, range: 3.5, y: 1 },
};

export class LightSource {
  def: LightDef;
  light: THREE.PointLight;
  model: THREE.Group | null = null;
  glow: THREE.Mesh[] = [];
  on: boolean;
  /** what the household expects (NPCs restore it) */
  expectedOn: boolean;
  baseIntensity: number;
  range: number;
  pos: THREE.Vector3;
  color: THREE.Color;
  private t = Math.random() * 10;
  motionTimer = 0;
  private fx?: FX;
  private emitAcc = 0;
  /** brief flash, e.g. when switched */
  noticedOffBy = new Set<string>();

  constructor(def: LightDef, parent: THREE.Object3D, world: PhysicsWorld, fx: FX, height = 2.6) {
    this.def = def;
    this.fx = fx;
    const d = DEFAULTS[def.kind];
    this.color = new THREE.Color(def.color ?? d.color);
    this.baseIntensity = def.intensity ?? d.intensity;
    this.range = def.range ?? d.range;
    // table lamps: def.y is the surface they stand on
    const surfaceY = def.kind === 'tableLamp' || def.kind === 'lantern' ? def.y ?? 0 : 0;
    const y = def.kind === 'tableLamp' ? surfaceY + 0.5 : def.kind === 'lantern' ? surfaceY + d.y : def.y ?? (def.kind === 'ceiling' ? height - 0.45 : d.y);
    this.pos = new THREE.Vector3(def.x, y, def.z);
    this.on = def.on ?? !def.motion;
    this.expectedOn = this.on;
    this.light = new THREE.PointLight(this.color, 0, this.range, 1.6);
    this.light.position.copy(this.pos);
    if (def.shadow) {
      this.light.castShadow = true;
      this.light.shadow.mapSize.set(512, 512);
      this.light.shadow.bias = -0.004;
      this.light.shadow.radius = 4;
      this.light.shadow.camera.near = 0.1;
    }
    parent.add(this.light);

    const bulbMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: this.color, emissiveIntensity: 0 });
    if (!def.noModel && d.model) {
      const my = def.kind === 'ceiling' ? height - 0.46 : def.kind === 'wallLamp' ? y - 0.15 : surfaceY;
      const m = makeProp({ m: d.model, x: def.x, z: def.z, y: my, rot: def.rot ?? 0 });
      parent.add(m);
      this.model = m;
      // make the lampshade glow
      m.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[];
        mesh.material = mats.map((mm) => {
          if (/lamp|light|carpet|white|glow/i.test(mm.name) && !/wood|metal/i.test(mm.name)) {
            const c = mm.clone();
            c.emissive = this.color.clone();
            c.emissiveIntensity = 0;
            this.glow.push(mesh);
            (c as any).userData = { glowMat: true };
            return c;
          }
          return mm;
        });
        if ((mesh.material as THREE.Material[]).length === 1) mesh.material = (mesh.material as THREE.Material[])[0];
      });
      // floor lamps are solid
      if (def.kind === 'floorLamp') {
        world.addBox(def.x, 0, def.z, 0.3, 1.7, 0.3, F.MOVE | F.NAV, { climbable: false });
      }
      if (def.kind === 'lantern' && surfaceY < 0.05) {
        world.addBox(def.x, 0, def.z, 0.34, 0.3, 0.34, F.MOVE | F.NAV);
      }
    }
    // small visible bulb
    if (def.kind === 'candle') {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.028, 0.16, 10), new THREE.MeshStandardMaterial({ color: 0xf6efe0, roughness: 0.6 }));
      c.position.set(def.x, y - 0.12, def.z);
      parent.add(c);
    }
    if (def.kind === 'nightlight') {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), bulbMat);
      b.position.copy(this.pos);
      parent.add(b);
      this.glow.push(b);
    }
    this.apply(1);
  }

  toggle(force?: boolean) {
    this.on = force ?? !this.on;
    this.apply(1);
  }

  /** visual intensity factor 0..1 */
  private apply(k: number) {
    const on = this.on || this.motionTimer > 0;
    // keep the light in the scene (constant light count = no shader recompiles)
    this.light.intensity = on ? this.baseIntensity * k : 0;
    for (const g of this.glow) {
      const mats = Array.isArray(g.material) ? g.material : [g.material];
      for (const mm of mats as THREE.MeshStandardMaterial[]) {
        if ((mm as any).userData?.glowMat || mm.emissive) mm.emissiveIntensity = on ? (this.def.kind === 'lantern' ? 3 : 0.9) * k : 0;
      }
    }
  }

  isLit() {
    return this.on || this.motionTimer > 0;
  }

  update(dt: number, time: number) {
    this.t += dt;
    if (this.motionTimer > 0) {
      this.motionTimer -= dt;
      if (this.motionTimer <= 0) this.apply(1);
    }
    const k = this.def.kind;
    if (!this.isLit()) {
      return;
    }
    if (k === 'fire') {
      const f = 0.75 + 0.18 * Math.sin(this.t * 13) * Math.sin(this.t * 7.3) + 0.1 * Math.sin(this.t * 29);
      this.light.intensity = this.baseIntensity * f;
      this.emitAcc += dt;
      while (this.emitAcc > 0.022) {
        this.emitAcc -= 0.022;
        const base = new THREE.Vector3(this.def.x + (Math.random() - 0.5) * 0.5, this.pos.y - 0.3, this.def.z - 0.12 + (Math.random() - 0.5) * 0.15);
        this.fx?.fire.emit({
          pos: base,
          vel: new THREE.Vector3(0, 0.95, 0),
          spread: 0.1,
          life: [0.3, 0.6],
          size: [0.14, 0.26],
          endSize: 0.12,
          color: [0xff9a30, 0xff6a10, 0xffc860, 0xff4a08],
          alpha: 0.85,
          spin: 1.5,
        });
        
        if (Math.random() < 0.06) {
          this.fx?.glitter.emit({ pos: new THREE.Vector3(this.def.x, this.pos.y - 0.2, this.def.z), posJitter: 0.3, vel: new THREE.Vector3(0, 1.2, 0), spread: 0.4, life: [0.6, 1.2], size: [0.015, 0.03], color: 0xffb060 });
        }
      }
    } else if (k === 'candle') {
      this.light.intensity = this.baseIntensity * (0.85 + 0.15 * Math.sin(this.t * 17) * Math.sin(this.t * 5));
      if (Math.random() < dt * 30) this.fx?.fire.emit({ pos: this.pos.clone().add(new THREE.Vector3(0, -0.02, 0)), vel: new THREE.Vector3(0, 0.12, 0), life: [0.2, 0.35], size: [0.03, 0.045], endSize: 0.5, color: 0xffb050 });
    } else if (k === 'tv') {
      const f = 0.6 + 0.4 * Math.abs(Math.sin(this.t * 2.1) * Math.sin(this.t * 0.7 + 1)) + (Math.random() < 0.02 ? 0.3 : 0);
      this.light.intensity = this.baseIntensity * f;
      this.light.color.setHSL(0.58 + 0.06 * Math.sin(this.t * 0.9), 0.6, 0.6);
    } else if (k === 'lantern') {
      // a candle guttering inside a carved pumpkin
      const f = 0.78 + 0.14 * Math.sin(this.t * 11) * Math.sin(this.t * 4.3) + 0.08 * Math.sin(this.t * 31) + (Math.random() < 0.01 ? -0.25 : 0);
      this.light.intensity = this.baseIntensity * f;
      for (const g of this.glow) {
        const mats = (Array.isArray(g.material) ? g.material : [g.material]) as THREE.MeshStandardMaterial[];
        for (const mm of mats) if (mm.emissive) mm.emissiveIntensity = 3 * f;
      }
      void time;
    }
  }

  /** Stealth light contribution at p (no occlusion test). 0..~1.5 */
  contribution(p: THREE.Vector3) {
    if (!this.isLit()) return 0;
    const d = this.pos.distanceTo(p);
    if (d > this.range) return 0;
    const f = 1 - d / this.range;
    return Math.pow(f, 2.6) * (this.light.intensity / 5);
  }
}

/** A world light-level sampler for the stealth meter. */
export function lightLevelAt(
  p: THREE.Vector3,
  lights: LightSource[],
  world: PhysicsWorld,
  moon: { dir: THREE.Vector3; strength: number },
  extra = 0,
): number {
  let sum = 0.04 + extra;
  for (const l of lights) {
    const c = l.contribution(p);
    if (c < 0.01) continue;
    if (world.lineClear(l.pos, p, F.LIGHT)) sum += c;
  }
  // moonbeam through windows: clear line toward the moon for a long way
  const far = p.clone().addScaledVector(moon.dir, 12);
  if (world.lineClear(p, far, F.LIGHT)) sum += moon.strength;
  return Math.min(1.5, sum);
}

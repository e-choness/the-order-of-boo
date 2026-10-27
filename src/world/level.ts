// Assembles a playable level: house shell, furniture, lights, decor,
// environment, particles and the NPC navigation grid.

import * as THREE from 'three';
import type { LevelDef } from '../levels/types';
import { PhysicsWorld } from './physics';
import { buildHouse, type Door, type WindowInfo } from './house';
import { placeProp, type PlacedProp } from './props';
import { LightSource } from './lights';
import { buildDecor, buildFireplace } from './decor';
import { Environment } from './environment';
import { NavGrid } from './nav';
import { FX } from '../fx/particles';
import { preloadModels } from '../core/assets';

const tmpV = new THREE.Vector3();

export class Level {
  def: LevelDef;
  scene = new THREE.Scene();
  world = new PhysicsWorld();
  props: PlacedProp[] = [];
  propById = new Map<string, PlacedProp>();
  lights: LightSource[] = [];
  doors: Door[] = [];
  windows: WindowInfo[] = [];
  env!: Environment;
  nav!: NavGrid;
  fx = new FX();
  clocks: THREE.Object3D[] = [];
  /** portrait eyes that follow the camera */
  eyes: THREE.Object3D[] = [];
  roomAt!: (x: number, z: number) => import('../levels/types').RoomDef | null;
  height = 2.6;

  constructor(def: LevelDef) {
    this.def = def;
  }

  static modelsFor(def: LevelDef): string[] {
    const list = new Set<string>();
    for (const p of def.props) if (!p.m.startsWith('special/')) list.add(p.m);
    for (const c of def.clues) {
      const s = c.source;
      if ((s.kind === 'item' || s.kind === 'note' || s.kind === 'container') && s.model) list.add(s.model);
    }
    for (const t of def.throwables) list.add(t.model);
    for (const s of def.sightToys) list.add(s.model);
    [
      'furniture/lampRoundFloor', 'furniture/lampRoundTable', 'furniture/lampSquareCeiling', 'furniture/lampWall',
      'holiday/treePine', 'holiday/lightpost', 'holiday/rockFormationMedium', 'holiday/rockFormationSmall', 'holiday/bench',
      'food/lollypop', 'food/candyBar', 'food/apple', 'furniture/cardboardBoxClosed',
    ].forEach((m) => list.add(m));
    return [...list].filter((m) => !m.startsWith('special/'));
  }

  async load(shadowSize: number, onProgress?: (p: number) => void) {
    const def = this.def;
    await preloadModels(Level.modelsFor(def), onProgress);
    const s = this.scene;
    s.background = new THREE.Color(0x07050f);
    s.fog = new THREE.FogExp2(0x1a1426, 0.016);

    const house = buildHouse(def, this.world);
    s.add(house.group);
    this.doors = house.doors;
    this.windows = house.windows;
    this.roomAt = house.roomAt;
    this.height = house.height;

    const propsGroup = new THREE.Group();
    propsGroup.name = 'props';
    for (const p of def.props) {
      if (p.m === 'special/fireplace') {
        propsGroup.add(buildFireplace(p.x, p.z, p.rot ?? 0, this.world));
        continue;
      }
      const placed = placeProp(p, propsGroup, this.world);
      this.props.push(placed);
      if (p.id) this.propById.set(p.id, placed);
    }
    s.add(propsGroup);

    for (const l of def.lights) this.lights.push(new LightSource(l, s, this.world, this.fx, this.height));

    const decor = buildDecor(def, this.world);
    s.add(decor.group);
    this.clocks = decor.clocks;
    this.eyes = decor.eyes;

    this.env = new Environment(def, this.world, shadowSize);
    s.add(this.env.group);
    s.add(this.fx.group);

    const [x0, z0, x1, z1] = def.bounds;
    this.nav = new NavGrid(x0, z0, x1, z1);
    // NPCs stay inside: only cells inside a room are walkable
    this.nav.build(this.world, 0.22, (x, z) => !!this.roomAt(x, z));
  }

  update(dt: number, time: number, cam: THREE.Vector3) {
    for (const l of this.lights) l.update(dt, time);
    for (const d of this.doors) d.update(dt);
    // the portraits are watching
    for (const e of this.eyes) {
      e.parent!.worldToLocal(tmpV.copy(cam));
      tmpV.sub(e.position);
      if (tmpV.z < 0.05) continue;
      e.rotation.y = THREE.MathUtils.clamp(Math.atan2(tmpV.x, tmpV.z), -0.9, 0.9);
      e.rotation.x = THREE.MathUtils.clamp(-Math.atan2(tmpV.y, Math.hypot(tmpV.x, tmpV.z)), -0.7, 0.7);
    }
    this.env.update(dt, time, cam, this.fx);
    this.fx.update(dt);
  }
}

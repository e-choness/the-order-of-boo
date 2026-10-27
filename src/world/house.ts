// Builds a house interior + exterior from a LevelDef: floors, wallpapered walls
// with door/window openings, trim, ceilings, a mossy gabled roof, hinged doors,
// curtains and the moonlit yard.

import * as THREE from 'three';
import type { LevelDef, OpeningDef, RoomDef } from '../levels/types';
import { F, type PhysicsWorld, type Surface } from './physics';
import { GeoBatcher } from './geom';
import { ceilingTexture, floorTexture, sidingTexture, wallTexture } from './textures';

export const WALL_T = 0.14;
export const DOOR_H = 2.1;

interface WallRun {
  axis: 'x' | 'z';
  line: number;
  a: number;
  b: number;
  pos: RoomDef | null; // room on the + side (south for axis x, east for axis z)
  neg: RoomDef | null;
}

export class Door {
  pivot = new THREE.Group();
  leaf: THREE.Mesh;
  open: boolean;
  angle: number;
  target: number;
  collider: import('./physics').Collider;
  locked: boolean;
  axis: 'x' | 'z';
  center: THREE.Vector3;
  width: number;
  /** remembered state NPCs expect */
  expectedOpen: boolean;
  private world: PhysicsWorld;
  private openDir: number;
  lastToggle = -99;

  constructor(def: OpeningDef, world: PhysicsWorld, mat: THREE.Material, knobMat: THREE.Material) {
    this.world = world;
    this.axis = def.axis;
    this.width = def.width ?? 1;
    this.locked = !!def.locked;
    this.open = !!def.open;
    this.expectedOpen = this.open;
    this.center = new THREE.Vector3(def.x, 0, def.z);
    const w = this.width - 0.06;
    const geo = new THREE.BoxGeometry(w, DOOR_H - 0.03, 0.045);
    geo.translate(w / 2, (DOOR_H - 0.03) / 2, 0);
    this.leaf = new THREE.Mesh(geo, mat);
    this.leaf.castShadow = this.leaf.receiveShadow = true;
    // raised panels
    const panelGeo = new THREE.BoxGeometry(w * 0.34, 0.7, 0.012);
    for (const [px, py] of [[0.27, 0.55], [0.73, 0.55], [0.27, 1.45], [0.73, 1.45]]) {
      for (const side of [1, -1]) {
        const p = new THREE.Mesh(panelGeo, mat);
        p.position.set(w * px, py, side * 0.028);
        p.castShadow = true;
        this.leaf.add(p);
      }
    }
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), knobMat);
    for (const side of [1, -1]) {
      const k = knob.clone();
      k.position.set(w - 0.09, 1.0, side * 0.055);
      this.leaf.add(k);
    }
    this.pivot.add(this.leaf);
    // hinge at the "low" end of the opening
    if (def.axis === 'x') {
      this.pivot.position.set(def.x - this.width / 2 + 0.03, 0, def.z);
    } else {
      this.pivot.position.set(def.x, 0, def.z - this.width / 2 + 0.03);
      this.pivot.rotation.y = -Math.PI / 2;
    }
    this.openDir = 1;
    this.angle = this.open ? this.openAngle() : 0;
    this.target = this.angle;
    this.leaf.rotation.y = this.angle;
    this.collider = world.add(new THREE.Vector3(), new THREE.Vector3(), F.MOVE | F.SIGHT | F.LIGHT | F.CAMERA | F.SOUND, { owner: this, climbable: false });
    this.updateCollider();
  }

  openAngle() { return (Math.PI / 2) * 0.92 * this.openDir; }

  /** Opens away from `from` (so doors swing away from whoever pushes them). */
  setOpen(open: boolean, from?: THREE.Vector3) {
    if (this.locked && open) return false;
    if (open && !this.open && from) {
      // which side is the opener on?
      const side = this.axis === 'x' ? Math.sign(from.z - this.center.z) : Math.sign(from.x - this.center.x);
      this.openDir = this.axis === 'x' ? side : side;
      if (this.openDir === 0) this.openDir = 1;
    }
    this.open = open;
    this.target = open ? this.openAngle() : 0;
    return true;
  }

  update(dt: number) {
    if (Math.abs(this.angle - this.target) < 1e-3) return;
    const sp = 3.2 * dt;
    this.angle += Math.max(-sp, Math.min(sp, this.target - this.angle));
    this.leaf.rotation.y = this.angle;
    this.updateCollider();
  }

  private updateCollider() {
    this.leaf.updateWorldMatrix(true, false);
    const b = new THREE.Box3().setFromObject(this.leaf, true);
    // Open doors only block a thin slab at the hinge so they don't trap the player
    if (this.open && Math.abs(this.angle) > 0.5) {
      b.expandByScalar(-0.02);
      this.collider.flags = F.MOVE | F.CAMERA;
    } else {
      this.collider.flags = F.MOVE | F.SIGHT | F.LIGHT | F.CAMERA | F.SOUND;
    }
    this.world.update(this.collider, b.min, b.max);
  }
}

export interface WindowInfo {
  center: THREE.Vector3;
  normal: THREE.Vector3; // pointing outside
  width: number;
  sill: number;
  top: number;
  curtain?: THREE.Group;
}

export interface HouseBuild {
  group: THREE.Group;
  doors: Door[];
  windows: WindowInfo[];
  roomAt: (x: number, z: number) => RoomDef | null;
  height: number;
}

export function buildHouse(level: LevelDef, world: PhysicsWorld): HouseBuild {
  const group = new THREE.Group();
  group.name = 'house';
  const batch = new GeoBatcher();
  const H = 2.6;
  const T = WALL_T;

  const matCache = new Map<string, THREE.MeshStandardMaterial>();
  const wallMat = (r: RoomDef) => {
    const k = `${r.wall}|${r.wallColor}|${r.accent}`;
    let m = matCache.get(k);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ map: wallTexture(r.wall, r.wallColor, r.accent), roughness: 0.92 });
      matCache.set(k, m);
    }
    return m;
  };
  const trim = new THREE.MeshStandardMaterial({ color: 0xf4efe6, roughness: 0.55 });
  const trimDark = new THREE.MeshStandardMaterial({ color: 0x5a3a28, roughness: 0.6 });
  const siding = new THREE.MeshStandardMaterial({ map: sidingTexture(SIDING[level.exterior.style] ?? '#4a3a5a'), roughness: 0.9 });
  const ceilMat = new THREE.MeshStandardMaterial({ map: ceilingTexture(), roughness: 1 });
  ceilMat.map!.repeat.set(1, 1);

  // ---------------- floors ----------------
  for (const r of level.rooms) {
    const fm = new THREE.MeshStandardMaterial({
      map: floorTexture(r.floor),
      roughness: r.floor.startsWith('wood') ? 0.62 : r.floor.startsWith('tile') ? 0.3 : 0.95,
      metalness: 0,
    });
    const k = `floor:${r.floor}`;
    const m = matCache.get(k) ?? fm;
    matCache.set(k, m);
    const V = (x: number, z: number) => new THREE.Vector3(x, 0, z);
    batch.quad(m, [V(r.x, r.z + r.d), V(r.x + r.w, r.z + r.d), V(r.x + r.w, r.z), V(r.x, r.z)], new THREE.Vector3(0, 1, 0), 0.5);
    const surf: Surface = r.floor.startsWith('carpet') ? 'carpet' : r.floor.startsWith('tile') || r.floor === 'stone' ? 'tile' : 'wood';
    world.floorSurfaces.push({ minX: r.x, minZ: r.z, maxX: r.x + r.w, maxZ: r.z + r.d, surface: surf });
    // ceiling
    const C = (x: number, z: number) => new THREE.Vector3(x, H, z);
    batch.quad(ceilMat, [C(r.x, r.z), C(r.x + r.w, r.z), C(r.x + r.w, r.z + r.d), C(r.x, r.z + r.d)], new THREE.Vector3(0, -1, 0), 0.5);
  }

  // ---------------- wall runs ----------------
  const segs = new Map<string, { axis: 'x' | 'z'; line: number; s: number; pos: RoomDef | null; neg: RoomDef | null }>();
  const addSeg = (axis: 'x' | 'z', line: number, s: number, room: RoomDef, side: 'pos' | 'neg') => {
    const key = `${axis}:${line}:${s}`;
    let e = segs.get(key);
    if (!e) segs.set(key, (e = { axis, line, s, pos: null, neg: null }));
    e[side] = room;
  };
  for (const r of level.rooms) {
    for (let x = r.x; x < r.x + r.w; x++) {
      addSeg('x', r.z, x, r, 'pos');
      addSeg('x', r.z + r.d, x, r, 'neg');
    }
    for (let z = r.z; z < r.z + r.d; z++) {
      addSeg('z', r.x, z, r, 'pos');
      addSeg('z', r.x + r.w, z, r, 'neg');
    }
  }
  const runs: WallRun[] = [];
  const byLine = new Map<string, typeof segs extends Map<string, infer V> ? V[] : never>();
  for (const s of segs.values()) {
    const k = `${s.axis}:${s.line}`;
    let a = byLine.get(k);
    if (!a) byLine.set(k, (a = []));
    a.push(s);
  }
  for (const list of byLine.values()) {
    list.sort((p, q) => p.s - q.s);
    let cur: WallRun | null = null;
    for (const s of list) {
      if (cur && cur.b === s.s && cur.pos === s.pos && cur.neg === s.neg) {
        cur.b = s.s + 1;
      } else {
        if (cur) runs.push(cur);
        cur = { axis: s.axis, line: s.line, a: s.s, b: s.s + 1, pos: s.pos, neg: s.neg };
      }
    }
    if (cur) runs.push(cur);
  }

  const openings = [
    ...level.doors.map((d) => ({ ...d, type: 'door' as const })),
    ...level.windows.map((w) => ({ ...w, type: 'window' as const })),
  ];

  const doors: Door[] = [];
  const windows: WindowInfo[] = [];
  const doorMat = new THREE.MeshStandardMaterial({ color: 0xe9e1d2, roughness: 0.5 });
  const frontDoorMat = new THREE.MeshStandardMaterial({ color: 0x8c1f2b, roughness: 0.45 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xd4a94e, roughness: 0.3, metalness: 0.9 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x9fc4ee, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.18,
    emissive: 0x1b2b48, emissiveIntensity: 0.4, depthWrite: false,
  });

  // emits a slab of wall between u0..u1 along the run, y0..y1
  const slab = (run: WallRun, u0: number, u1: number, y0: number, y1: number, flags: number = F.ALL) => {
    const posMat = run.pos ? wallMat(run.pos) : siding;
    const negMat = run.neg ? wallMat(run.neg) : siding;
    let min: THREE.Vector3, max: THREE.Vector3;
    if (run.axis === 'x') {
      min = new THREE.Vector3(u0, y0, run.line - T / 2);
      max = new THREE.Vector3(u1, y1, run.line + T / 2);
      batch.box(min, max, [trim, trim, trim, trim, posMat, negMat]);
    } else {
      min = new THREE.Vector3(run.line - T / 2, y0, u0);
      max = new THREE.Vector3(run.line + T / 2, y1, u1);
      batch.box(min, max, [posMat, negMat, trim, trim, trim, trim]);
    }
    world.add(min, max, flags, { climbable: y1 < 1.2, surface: 'wood' });
  };

  for (const run of runs) {
    const ops = openings
      .filter((o) => o.axis === run.axis && Math.abs((run.axis === 'x' ? o.z : o.x) - run.line) < 0.01)
      .map((o) => {
        const c = run.axis === 'x' ? o.x : o.z;
        const w = o.width ?? 1;
        return { ...o, u0: c - w / 2, u1: c + w / 2 };
      })
      .filter((o) => o.u0 >= run.a - 0.01 && o.u1 <= run.b + 0.01)
      .sort((p, q) => p.u0 - q.u0);
    let cursor = run.a;
    const ext = T / 2;
    for (const o of ops) {
      if (o.u0 > cursor + 0.001) slab(run, cursor === run.a ? cursor - ext : cursor, o.u0, 0, H);
      if (o.type === 'door') {
        slab(run, o.u0, o.u1, DOOR_H, H);
        doorFrame(batch, run, o.u0, o.u1, trim);
        if (o.leaf) {
          const d = new Door(o, world, o.locked ? frontDoorMat : doorMat, brass);
          group.add(d.pivot);
          doors.push(d);
        }
      } else {
        const sill = o.sill ?? 0.8;
        const top = sill + (o.height ?? 1.3);
        slab(run, o.u0, o.u1, 0, sill);
        slab(run, o.u0, o.u1, top, H);
        // glass: blocks movement but not sight/light
        const gmin = run.axis === 'x' ? new THREE.Vector3(o.u0, sill, run.line - 0.02) : new THREE.Vector3(run.line - 0.02, sill, o.u0);
        const gmax = run.axis === 'x' ? new THREE.Vector3(o.u1, top, run.line + 0.02) : new THREE.Vector3(run.line + 0.02, top, o.u1);
        world.add(gmin, gmax, F.MOVE | F.NAV | F.CAMERA, { climbable: false });
        const pane = new THREE.Mesh(new THREE.BoxGeometry(gmax.x - gmin.x, gmax.y - gmin.y, gmax.z - gmin.z), glass);
        pane.position.set((gmin.x + gmax.x) / 2, (gmin.y + gmax.y) / 2, (gmin.z + gmax.z) / 2);
        pane.renderOrder = 2;
        group.add(pane);
        windowFrame(batch, run, o.u0, o.u1, sill, top, trim);
        // which side is outside?
        const outside = run.pos ? -1 : 1;
        const center = run.axis === 'x' ? new THREE.Vector3((o.u0 + o.u1) / 2, (sill + top) / 2, run.line) : new THREE.Vector3(run.line, (sill + top) / 2, (o.u0 + o.u1) / 2);
        const normal = run.axis === 'x' ? new THREE.Vector3(0, 0, outside) : new THREE.Vector3(outside, 0, 0);
        const info: WindowInfo = { center, normal, width: o.u1 - o.u0, sill, top };
        if (o.curtains) {
          info.curtain = curtains(center, normal, o.u1 - o.u0, top, o.curtains);
          group.add(info.curtain);
        }
        windows.push(info);
      }
      cursor = o.u1;
    }
    if (cursor < run.b - 0.001 || ops.length === 0) slab(run, cursor === run.a ? cursor - ext : cursor, run.b + ext, 0, H);

    // baseboards + crown moulding on interior faces (skip openings)
    const solid: [number, number][] = [];
    let c2 = run.a;
    for (const o of ops) {
      if (o.u0 > c2) solid.push([c2, o.u0]);
      if (o.type === 'window') solid.push([o.u0, o.u1]);
      c2 = o.u1;
    }
    if (c2 < run.b) solid.push([c2, run.b]);
    for (const side of [1, -1] as const) {
      const room = side === 1 ? run.pos : run.neg;
      if (!room) continue;
      const off = side * (T / 2);
      for (const [u0, u1] of solid) trimStrip(batch, run, u0, u1, off, side, 0, 0.12, 0.018, trimDark);
      trimStrip(batch, run, run.a, run.b, off, side, H - 0.08, H, 0.03, trim);
    }
  }

  // ---------------- roof slab (casts moon shadows) + gabled roof ----------------
  const [bx0, bz0, bx1, bz1] = level.bounds;
  const roofSlab = new THREE.Mesh(
    new THREE.BoxGeometry(bx1 - bx0 + 0.4, 0.2, bz1 - bz0 + 0.4),
    new THREE.MeshStandardMaterial({ color: 0x2a2633 }),
  );
  roofSlab.position.set((bx0 + bx1) / 2, H + 0.13, (bz0 + bz1) / 2);
  roofSlab.castShadow = true;
  roofSlab.receiveShadow = false;
  group.add(roofSlab);
  world.add(new THREE.Vector3(bx0 - 0.2, H, bz0 - 0.2), new THREE.Vector3(bx1 + 0.2, H + 0.2, bz1 + 0.2), F.LIGHT | F.SIGHT | F.SOUND, { climbable: false });
  group.add(gableRoof(bx0, bz0, bx1, bz1, H + 0.2, level.exterior.style));

  // chimney stack poking through the roof
  const chim = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 3.4, 0.8),
    new THREE.MeshStandardMaterial({ map: wallTexture('brick', '#8a3f33'), roughness: 0.95 }),
  );
  chim.position.set(level.chimney[0], H + 1.7, Math.max(bz0 + 0.4, level.chimney[2] - 0.2));
  chim.castShadow = true;
  const cap = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.12, 0.95), new THREE.MeshStandardMaterial({ color: 0x5a5660, roughness: 0.9 }));
  cap.position.y = 1.76;
  chim.add(cap);
  group.add(chim);

  const built = batch.build(true, true);
  built.name = 'walls';
  group.add(built);
  // foundation lip
  const found = new THREE.Mesh(
    new THREE.BoxGeometry(bx1 - bx0 + 0.3, 0.35, bz1 - bz0 + 0.3),
    new THREE.MeshStandardMaterial({ color: 0x6f6a66, roughness: 1 }),
  );
  found.position.set((bx0 + bx1) / 2, -0.19, (bz0 + bz1) / 2);
  found.receiveShadow = true;
  group.add(found);

  const roomAt = (x: number, z: number) =>
    level.rooms.find((r) => x >= r.x && x <= r.x + r.w && z >= r.z && z <= r.z + r.d) ?? null;

  return { group, doors, windows, roomAt, height: H };
}

function doorFrame(b: GeoBatcher, run: WallRun, u0: number, u1: number, m: THREE.Material) {
  const t = WALL_T / 2 + 0.03;
  const fw = 0.07;
  for (const side of [1, -1]) {
    const o = side * t;
    if (run.axis === 'x') {
      b.box(new THREE.Vector3(u0 - fw, 0, run.line + Math.min(0, o)), new THREE.Vector3(u0, DOOR_H + fw, run.line + Math.max(0, o)), [m, m, m, m, m, m]);
      b.box(new THREE.Vector3(u1, 0, run.line + Math.min(0, o)), new THREE.Vector3(u1 + fw, DOOR_H + fw, run.line + Math.max(0, o)), [m, m, m, m, m, m]);
      b.box(new THREE.Vector3(u0, DOOR_H, run.line + Math.min(0, o)), new THREE.Vector3(u1, DOOR_H + fw, run.line + Math.max(0, o)), [m, m, m, m, m, m]);
    } else {
      b.box(new THREE.Vector3(run.line + Math.min(0, o), 0, u0 - fw), new THREE.Vector3(run.line + Math.max(0, o), DOOR_H + fw, u0), [m, m, m, m, m, m]);
      b.box(new THREE.Vector3(run.line + Math.min(0, o), 0, u1), new THREE.Vector3(run.line + Math.max(0, o), DOOR_H + fw, u1 + fw), [m, m, m, m, m, m]);
      b.box(new THREE.Vector3(run.line + Math.min(0, o), DOOR_H, u0), new THREE.Vector3(run.line + Math.max(0, o), DOOR_H + fw, u1), [m, m, m, m, m, m]);
    }
  }
}

function windowFrame(b: GeoBatcher, run: WallRun, u0: number, u1: number, sill: number, top: number, m: THREE.Material) {
  const t = WALL_T / 2 + 0.035;
  const fw = 0.06;
  const mid = (u0 + u1) / 2;
  const midY = (sill + top) / 2;
  const boxes: [number, number, number, number, number][] = [
    // u0, u1, y0, y1, depthScale
    [u0 - fw, u0, sill - fw, top + fw, 1],
    [u1, u1 + fw, sill - fw, top + fw, 1],
    [u0 - fw, u1 + fw, top, top + fw, 1],
    [u0 - fw * 2, u1 + fw * 2, sill - 0.05, sill, 1.6], // sill ledge
    [mid - 0.02, mid + 0.02, sill, top, 0.3], // mullion
  ];
  for (const [a, c, y0, y1, ds] of boxes) {
    const d = t * ds;
    if (run.axis === 'x') b.box(new THREE.Vector3(a, y0, run.line - d), new THREE.Vector3(c, y1, run.line + d), [m, m, m, m, m, m]);
    else b.box(new THREE.Vector3(run.line - d, y0, a), new THREE.Vector3(run.line + d, y1, c), [m, m, m, m, m, m]);
  }
  const d = t * 0.3;
  if (run.axis === 'x') b.box(new THREE.Vector3(u0, midY - 0.02, run.line - d), new THREE.Vector3(u1, midY + 0.02, run.line + d), [m, m, m, m, m, m]);
  else b.box(new THREE.Vector3(run.line - d, midY - 0.02, u0), new THREE.Vector3(run.line + d, midY + 0.02, u1), [m, m, m, m, m, m]);
}

function trimStrip(b: GeoBatcher, run: WallRun, u0: number, u1: number, off: number, side: number, y0: number, y1: number, depth: number, m: THREE.Material) {
  const a = off, c = off + side * depth;
  if (run.axis === 'x') b.box(new THREE.Vector3(u0, y0, run.line + Math.min(a, c)), new THREE.Vector3(u1, y1, run.line + Math.max(a, c)), [m, m, m, null, m, m]);
  else b.box(new THREE.Vector3(run.line + Math.min(a, c), y0, u0), new THREE.Vector3(run.line + Math.max(a, c), y1, u1), [m, m, m, null, m, m]);
}

function curtains(center: THREE.Vector3, outward: THREE.Vector3, width: number, top: number, color: string) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.95, side: THREE.DoubleSide });
  const h = top + 0.25;
  const panelW = width * 0.38;
  for (const s of [-1, 1]) {
    const geo = new THREE.PlaneGeometry(panelW, h, 18, 1);
    const p = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 38) * 0.03);
    geo.computeVertexNormals();
    geo.translate(0, h / 2, 0);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    const along = outward.z !== 0 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    m.position.copy(center).addScaledVector(along, s * (width / 2 + panelW * 0.25)).addScaledVector(outward, -0.14);
    m.position.y = 0;
    m.lookAt(m.position.clone().sub(outward));
    g.add(m);
  }
  // rod
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, width + 0.9, 8), new THREE.MeshStandardMaterial({ color: 0x8b6b3d, metalness: 0.6, roughness: 0.4 }));
  rod.rotation.z = Math.PI / 2;
  if (outward.x !== 0) rod.rotation.set(Math.PI / 2, 0, 0);
  rod.position.copy(center).addScaledVector(outward, -0.14);
  rod.position.y = h;
  g.add(rod);
  return g;
}

const SIDING: Record<string, string> = { suburb: '#4a3a5a', farm: '#6b4a32', manor: '#2e3440', academy: '#3a4a3a' };

function gableRoof(x0: number, z0: number, x1: number, z1: number, y: number, style: string) {
  const g = new THREE.Group();
  const over = 0.5;
  const ax = x1 - x0 > z1 - z0 ? 'x' : 'z';
  const span = ax === 'x' ? z1 - z0 : x1 - x0;
  const rise = span * 0.38;
  const len = (ax === 'x' ? x1 - x0 : z1 - z0) + over * 2;
  const roofMat = new THREE.MeshStandardMaterial({ color: style === 'farm' ? 0x3b2a22 : style === 'manor' ? 0x1e2028 : 0x2a2433, roughness: 0.85 });
  const mossMat = new THREE.MeshStandardMaterial({ color: style === 'farm' ? 0x6a4a1a : 0x2f3a24, roughness: 1 });
  const slope = Math.hypot(span / 2 + over, rise);
  const ang = Math.atan2(rise, span / 2 + over);
  for (const s of [-1, 1]) {
    const roof = new THREE.Mesh(new THREE.BoxGeometry(len, 0.14, slope), roofMat);
    // shingle courses + patches of moss and fallen leaves
    for (let k = 0; k < Math.floor(slope / 0.35); k++) {
      const row = new THREE.Mesh(new THREE.BoxGeometry(len, 0.03, 0.06), roofMat);
      row.position.set(0, 0.08, -slope / 2 + 0.2 + k * 0.35);
      roof.add(row);
    }
    for (let k = 0; k < 6; k++) {
      const moss = new THREE.Mesh(new THREE.BoxGeometry(0.6 + ((k * 37) % 5) * 0.2, 0.04, 0.4 + ((k * 13) % 3) * 0.15), mossMat);
      moss.position.set(-len / 2 + 0.5 + ((k * 0.61803) % 1) * (len - 1), 0.09, -slope / 2 + 0.3 + ((k * 0.414) % 1) * (slope - 0.6));
      roof.add(moss);
    }
    roof.castShadow = true;
    roof.receiveShadow = true;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    if (ax === 'x') {
      roof.position.set(cx, y + rise / 2, cz + s * (span / 4 + over / 2));
      roof.rotation.x = s * ang;
    } else {
      roof.rotation.y = Math.PI / 2;
      roof.position.set(cx + s * (span / 4 + over / 2), y + rise / 2, cz);
      roof.rotation.z = 0;
      roof.rotateX(s * ang);
    }
    g.add(roof);
  }
  // gable ends
  const shape = new THREE.Shape();
  shape.moveTo(-span / 2, 0);
  shape.lineTo(span / 2, 0);
  shape.lineTo(0, rise);
  shape.closePath();
  const gm = new THREE.MeshStandardMaterial({ map: sidingTexture(SIDING[style] ?? '#4a3a5a'), roughness: 0.9 });
  const ggeo = new THREE.ShapeGeometry(shape);
  // world-ish UVs
  const uv = ggeo.attributes.uv as THREE.BufferAttribute;
  const pos = ggeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i), pos.getY(i));
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(ggeo, gm);
    m.material.side = THREE.DoubleSide;
    if (ax === 'x') {
      m.rotation.y = Math.PI / 2;
      m.position.set(s > 0 ? x1 : x0, y, (z0 + z1) / 2);
    } else {
      m.position.set((x0 + x1) / 2, y, s > 0 ? z1 : z0);
    }
    m.castShadow = true;
    g.add(m);
  }
  g.userData.ridge = { axis: ax, rise, y };
  return g;
}

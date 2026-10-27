// Lightweight AABB world: player/NPC collision, line-of-sight and light rays.
// Everything in the houses is boxy (Kenney style), so boxes are exact enough
// and far cheaper than a general physics engine.

import * as THREE from 'three';

export const F = {
  MOVE: 1,     // blocks movement
  SIGHT: 2,    // blocks NPC vision
  LIGHT: 4,    // blocks light (shadow-casting for the stealth light meter)
  NAV: 8,      // carved out of the NPC navigation grid
  CAMERA: 16,  // blocks the third-person camera
  SOUND: 32,   // muffles sound
  ALL: 63,
} as const;

export type Surface = 'wood' | 'carpet' | 'tile' | 'leaves' | 'soft';

export interface Collider {
  id: number;
  min: THREE.Vector3;
  max: THREE.Vector3;
  flags: number;
  surface?: Surface;
  /** arbitrary owner (door, prop…) */
  owner?: unknown;
  enabled: boolean;
  /** can the player mantle onto this? */
  climbable?: boolean;
}

export interface RayHit {
  dist: number;
  collider: Collider;
  point: THREE.Vector3;
  normal: THREE.Vector3;
}

const CELL = 2;

export class PhysicsWorld {
  colliders: Collider[] = [];
  private grid = new Map<string, Collider[]>();
  private nextId = 1;
  floorSurfaces: { minX: number; minZ: number; maxX: number; maxZ: number; surface: Surface }[] = [];

  add(min: THREE.Vector3, max: THREE.Vector3, flags: number = F.ALL, extra: Partial<Collider> = {}): Collider {
    const c: Collider = {
      id: this.nextId++,
      min: min.clone(),
      max: max.clone(),
      flags,
      enabled: true,
      climbable: true,
      ...extra,
    };
    this.colliders.push(c);
    this.index(c);
    return c;
  }

  addBox(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, flags: number = F.ALL, extra: Partial<Collider> = {}) {
    return this.add(
      new THREE.Vector3(cx - sx / 2, cy, cz - sz / 2),
      new THREE.Vector3(cx + sx / 2, cy + sy, cz + sz / 2),
      flags,
      extra,
    );
  }

  /** Add a collider from an object's world-space bounding box. */
  addFromObject(obj: THREE.Object3D, flags: number = F.ALL, extra: Partial<Collider> = {}, shrink = 0) {
    obj.updateWorldMatrix(true, true);
    const b = new THREE.Box3().setFromObject(obj);
    b.min.x += shrink; b.min.z += shrink; b.max.x -= shrink; b.max.z -= shrink;
    return this.add(b.min, b.max, flags, extra);
  }

  update(c: Collider, min: THREE.Vector3, max: THREE.Vector3) {
    this.unindex(c);
    c.min.copy(min);
    c.max.copy(max);
    this.index(c);
  }

  remove(c: Collider) {
    this.unindex(c);
    const i = this.colliders.indexOf(c);
    if (i >= 0) this.colliders.splice(i, 1);
  }

  private keys(c: Collider) {
    const out: string[] = [];
    const x0 = Math.floor(c.min.x / CELL), x1 = Math.floor(c.max.x / CELL);
    const z0 = Math.floor(c.min.z / CELL), z1 = Math.floor(c.max.z / CELL);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) out.push(`${x},${z}`);
    return out;
  }
  private index(c: Collider) {
    for (const k of this.keys(c)) {
      let a = this.grid.get(k);
      if (!a) this.grid.set(k, (a = []));
      a.push(c);
    }
  }
  private unindex(c: Collider) {
    for (const k of this.keys(c)) {
      const a = this.grid.get(k);
      if (!a) continue;
      const i = a.indexOf(c);
      if (i >= 0) a.splice(i, 1);
    }
  }

  query(minX: number, minZ: number, maxX: number, maxZ: number, flags: number): Collider[] {
    const out = new Set<Collider>();
    const x0 = Math.floor(minX / CELL), x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL), z1 = Math.floor(maxZ / CELL);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const a = this.grid.get(`${x},${z}`);
        if (!a) continue;
        for (const c of a) {
          if (!c.enabled || !(c.flags & flags)) continue;
          if (c.max.x < minX || c.min.x > maxX || c.max.z < minZ || c.min.z > maxZ) continue;
          out.add(c);
        }
      }
    }
    return [...out];
  }

  /** Ray vs boxes (slab method). dir must be normalised. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, flags: number, ignore?: (c: Collider) => boolean): RayHit | null {
    const end = origin.clone().addScaledVector(dir, maxDist);
    const cands = this.query(
      Math.min(origin.x, end.x), Math.min(origin.z, end.z),
      Math.max(origin.x, end.x), Math.max(origin.z, end.z), flags,
    );
    let best: RayHit | null = null;
    let bestT = maxDist;
    const inv = [1 / dir.x, 1 / dir.y, 1 / dir.z];
    const o = [origin.x, origin.y, origin.z];
    for (const c of cands) {
      if (ignore && ignore(c)) continue;
      const mn = [c.min.x, c.min.y, c.min.z];
      const mx = [c.max.x, c.max.y, c.max.z];
      let tmin = 0, tmax = bestT, axis = -1, sign = 1;
      let ok = true;
      for (let i = 0; i < 3; i++) {
        if (!isFinite(inv[i])) {
          if (o[i] < mn[i] || o[i] > mx[i]) { ok = false; break; }
          continue;
        }
        let t1 = (mn[i] - o[i]) * inv[i];
        let t2 = (mx[i] - o[i]) * inv[i];
        let s = -1;
        if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
        if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) { ok = false; break; }
      }
      if (!ok) continue;
      if (axis === -1) continue; // origin inside box: ignore (lets rays escape the box they start in)
      if (tmin < bestT) {
        bestT = tmin;
        const n = new THREE.Vector3();
        n.setComponent(axis, sign);
        best = { dist: tmin, collider: c, point: origin.clone().addScaledVector(dir, tmin), normal: n };
      }
    }
    return best;
  }

  /** True when nothing with `flags` lies between a and b. */
  lineClear(a: THREE.Vector3, b: THREE.Vector3, flags: number, ignore?: (c: Collider) => boolean) {
    const d = _v.subVectors(b, a);
    const len = d.length();
    if (len < 1e-4) return true;
    d.divideScalar(len);
    return !this.raycast(a, d.clone(), len - 0.02, flags, ignore);
  }

  /** Highest walkable top under a disc (for grounding). */
  groundHeight(x: number, z: number, r: number, feetY: number, maxStep: number): { y: number; surface?: Surface; collider?: Collider } {
    let y = 0;
    let surface: Surface | undefined = this.floorSurfaceAt(x, z);
    let col: Collider | undefined;
    for (const c of this.query(x - r, z - r, x + r, z + r, F.MOVE)) {
      if (c.max.y > feetY + maxStep) continue;
      if (!circleRect(x, z, r * 0.7, c)) continue;
      if (c.max.y > y) { y = c.max.y; surface = c.surface ?? 'wood'; col = c; }
    }
    return { y, surface, collider: col };
  }

  floorSurfaceAt(x: number, z: number): Surface {
    for (let i = this.floorSurfaces.length - 1; i >= 0; i--) {
      const f = this.floorSurfaces[i];
      if (x >= f.minX && x <= f.maxX && z >= f.minZ && z <= f.maxZ) return f.surface;
    }
    return 'leaves';
  }

  /**
   * Move a vertical cylinder (feet position) and resolve collisions in XZ.
   * Returns the corrected position. Steps up onto low obstacles.
   */
  moveCylinder(pos: THREE.Vector3, r: number, h: number, stepUp: number): { pos: THREE.Vector3; hitWall: boolean } {
    let hitWall = false;
    for (let iter = 0; iter < 3; iter++) {
      const cands = this.query(pos.x - r, pos.z - r, pos.x + r, pos.z + r, F.MOVE);
      let moved = false;
      for (const c of cands) {
        if (c.max.y <= pos.y + stepUp || c.min.y >= pos.y + h) continue;
        // closest point on rect
        const cx = Math.max(c.min.x, Math.min(pos.x, c.max.x));
        const cz = Math.max(c.min.z, Math.min(pos.z, c.max.z));
        let dx = pos.x - cx;
        let dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 < 1e-8) {
          // centre inside the box: push out along the shallowest axis
          const pens = [pos.x - c.min.x, c.max.x - pos.x, pos.z - c.min.z, c.max.z - pos.z];
          const m = Math.min(...pens);
          const i = pens.indexOf(m);
          if (i === 0) pos.x = c.min.x - r;
          else if (i === 1) pos.x = c.max.x + r;
          else if (i === 2) pos.z = c.min.z - r;
          else pos.z = c.max.z + r;
        } else {
          const d = Math.sqrt(d2);
          dx /= d; dz /= d;
          pos.x = cx + dx * r;
          pos.z = cz + dz * r;
        }
        hitWall = true;
        moved = true;
      }
      if (!moved) break;
    }
    return { pos, hitWall };
  }

  /** Lowest ceiling above a point (for jump / stand-up checks). */
  ceilingHeight(x: number, z: number, r: number, fromY: number): number {
    let y = Infinity;
    for (const c of this.query(x - r, z - r, x + r, z + r, F.MOVE)) {
      if (c.min.y < fromY - 0.01) continue;
      if (!circleRect(x, z, r * 0.9, c)) continue;
      y = Math.min(y, c.min.y);
    }
    return y;
  }
}

const _v = new THREE.Vector3();

export function circleRect(x: number, z: number, r: number, c: { min: THREE.Vector3; max: THREE.Vector3 }) {
  const cx = Math.max(c.min.x, Math.min(x, c.max.x));
  const cz = Math.max(c.min.z, Math.min(z, c.max.z));
  return (x - cx) ** 2 + (z - cz) ** 2 < r * r;
}

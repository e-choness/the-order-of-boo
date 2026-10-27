// Grid navigation for NPCs: A* over a 0.25 m occupancy grid + string pulling.

import * as THREE from 'three';
import { F, type PhysicsWorld } from './physics';

export class NavGrid {
  readonly cell = 0.25;
  minX: number;
  minZ: number;
  w: number;
  h: number;
  blocked: Uint8Array;
  /** extra traversal cost (e.g. near walls), keeps paths centred */
  cost: Uint8Array;
  pocketCells = 0;

  constructor(minX: number, minZ: number, maxX: number, maxZ: number) {
    this.minX = minX;
    this.minZ = minZ;
    this.w = Math.ceil((maxX - minX) / this.cell);
    this.h = Math.ceil((maxZ - minZ) / this.cell);
    this.blocked = new Uint8Array(this.w * this.h);
    this.cost = new Uint8Array(this.w * this.h);
  }

  build(world: PhysicsWorld, agentRadius = 0.28, walkable?: (x: number, z: number) => boolean) {
    const r = agentRadius;
    for (let j = 0; j < this.h; j++) {
      for (let i = 0; i < this.w; i++) {
        const x = this.minX + (i + 0.5) * this.cell;
        const z = this.minZ + (j + 0.5) * this.cell;
        let b = walkable && !walkable(x, z) ? 1 : 0;
        if (!b) {
          for (const c of world.query(x - r, z - r, x + r, z + r, F.NAV)) {
            if (c.max.y < 0.12 || c.min.y > 1.5) continue;
            b = 1;
            break;
          }
        }
        this.blocked[j * this.w + i] = b;
      }
    }
    // keep only the largest connected region so nobody paths into sealed pockets
    const comp = new Int32Array(this.w * this.h).fill(-1);
    const sizes: number[] = [];
    for (let k = 0; k < comp.length; k++) {
      if (this.blocked[k] || comp[k] >= 0) continue;
      const id = sizes.length;
      let n = 0;
      const stack = [k];
      comp[k] = id;
      while (stack.length) {
        const c = stack.pop()!;
        n++;
        const ci = c % this.w, cj = (c / this.w) | 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = ci + di, nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= this.w || nj >= this.h) continue;
          const nk = nj * this.w + ni;
          if (this.blocked[nk] || comp[nk] >= 0) continue;
          comp[nk] = id;
          stack.push(nk);
        }
      }
      sizes.push(n);
    }
    const main = sizes.indexOf(Math.max(...sizes));
    this.pocketCells = 0;
    for (let k = 0; k < comp.length; k++) {
      if (!this.blocked[k] && comp[k] !== main) { this.blocked[k] = 1; this.pocketCells++; }
    }
    // proximity cost
    for (let j = 0; j < this.h; j++) {
      for (let i = 0; i < this.w; i++) {
        let c = 0;
        for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) if (this.isBlocked(i + di, j + dj)) c++;
        this.cost[j * this.w + i] = Math.min(8, c);
      }
    }
  }

  isBlocked(i: number, j: number) {
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return true;
    return this.blocked[j * this.w + i] === 1;
  }

  toCell(x: number, z: number): [number, number] {
    return [Math.floor((x - this.minX) / this.cell), Math.floor((z - this.minZ) / this.cell)];
  }
  toWorld(i: number, j: number): THREE.Vector3 {
    return new THREE.Vector3(this.minX + (i + 0.5) * this.cell, 0, this.minZ + (j + 0.5) * this.cell);
  }

  nearestFree(i: number, j: number, maxR = 12): [number, number] | null {
    if (!this.isBlocked(i, j)) return [i, j];
    for (let r = 1; r <= maxR; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.abs(di) !== r && Math.abs(dj) !== r) continue;
          if (!this.isBlocked(i + di, j + dj)) return [i + di, j + dj];
        }
      }
    }
    return null;
  }

  walkable(x: number, z: number) {
    const [i, j] = this.toCell(x, z);
    return !this.isBlocked(i, j);
  }

  /** Random reachable point near (x,z) within radius. */
  randomNear(x: number, z: number, radius: number): THREE.Vector3 | null {
    for (let k = 0; k < 20; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * radius;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (this.walkable(px, pz)) return new THREE.Vector3(px, 0, pz);
    }
    return null;
  }

  findPath(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] | null {
    const s0 = this.toCell(from.x, from.z);
    const g0 = this.toCell(to.x, to.z);
    const s = this.nearestFree(s0[0], s0[1]);
    const g = this.nearestFree(g0[0], g0[1]);
    if (!s || !g) return null;
    const W = this.w;
    const N = this.w * this.h;
    const gScore = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const heap = new MinHeap();
    const si = s[1] * W + s[0];
    const gi = g[1] * W + g[0];
    gScore[si] = 0;
    heap.push(si, 0);
    const hfn = (i: number) => {
      const x = i % W, z = (i / W) | 0;
      const dx = Math.abs(x - g[0]), dz = Math.abs(z - g[1]);
      return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz);
    };
    const dirs = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
    let found = false;
    let iter = 0;
    while (heap.size && iter++ < 60000) {
      const cur = heap.pop();
      if (cur === gi) { found = true; break; }
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % W, cz = (cur / W) | 0;
      for (const [dx, dz, c] of dirs) {
        const nx = cx + dx, nz = cz + dz;
        if (this.isBlocked(nx, nz)) continue;
        if (dx && dz && (this.isBlocked(cx + dx, cz) || this.isBlocked(cx, cz + dz))) continue;
        const ni = nz * W + nx;
        if (closed[ni]) continue;
        const ng = gScore[cur] + c + this.cost[ni] * 0.15;
        if (ng < gScore[ni]) {
          gScore[ni] = ng;
          came[ni] = cur;
          heap.push(ni, ng + hfn(ni));
        }
      }
    }
    if (!found) return null;
    const cells: number[] = [];
    for (let c = gi; c !== -1; c = came[c]) cells.push(c);
    cells.reverse();
    const pts = cells.map((c) => this.toWorld(c % W, (c / W) | 0));
    // string pulling
    const out: THREE.Vector3[] = [pts[0]];
    let anchor = 0;
    for (let i = 2; i < pts.length; i++) {
      if (!this.gridLine(pts[anchor], pts[i])) {
        out.push(pts[i - 1]);
        anchor = i - 1;
      }
    }
    out.push(pts[pts.length - 1]);
    // final point: exact target if walkable
    if (this.walkable(to.x, to.z)) out[out.length - 1] = new THREE.Vector3(to.x, 0, to.z);
    return out;
  }

  /** Grid line-of-walk test (supercover). */
  gridLine(a: THREE.Vector3, b: THREE.Vector3) {
    const d = a.distanceTo(b);
    const steps = Math.ceil(d / (this.cell * 0.5));
    for (let k = 0; k <= steps; k++) {
      const t = k / Math.max(1, steps);
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const [i, j] = this.toCell(x, z);
      if (this.isBlocked(i, j) || this.cost[j * this.w + i] > 5) return false;
    }
    return true;
  }
}

class MinHeap {
  private ids: number[] = [];
  private pr: number[] = [];
  get size() { return this.ids.length; }
  push(id: number, p: number) {
    this.ids.push(id);
    this.pr.push(p);
    let i = this.ids.length - 1;
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (this.pr[par] <= this.pr[i]) break;
      this.swap(i, par);
      i = par;
    }
  }
  pop(): number {
    const top = this.ids[0];
    const lastId = this.ids.pop()!;
    const lastP = this.pr.pop()!;
    if (this.ids.length) {
      this.ids[0] = lastId;
      this.pr[0] = lastP;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.ids.length && this.pr[l] < this.pr[m]) m = l;
        if (r < this.ids.length && this.pr[r] < this.pr[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.ids[a], this.ids[b]] = [this.ids[b], this.ids[a]];
    [this.pr[a], this.pr[b]] = [this.pr[b], this.pr[a]];
  }
}

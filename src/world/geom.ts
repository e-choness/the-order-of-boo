// Batched quad/box emission with world-space UVs, merged per material.

import * as THREE from 'three';

interface Bucket {
  pos: number[];
  norm: number[];
  uv: number[];
}

export class GeoBatcher {
  private buckets = new Map<THREE.Material, Bucket>();

  private bucket(m: THREE.Material) {
    let b = this.buckets.get(m);
    if (!b) this.buckets.set(m, (b = { pos: [], norm: [], uv: [] }));
    return b;
  }

  /** Quad from 4 corners (counter-clockwise when viewed from the normal side). */
  quad(m: THREE.Material, p: THREE.Vector3[], n: THREE.Vector3, uvScale = 1) {
    const b = this.bucket(m);
    const uvOf = (v: THREE.Vector3) => {
      if (Math.abs(n.y) > 0.5) return [v.x * uvScale, v.z * uvScale];
      if (Math.abs(n.x) > 0.5) return [v.z * uvScale, v.y * uvScale];
      return [v.x * uvScale, v.y * uvScale];
    };
    const tri = [0, 1, 2, 0, 2, 3];
    for (const i of tri) {
      b.pos.push(p[i].x, p[i].y, p[i].z);
      b.norm.push(n.x, n.y, n.z);
      b.uv.push(...uvOf(p[i]));
    }
  }

  /**
   * Axis-aligned box. `mats` = [ +x, -x, +y, -y, +z, -z ] (null = skip face).
   */
  box(min: THREE.Vector3, max: THREE.Vector3, mats: (THREE.Material | null)[], uvScale = 1) {
    const [x0, y0, z0] = [min.x, min.y, min.z];
    const [x1, y1, z1] = [max.x, max.y, max.z];
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    if (mats[0]) this.quad(mats[0], [V(x1, y0, z1), V(x1, y0, z0), V(x1, y1, z0), V(x1, y1, z1)], V(1, 0, 0), uvScale);
    if (mats[1]) this.quad(mats[1], [V(x0, y0, z0), V(x0, y0, z1), V(x0, y1, z1), V(x0, y1, z0)], V(-1, 0, 0), uvScale);
    if (mats[2]) this.quad(mats[2], [V(x0, y1, z1), V(x1, y1, z1), V(x1, y1, z0), V(x0, y1, z0)], V(0, 1, 0), uvScale);
    if (mats[3]) this.quad(mats[3], [V(x0, y0, z0), V(x1, y0, z0), V(x1, y0, z1), V(x0, y0, z1)], V(0, -1, 0), uvScale);
    if (mats[4]) this.quad(mats[4], [V(x0, y0, z1), V(x1, y0, z1), V(x1, y1, z1), V(x0, y1, z1)], V(0, 0, 1), uvScale);
    if (mats[5]) this.quad(mats[5], [V(x1, y0, z0), V(x0, y0, z0), V(x0, y1, z0), V(x1, y1, z0)], V(0, 0, -1), uvScale);
  }

  build(castShadow = true, receiveShadow = true): THREE.Group {
    const g = new THREE.Group();
    for (const [m, b] of this.buckets) {
      if (!b.pos.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.norm, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, m);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      g.add(mesh);
    }
    this.buckets.clear();
    return g;
  }
}

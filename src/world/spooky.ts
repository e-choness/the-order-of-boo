// Procedural Halloween props, built in the same chunky low-poly, flat-colour
// style as the Kenney kits. Referenced from level data as 'spooky/<name>' and
// sized in metres (kit scale 1).

import * as THREE from 'three';

export const SPOOKY_MODELS = [
  'pumpkin', 'pumpkinSmall', 'pumpkinLarge', 'pumpkinWhite', 'jackOLantern', 'gourds', 'gravestone', 'gravestoneCross',
  'candles', 'cauldron', 'skull', 'witchHat', 'broom', 'scarecrow', 'hayBale', 'coffin', 'candyBowl', 'spellbook',
  'potion', 'crow', 'catStatue', 'costumeRack', 'deadTree', 'fence', 'inflatableGhost', 'web', 'spider', 'leafPile',
  'lanternPost', 'mask',
] as const;
export type SpookyModel = (typeof SPOOKY_MODELS)[number];

const mats = new Map<string, THREE.MeshStandardMaterial>();
function M(color: number | string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}, name?: string) {
  const key = `${color}|${JSON.stringify(extra)}|${name ?? ''}`;
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.75, flatShading: true, ...extra });
    if (name) m.name = name;
    mats.set(key, m);
  }
  return m;
}

const ORANGE = 0xe8731c;
const ORANGE_D = 0xc4581a;
const STEM = 0x5a4a22;
const STONE = 0x8a8a92;
const IRON = 0x1e1d24;

/** Deterministic pseudo-random for shapes that should look hand-made but stable. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mesh(g: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return m;
}

/** A ribbed pumpkin body: a squashed sphere pushed in along 8–10 grooves. */
function pumpkinGeo(r: number, h: number, ribs = 9) {
  const geo = new THREE.SphereGeometry(r, ribs * 2, 10);
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const a = Math.atan2(v.z, v.x);
    const k = 1 - 0.09 * Math.pow(Math.abs(Math.cos((a * ribs) / 2)), 6);
    const yk = v.y / r;
    v.x *= k;
    v.z *= k;
    v.y = yk * (h / 2) * (yk < 0 ? 0.92 : 1) - Math.pow(1 - Math.abs(yk), 8) * 0;
    // dimple at the top and bottom
    if (Math.abs(yk) > 0.85) v.y *= 0.9;
    p.setXYZ(i, v.x, v.y + h / 2, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

function pumpkin(r: number, h: number, color = ORANGE, seed = 1): THREE.Group {
  const g = new THREE.Group();
  mesh(g, pumpkinGeo(r, h), M(color, { roughness: 0.6 }, 'pumpkin'));
  const rand = rng(seed);
  const stem = mesh(g, new THREE.CylinderGeometry(r * 0.08, r * 0.13, r * 0.4, 6), M(STEM), 0, h + r * 0.12, 0);
  stem.rotation.z = (rand() - 0.5) * 0.6;
  stem.rotation.x = (rand() - 0.5) * 0.4;
  return g;
}

function carvedFace(g: THREE.Group, r: number, h: number, glow = 0xffa030) {
  const lit = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: glow, emissiveIntensity: 3.2, side: THREE.DoubleSide, name: 'lanternGlow' });
  const z = r * 0.97;
  const cy = h * 0.55;
  const tri = (sx: number) => {
    const s = new THREE.Shape();
    s.moveTo(-r * 0.15, 0); s.lineTo(r * 0.15, 0); s.lineTo(0, r * 0.22);
    const m = new THREE.Mesh(new THREE.ShapeGeometry(s), lit);
    m.position.set(sx * r * 0.33, cy + r * 0.08, z * 0.93);
    m.rotation.y = sx * 0.35;
    g.add(m);
  };
  tri(-1); tri(1);
  const nose = new THREE.Shape();
  nose.moveTo(-r * 0.07, 0); nose.lineTo(r * 0.07, 0); nose.lineTo(0, r * 0.12);
  const n = new THREE.Mesh(new THREE.ShapeGeometry(nose), lit);
  n.position.set(0, cy - r * 0.08, z);
  g.add(n);
  const mouth = new THREE.Shape();
  const w = r * 0.55;
  mouth.moveTo(-w, 0);
  for (let i = 0; i <= 6; i++) {
    const x = -w + (i / 6) * w * 2;
    mouth.lineTo(x, i % 2 ? -r * 0.05 : r * 0.02);
  }
  mouth.lineTo(w * 0.8, -r * 0.2);
  mouth.lineTo(-w * 0.8, -r * 0.2);
  mouth.lineTo(-w, 0);
  const mo = new THREE.Mesh(new THREE.ShapeGeometry(mouth), lit);
  mo.position.set(0, cy - r * 0.22, z * 0.95);
  g.add(mo);
}

function labelTex(text: string, bg: string, fg: string, w = 256, h = 128, font = '700 70px Fraunces Variable, serif') {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d')!;
  x.fillStyle = bg; x.fillRect(0, 0, w, h);
  x.fillStyle = fg; x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, w / 2, h / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let webTex: THREE.CanvasTexture | null = null;
export function cobwebTexture() {
  if (webTex) return webTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d')!;
  x.strokeStyle = 'rgba(235,235,245,0.85)';
  x.lineWidth = 1.6;
  // a quarter web anchored in the top-left corner
  const spokes = 7;
  for (let i = 0; i <= spokes; i++) {
    const a = (i / spokes) * Math.PI / 2;
    x.beginPath(); x.moveTo(0, 0); x.lineTo(Math.cos(a) * 250, Math.sin(a) * 250); x.stroke();
  }
  for (let r = 30; r < 250; r += 26 + r * 0.08) {
    x.beginPath();
    for (let i = 0; i <= spokes; i++) {
      const a = (i / spokes) * Math.PI / 2;
      const rr = r * (0.94 + ((i * 37) % 7) * 0.012);
      const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
      if (i === 0) x.moveTo(px, py);
      else {
        const pa = ((i - 0.5) / spokes) * Math.PI / 2;
        x.quadraticCurveTo(Math.cos(pa) * rr * 0.9, Math.sin(pa) * rr * 0.9, px, py);
      }
    }
    x.stroke();
  }
  webTex = new THREE.CanvasTexture(c);
  webTex.colorSpace = THREE.SRGBColorSpace;
  return webTex;
}

function deadTree(seed: number) {
  const g = new THREE.Group();
  const rand = rng(seed);
  const bark = M(0x2a211c, { roughness: 1 });
  const branch = (from: THREE.Vector3, dir: THREE.Vector3, len: number, rad: number, depth: number) => {
    const to = from.clone().addScaledVector(dir, len);
    const geo = new THREE.CylinderGeometry(rad * 0.62, rad, len, 5);
    const m = mesh(g, geo, bark);
    m.position.copy(from).add(to).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    if (depth <= 0) return;
    const n = depth > 2 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const d = dir.clone().add(new THREE.Vector3((rand() - 0.5) * 1.6, rand() * 0.4, (rand() - 0.5) * 1.6)).normalize();
      if (d.y < 0.1) d.y = 0.1;
      branch(to, d.normalize(), len * (0.6 + rand() * 0.15), rad * 0.62, depth - 1);
    }
  };
  branch(new THREE.Vector3(0, 0, 0), new THREE.Vector3((rand() - 0.5) * 0.15, 1, (rand() - 0.5) * 0.15).normalize(), 1.6, 0.2, 4);
  return g;
}

/** Build the template for a spooky model (the asset cache clones it). */
export function spookyModel(name: string): THREE.Group {
  const g = new THREE.Group();
  switch (name as SpookyModel) {
    case 'pumpkin': return pumpkin(0.16, 0.24, ORANGE, 1);
    case 'pumpkinSmall': return pumpkin(0.09, 0.13, 0xef8a2a, 2);
    case 'pumpkinLarge': return pumpkin(0.28, 0.4, ORANGE_D, 3);
    case 'pumpkinWhite': return pumpkin(0.15, 0.2, 0xeee6d4, 4);
    case 'jackOLantern': {
      const p = pumpkin(0.17, 0.26, ORANGE, 5);
      carvedFace(p, 0.17, 0.26);
      return p;
    }
    case 'gourds': {
      const a = pumpkin(0.07, 0.1, 0xd8b23a, 6); a.position.set(-0.07, 0, 0.02);
      const b = pumpkin(0.06, 0.09, 0x4f7a3a, 7); b.position.set(0.07, 0, -0.03);
      const c = pumpkin(0.08, 0.1, 0xeee6d4, 8); c.position.set(0.0, 0, 0.08);
      g.add(a, b, c);
      return g;
    }
    case 'gravestone': {
      const stone = M(STONE, { roughness: 0.95 });
      mesh(g, new THREE.BoxGeometry(0.5, 0.5, 0.12), stone, 0, 0.25, 0);
      // half-disc cap: rotate the half cylinder so its axis runs front-to-back and the arc points up
      mesh(g, new THREE.CylinderGeometry(0.25, 0.25, 0.12, 12, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), stone, 0, 0.5, 0);
      const lbl = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.15), new THREE.MeshStandardMaterial({ map: labelTex('R.I.P.', '#8a8a92', '#3a3a42'), roughness: 0.95 }));
      lbl.position.set(0, 0.45, 0.061);
      g.add(lbl);
      mesh(g, new THREE.BoxGeometry(0.6, 0.06, 0.22), M(0x4a5a34, { roughness: 1 }), 0, 0.03, 0.04);
      return g;
    }
    case 'gravestoneCross': {
      const stone = M(0x9a9aa2, { roughness: 0.95 });
      mesh(g, new THREE.BoxGeometry(0.12, 0.9, 0.1), stone, 0, 0.45, 0);
      mesh(g, new THREE.BoxGeometry(0.46, 0.12, 0.1), stone, 0, 0.66, 0);
      mesh(g, new THREE.BoxGeometry(0.3, 0.1, 0.2), stone, 0, 0.05, 0);
      return g;
    }
    case 'candles': {
      const wax = M(0xf1e6cc, { roughness: 0.5 });
      const flame = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffb04a, emissiveIntensity: 4, name: 'lanternGlow' });
      for (const [x, z, h] of [[-0.04, 0, 0.16], [0.04, 0.02, 0.11], [0, -0.045, 0.08]]) {
        mesh(g, new THREE.CylinderGeometry(0.022, 0.025, h, 8), wax, x, h / 2, z);
        mesh(g, new THREE.ConeGeometry(0.009, 0.03, 6), flame, x, h + 0.02, z).castShadow = false;
      }
      return g;
    }
    case 'cauldron': {
      const iron = M(IRON, { metalness: 0.6, roughness: 0.45 });
      const pot = mesh(g, new THREE.SphereGeometry(0.25, 12, 8, 0, Math.PI * 2, Math.PI * 0.25, Math.PI * 0.75), iron, 0, 0.27, 0);
      pot.scale.y = 0.9;
      mesh(g, new THREE.TorusGeometry(0.18, 0.025, 6, 16), iron, 0, 0.43, 0).rotation.x = Math.PI / 2;
      const brew = new THREE.MeshStandardMaterial({ color: 0x173a10, emissive: 0x5cff4a, emissiveIntensity: 1.6, roughness: 0.2, name: 'brewGlow' });
      mesh(g, new THREE.CircleGeometry(0.17, 16), brew, 0, 0.415, 0).rotation.x = -Math.PI / 2;
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        mesh(g, new THREE.BoxGeometry(0.04, 0.1, 0.04), iron, Math.cos(a) * 0.15, 0.05, Math.sin(a) * 0.15);
      }
      for (let i = 0; i < 4; i++) {
        const b = mesh(g, new THREE.SphereGeometry(0.02 + i * 0.006, 6, 4), brew, Math.cos(i * 2.3) * 0.08, 0.42, Math.sin(i * 2.3) * 0.08);
        b.castShadow = false;
      }
      return g;
    }
    case 'skull': {
      const bone = M(0xeae2cc, { roughness: 0.6 });
      const dark = M(0x15110f);
      mesh(g, new THREE.IcosahedronGeometry(0.06, 1), bone, 0, 0.07, 0).scale.set(1, 0.95, 1.1);
      mesh(g, new THREE.BoxGeometry(0.07, 0.035, 0.06), bone, 0, 0.025, 0.03);
      for (const sx of [-1, 1]) mesh(g, new THREE.SphereGeometry(0.016, 6, 4), dark, sx * 0.024, 0.07, 0.056);
      mesh(g, new THREE.ConeGeometry(0.008, 0.016, 3), dark, 0, 0.048, 0.064).rotation.x = Math.PI;
      return g;
    }
    case 'witchHat': {
      const felt = M(0x1f1630, { roughness: 0.9 });
      mesh(g, new THREE.CylinderGeometry(0.2, 0.2, 0.012, 16), felt, 0, 0.006, 0);
      const cone = mesh(g, new THREE.ConeGeometry(0.1, 0.3, 10), felt, 0, 0.16, 0);
      cone.rotation.z = 0.15;
      mesh(g, new THREE.CylinderGeometry(0.098, 0.1, 0.03, 10), M(0x8b4bd6), 0, 0.03, 0);
      mesh(g, new THREE.BoxGeometry(0.035, 0.03, 0.01), M(0xe8c062, { metalness: 0.8, roughness: 0.3 }), 0, 0.03, 0.1);
      return g;
    }
    case 'broom': {
      const stick = mesh(g, new THREE.CylinderGeometry(0.015, 0.018, 1.2, 6), M(0x7a5232), 0, 0.75, 0);
      stick.rotation.z = 0;
      mesh(g, new THREE.ConeGeometry(0.12, 0.35, 8), M(0xc9a04a, { roughness: 1 }), 0, 0.17, 0).rotation.x = Math.PI;
      mesh(g, new THREE.TorusGeometry(0.045, 0.012, 5, 10), M(0x8b2f2f), 0, 0.3, 0).rotation.x = Math.PI / 2;
      g.rotation.z = 0.18;
      const w = new THREE.Group();
      w.add(g);
      return w;
    }
    case 'scarecrow': {
      const post = M(0x6b4a2e);
      mesh(g, new THREE.BoxGeometry(0.08, 1.7, 0.08), post, 0, 0.85, 0);
      mesh(g, new THREE.BoxGeometry(1.1, 0.07, 0.07), post, 0, 1.3, 0);
      mesh(g, new THREE.BoxGeometry(0.42, 0.5, 0.22), M(0x7a3b34, { roughness: 1 }), 0, 1.15, 0);
      for (const sx of [-1, 1]) {
        mesh(g, new THREE.BoxGeometry(0.4, 0.14, 0.14), M(0x7a3b34, { roughness: 1 }), sx * 0.38, 1.3, 0);
        mesh(g, new THREE.ConeGeometry(0.07, 0.16, 5), M(0xd9b04a, { roughness: 1 }), sx * 0.64, 1.3, 0).rotation.z = sx * Math.PI / 2;
      }
      const head = mesh(g, new THREE.IcosahedronGeometry(0.16, 1), M(0xc9a87a, { roughness: 1 }), 0, 1.58, 0);
      head.scale.set(1, 1.05, 0.95);
      const dark = M(0x1a1410);
      for (const sx of [-1, 1]) mesh(g, new THREE.BoxGeometry(0.04, 0.04, 0.02), dark, sx * 0.055, 1.6, 0.15);
      mesh(g, new THREE.BoxGeometry(0.12, 0.015, 0.02), dark, 0, 1.52, 0.15);
      mesh(g, new THREE.CylinderGeometry(0.28, 0.28, 0.02, 12), M(0x5b4a2a), 0, 1.72, 0);
      mesh(g, new THREE.ConeGeometry(0.14, 0.24, 8), M(0x5b4a2a), 0, 1.84, 0).rotation.z = -0.2;
      return g;
    }
    case 'hayBale': {
      mesh(g, new THREE.BoxGeometry(1.0, 0.45, 0.5), M(0xd4b25a, { roughness: 1 }), 0, 0.225, 0);
      for (const x of [-0.25, 0.25]) mesh(g, new THREE.BoxGeometry(0.03, 0.46, 0.51), M(0x8a6a2a), x, 0.225, 0);
      return g;
    }
    case 'coffin': {
      const s = new THREE.Shape();
      s.moveTo(-0.22, -1.0); s.lineTo(0.22, -1.0); s.lineTo(0.36, 0.45); s.lineTo(0.22, 1.0);
      s.lineTo(-0.22, 1.0); s.lineTo(-0.36, 0.45); s.lineTo(-0.22, -1.0);
      const geo = new THREE.ExtrudeGeometry(s, { depth: 0.45, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);
      const box = mesh(g, geo, M(0x3a2218, { roughness: 0.55 }));
      box.position.y = 0;
      mesh(g, new THREE.BoxGeometry(0.06, 0.012, 0.5), M(0xb89a5a, { metalness: 0.7, roughness: 0.35 }), 0, 0.456, -0.2);
      mesh(g, new THREE.BoxGeometry(0.28, 0.012, 0.06), M(0xb89a5a, { metalness: 0.7, roughness: 0.35 }), 0, 0.456, -0.3);
      return g;
    }
    case 'candyBowl': {
      const pts = [new THREE.Vector2(0.0, 0), new THREE.Vector2(0.08, 0), new THREE.Vector2(0.15, 0.05), new THREE.Vector2(0.17, 0.11), new THREE.Vector2(0.16, 0.115)];
      mesh(g, new THREE.LatheGeometry(pts, 14), M(0x2b2140, { roughness: 0.4, side: THREE.DoubleSide }));
      const cols = [0xff7a1a, 0x8b5cf6, 0x7cff6b, 0xffd36e, 0xff4d6d, 0xffffff];
      const rand = rng(11);
      for (let i = 0; i < 14; i++) {
        const a = rand() * Math.PI * 2, r = rand() * 0.11;
        const c = mesh(g, i % 3 ? new THREE.BoxGeometry(0.045, 0.02, 0.025) : new THREE.SphereGeometry(0.018, 6, 4), M(cols[i % cols.length], { roughness: 0.3 }), Math.cos(a) * r, 0.085 + rand() * 0.03, Math.sin(a) * r);
        c.rotation.set(rand() * 3, rand() * 3, rand() * 3);
      }
      return g;
    }
    case 'spellbook': {
      mesh(g, new THREE.BoxGeometry(0.2, 0.05, 0.26), M(0x4a2a6a), 0, 0.025, 0);
      mesh(g, new THREE.BoxGeometry(0.19, 0.04, 0.25), M(0xeee2c4), 0.006, 0.025, 0);
      mesh(g, new THREE.BoxGeometry(0.06, 0.004, 0.06), M(0xe8c062, { metalness: 0.8, roughness: 0.3, emissive: 0x3a2a00 }), 0, 0.052, 0);
      return g;
    }
    case 'potion': {
      const pts = [new THREE.Vector2(0, 0), new THREE.Vector2(0.05, 0), new THREE.Vector2(0.06, 0.04), new THREE.Vector2(0.055, 0.09), new THREE.Vector2(0.02, 0.12), new THREE.Vector2(0.018, 0.17), new THREE.Vector2(0.0, 0.17)];
      mesh(g, new THREE.LatheGeometry(pts, 10), new THREE.MeshStandardMaterial({ color: 0x2a6a3a, emissive: 0x3cff6a, emissiveIntensity: 0.9, roughness: 0.15, metalness: 0.1, name: 'potionGlass' }));
      mesh(g, new THREE.CylinderGeometry(0.02, 0.016, 0.03, 8), M(0x8b5a2b), 0, 0.18, 0);
      return g;
    }
    case 'crow': {
      const black = M(0x14121a, { roughness: 0.5 });
      const body = mesh(g, new THREE.IcosahedronGeometry(0.07, 0), black, 0, 0.1, 0);
      body.scale.set(0.8, 0.85, 1.4);
      mesh(g, new THREE.IcosahedronGeometry(0.045, 0), black, 0, 0.17, 0.07);
      mesh(g, new THREE.ConeGeometry(0.015, 0.06, 4), M(0x3a3a3a), 0, 0.165, 0.13).rotation.x = Math.PI / 2;
      mesh(g, new THREE.BoxGeometry(0.06, 0.012, 0.09), black, 0, 0.09, -0.11).rotation.x = -0.4;
      for (const sx of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.009, 6, 4), new THREE.MeshStandardMaterial({ color: 0, emissive: 0xffd040, emissiveIntensity: 2 }));
        eye.position.set(sx * 0.03, 0.18, 0.1);
        g.add(eye);
        mesh(g, new THREE.BoxGeometry(0.006, 0.05, 0.006), M(0x3a3a3a), sx * 0.025, 0.025, 0);
      }
      return g;
    }
    case 'catStatue': {
      const black = M(0x18141f, { roughness: 0.35, metalness: 0.2 });
      const body = mesh(g, new THREE.CylinderGeometry(0.06, 0.09, 0.2, 8), black, 0, 0.1, 0);
      body.scale.z = 0.8;
      mesh(g, new THREE.IcosahedronGeometry(0.065, 1), black, 0, 0.25, 0.02);
      for (const sx of [-1, 1]) {
        mesh(g, new THREE.ConeGeometry(0.025, 0.05, 4), black, sx * 0.035, 0.31, 0.02);
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.01, 6, 4), new THREE.MeshStandardMaterial({ color: 0, emissive: 0xc8ff40, emissiveIntensity: 2.4 }));
        eye.position.set(sx * 0.024, 0.26, 0.075);
        g.add(eye);
      }
      const tail = mesh(g, new THREE.TorusGeometry(0.08, 0.012, 5, 10, Math.PI), black, 0.0, 0.02, -0.02);
      tail.rotation.x = -Math.PI / 2;
      return g;
    }
    case 'costumeRack': {
      const metal = M(0x3a3a44, { metalness: 0.7, roughness: 0.35 });
      for (const x of [-0.55, 0.55]) {
        mesh(g, new THREE.BoxGeometry(0.03, 1.6, 0.03), metal, x, 0.8, 0);
        mesh(g, new THREE.BoxGeometry(0.03, 0.03, 0.45), metal, x, 0.02, 0);
      }
      mesh(g, new THREE.CylinderGeometry(0.015, 0.015, 1.12, 6), metal, 0, 1.58, 0).rotation.z = Math.PI / 2;
      const cols = [0x2a1a3a, 0xc0392b, 0xe8731c, 0x1f5a35, 0xeeeeee, 0x111111];
      for (let i = 0; i < 6; i++) {
        const c = mesh(g, new THREE.BoxGeometry(0.06, 0.9 + (i % 3) * 0.12, 0.38), M(cols[i], { roughness: 0.95 }), -0.42 + i * 0.17, 1.1 - (0.45 + (i % 3) * 0.06), 0);
        c.rotation.y = (i % 2 ? 0.08 : -0.06);
      }
      return g;
    }
    case 'deadTree': return deadTree(7);
    case 'fence': {
      const iron = M(IRON, { metalness: 0.5, roughness: 0.5 });
      for (const y of [0.15, 0.95]) mesh(g, new THREE.BoxGeometry(2, 0.04, 0.04), iron, 0, y, 0);
      for (let i = 0; i < 9; i++) {
        const x = -0.95 + i * 0.2375;
        mesh(g, new THREE.BoxGeometry(0.03, 1.1, 0.03), iron, x, 0.55, 0);
        mesh(g, new THREE.ConeGeometry(0.03, 0.1, 4), iron, x, 1.15, 0);
      }
      return g;
    }
    case 'inflatableGhost': {
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        const y = t * 1.8;
        const r = t > 0.7 ? Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.7) / 0.3, 2))) * 0.45 : 0.45 + (0.7 - t) * 0.25;
        pts.push(new THREE.Vector2(Math.max(0.001, r), y));
      }
      mesh(g, new THREE.LatheGeometry(pts, 14), new THREE.MeshStandardMaterial({ color: 0xf4f2ff, emissive: 0x9fb4ff, emissiveIntensity: 0.25, roughness: 0.6, flatShading: true }));
      const dark = M(0x111118);
      for (const sx of [-1, 1]) mesh(g, new THREE.SphereGeometry(0.07, 8, 6), dark, sx * 0.14, 1.5, 0.38).scale.z = 0.4;
      mesh(g, new THREE.SphereGeometry(0.09, 8, 6), dark, 0, 1.3, 0.41).scale.set(0.8, 1.1, 0.35);
      return g;
    }
    case 'web': {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), new THREE.MeshBasicMaterial({ map: cobwebTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0.8 }));
      m.position.set(0.4, -0.4, 0);
      g.add(m);
      return g;
    }
    case 'spider': {
      const black = M(0x111111, { roughness: 0.4 });
      mesh(g, new THREE.SphereGeometry(0.07, 8, 6), black, 0, 0.08, -0.05).scale.set(1, 0.8, 1.2);
      mesh(g, new THREE.SphereGeometry(0.04, 8, 6), black, 0, 0.07, 0.05);
      for (const sx of [-1, 1]) {
        for (let i = 0; i < 4; i++) {
          const l = mesh(g, new THREE.BoxGeometry(0.16, 0.012, 0.012), black, sx * 0.08, 0.06, -0.04 + i * 0.03);
          l.rotation.set(0, (i - 1.5) * 0.35 * sx, -sx * 0.5);
        }
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 4), new THREE.MeshStandardMaterial({ color: 0, emissive: 0xff2030, emissiveIntensity: 2 }));
        eye.position.set(sx * 0.015, 0.085, 0.085);
        g.add(eye);
      }
      return g;
    }
    case 'leafPile': {
      const rand = rng(21);
      const cols = [0xc4581a, 0xd88a2a, 0x8a3a1a, 0xb8902a];
      for (let i = 0; i < 14; i++) {
        const m = mesh(g, new THREE.IcosahedronGeometry(0.22 + rand() * 0.12, 0), M(cols[i % 4], { roughness: 1 }), (rand() - 0.5) * 0.8, 0.1 + rand() * 0.15, (rand() - 0.5) * 0.8);
        m.scale.y = 0.55;
      }
      return g;
    }
    case 'lanternPost': {
      const iron = M(IRON, { metalness: 0.5, roughness: 0.5 });
      mesh(g, new THREE.CylinderGeometry(0.04, 0.06, 2.1, 6), iron, 0, 1.05, 0);
      mesh(g, new THREE.BoxGeometry(0.22, 0.28, 0.22), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffa040, emissiveIntensity: 2.4, name: 'lanternGlow' }), 0, 2.2, 0);
      mesh(g, new THREE.ConeGeometry(0.2, 0.16, 4), iron, 0, 2.42, 0).rotation.y = Math.PI / 4;
      return g;
    }
    case 'mask': {
      const m = mesh(g, new THREE.SphereGeometry(0.1, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), M(0xeae6dc, { side: THREE.DoubleSide }), 0, 0.02, 0);
      m.rotation.x = -Math.PI / 2;
      m.scale.set(0.8, 1, 0.3);
      for (const sx of [-1, 1]) mesh(g, new THREE.CircleGeometry(0.02, 8), M(0x111111), sx * 0.032, 0.036, 0.025).rotation.x = -Math.PI / 2;
      return g;
    }
    default:
      mesh(g, new THREE.BoxGeometry(0.1, 0.1, 0.1), M(0xff00ff));
      return g;
  }
}

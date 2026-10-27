// Model + texture loading. All 3D art is CC0 by Kenney (www.kenney.nl):
// Furniture Kit, Holiday Kit, Food Kit, Blocky Characters and Particle Pack.
// Halloween props ('spooky/*') are procedural, see world/spooky.ts.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { spookyModel } from '../world/spooky';

const BASE = './assets/';
const loader = new GLTFLoader();
const texLoader = new THREE.TextureLoader();

const models = new Map<string, THREE.Group>();
const textures = new Map<string, THREE.Texture>();

/** Material names in the Kenney kits that should glow at night. */
const EMISSIVE_HINTS: Record<string, [number, number]> = {
  lamp: [0xffd9a0, 2.2],
  light: [0xffd9a0, 2.2],
  bulb: [0xffe4b5, 3],
};

export async function loadModel(path: string): Promise<THREE.Group> {
  const hit = models.get(path);
  if (hit) return hit;
  if (path.startsWith('spooky/')) {
    const m = spookyModel(path.slice(7));
    models.set(path, m);
    return m;
  }
  const ext = path.endsWith('.gltf') ? '' : '.glb';
  const gltf = await loader.loadAsync(`${BASE}models/${path}${ext}`);
  const root = gltf.scene;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats as THREE.MeshStandardMaterial[]) {
        mat.side = THREE.FrontSide;
        // Kenney flat colours look best slightly rough + non-metal under warm lights
        if (mat.metalness > 0.5 && !/metal|glass/i.test(mat.name)) mat.metalness = 0.2;
        mat.roughness = Math.max(mat.roughness ?? 1, /glass/i.test(mat.name) ? 0.1 : 0.55);
        if (/glass/i.test(mat.name)) {
          mat.transparent = true;
          mat.opacity = 0.45;
        }
        for (const [k, [c, i]] of Object.entries(EMISSIVE_HINTS)) {
          if (mat.name.toLowerCase().includes(k)) {
            mat.emissive = new THREE.Color(c);
            mat.emissiveIntensity = i;
          }
        }
      }
    }
  });
  models.set(path, root);
  return root;
}

/** Deep clone that shares geometry but gives each instance its own materials when asked. */
export function cloneModel(path: string, uniqueMaterials = false): THREE.Group {
  let src = models.get(path);
  // procedural props are built synchronously on first use
  if (!src && path.startsWith('spooky/')) models.set(path, (src = spookyModel(path.slice(7))));
  if (!src) throw new Error(`Model not preloaded: ${path}`);
  const c = src.clone(true);
  if (uniqueMaterials) {
    c.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
    });
  }
  return c;
}

export function hasModel(path: string) {
  return models.has(path);
}

export async function preloadModels(paths: string[], onProgress?: (p: number) => void) {
  let done = 0;
  const uniq = [...new Set(paths)];
  await Promise.all(
    uniq.map(async (p) => {
      try {
        await loadModel(p);
      } catch (e) {
        console.warn('Failed to load model', p, e);
      }
      done++;
      onProgress?.(done / uniq.length);
    }),
  );
}

export function loadTexture(path: string, srgb = true): THREE.Texture {
  const hit = textures.get(path);
  if (hit) return hit;
  const t = texLoader.load(`${BASE}textures/${path}`);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  textures.set(path, t);
  return t;
}

export async function loadImage(path: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = `${BASE}textures/${path}`;
  await img.decode();
  return img;
}

// ---------------------------------------------------------------------------
// Character skins: Kenney blocky character skins, recoloured into costumes,
// pyjamas and jumpers at runtime so every family member looks distinct.

export interface SkinRecipe {
  base: 'man' | 'woman' | 'manAlternative' | 'womanAlternative' | 'adventurer' | 'soldier' | 'robot' | 'orc';
  shirt?: string;   // replaces the main garment colour
  pants?: string;   // replaces the trouser colour
  hair?: string;    // replaces hair colour
  skin?: string;    // replaces skin tone
  pattern?: 'stripes' | 'bones' | 'bats' | 'plaid' | 'stars' | 'none';
  patternColor?: string;
}

const skinCache = new Map<string, THREE.Texture>();

function hexToRgb(hex: string): [number, number, number] {
  const c = new THREE.Color(hex);
  return [c.r * 255, c.g * 255, c.b * 255];
}

export async function makeSkin(r: SkinRecipe): Promise<THREE.Texture> {
  const key = JSON.stringify(r);
  const hit = skinCache.get(key);
  if (hit) return hit;
  const img = await loadImage(`skins/skin_${r.base}.png`);
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, S, S);
  const data = g.getImageData(0, 0, S, S);
  const px = data.data;
  const sample = (u: number, v: number) => {
    const i = ((Math.floor(v * S) * S) + Math.floor(u * S)) * 4;
    return [px[i], px[i + 1], px[i + 2]] as [number, number, number];
  };
  // Reference colours sampled from the Kenney skin layout
  const refShirt = sample(0.62, 0.52);
  const refPants = sample(0.42, 0.8);
  const refHair = sample(0.3, 0.05);
  const refSkin = sample(0.3, 0.35);
  const swaps: [number[], number[] | null][] = [
    [refShirt, r.shirt ? hexToRgb(r.shirt) : null],
    [refPants, r.pants ? hexToRgb(r.pants) : null],
    [refHair, r.hair ? hexToRgb(r.hair) : null],
    [refSkin, r.skin ? hexToRgb(r.skin) : null],
  ];
  const lum = (c: number[]) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] + 1;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 10) continue;
    const c = [px[i], px[i + 1], px[i + 2]];
    for (const [ref, to] of swaps) {
      if (!to) continue;
      // hue-ish distance using normalised chroma so darker shades of the same garment still match
      const lr = lum(ref), lc = lum(c);
      const dn = Math.hypot(c[0] / lc - ref[0] / lr, c[1] / lc - ref[1] / lr, c[2] / lc - ref[2] / lr);
      if (dn < 0.12 && Math.abs(lc - lr) < 90) {
        const k = lc / lr;
        px[i] = Math.min(255, to[0] * k);
        px[i + 1] = Math.min(255, to[1] * k);
        px[i + 2] = Math.min(255, to[2] * k);
        break;
      }
    }
  }
  g.putImageData(data, 0, 0);
  // costume / pyjama prints painted over the torso panel
  if (r.pattern && r.pattern !== 'none') {
    g.save();
    g.beginPath();
    g.rect(S * 0.40, S * 0.40, S * 0.44, S * 0.2);
    g.clip();
    g.fillStyle = r.patternColor ?? '#ffffff';
    g.globalAlpha = 0.85;
    if (r.pattern === 'stripes') {
      for (let y = S * 0.41; y < S * 0.6; y += 14) g.fillRect(S * 0.4, y, S * 0.44, 5);
    } else if (r.pattern === 'plaid') {
      g.globalAlpha = 0.35;
      for (let y = S * 0.4; y < S * 0.6; y += 18) g.fillRect(S * 0.4, y, S * 0.44, 6);
      for (let x = S * 0.4; x < S * 0.84; x += 18) g.fillRect(x, S * 0.4, 6, S * 0.2);
    } else if (r.pattern === 'stars') {
      for (let y = S * 0.43; y < S * 0.6; y += 24) {
        for (let x = S * 0.42 + ((y / 24) % 2) * 12; x < S * 0.84; x += 24) {
          g.beginPath();
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
            const rr = i % 2 ? 2.5 : 6;
            g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
          }
          g.fill();
        }
      }
    } else if (r.pattern === 'bones') {
      // skeleton-onesie ribcage
      const cx = S * 0.62;
      g.fillRect(cx - 3, S * 0.41, 6, S * 0.18);
      for (let i = 0; i < 5; i++) {
        const y = S * 0.43 + i * 15;
        const w = 46 - Math.abs(i - 1.5) * 6;
        g.fillRect(cx - w, y, w * 2, 5);
      }
    } else {
      for (let y = S * 0.43; y < S * 0.6; y += 22) {
        for (let x = S * 0.42 + ((y / 22) % 2) * 11; x < S * 0.84; x += 22) {
          bat(g, x, y, 6);
        }
      }
    }
    g.restore();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.magFilter = THREE.NearestFilter;
  tex.anisotropy = 4;
  skinCache.set(key, tex);
  return tex;
}

function bat(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.beginPath();
  g.moveTo(x, y - r * 0.2);
  g.quadraticCurveTo(x - r * 0.5, y - r * 0.7, x - r, y - r * 0.4);
  g.lineTo(x - r * 0.75, y + r * 0.1);
  g.lineTo(x - r * 0.4, y - r * 0.05);
  g.lineTo(x, y + r * 0.35);
  g.lineTo(x + r * 0.4, y - r * 0.05);
  g.lineTo(x + r * 0.75, y + r * 0.1);
  g.lineTo(x + r, y - r * 0.4);
  g.quadraticCurveTo(x + r * 0.5, y - r * 0.7, x, y - r * 0.2);
  g.fill();
}

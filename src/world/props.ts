// Placing Kenney kit models into the world with sensible real-world scale,
// footprint-centred pivots and matching colliders.

import * as THREE from 'three';
import { cloneModel } from '../core/assets';
import type { PropDef } from '../levels/types';
import { F, type Collider, type PhysicsWorld } from './physics';

/** Kenney kits are authored at different scales; these map them to metres. */
export function kitScale(path: string): number {
  if (path.startsWith('spooky/')) return 1;
  if (path.startsWith('furniture/')) return 2;
  if (path.startsWith('food/')) return 0.35;
  if (path.startsWith('holiday/')) {
    if (/tree/i.test(path)) return 1.45;
    return 1.6;
  }
  return 1;
}

/** Things NPCs walk around but that do not block sight (low stuff). */
const LOW = /rug|books|computerMouse|computerKeyboard|laptop|pillow|toaster|cookie|plate|mug|radio|speakerSmall|glass|pumpkin|gourds|candles|skull|candyBowl|spellbook|potion|crow|catStatue|witchHat|jackOLantern|spider|mask|leafPile|apple|lollypop|candyBar|cupcake/i;
const NO_COLLIDE = /rug|ceilingFan|lampWall|lampSquareCeiling|bathroomMirror|paneling|doorway|spooky\/web/i;

export interface PlacedProp {
  def: PropDef;
  group: THREE.Group;
  collider: Collider | null;
  /** named sub-nodes (drawers / doors) for animation */
  parts: Map<string, THREE.Object3D>;
}

export function makeProp(def: PropDef): THREE.Group {
  const inner = cloneModel(def.m, !!def.tint);
  const box = new THREE.Box3().setFromObject(inner);
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  inner.position.set(-cx, 0, -cz);
  if (def.tint) {
    inner.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[];
      for (const mat of mats) {
        const c = def.tint![mat.name] ?? def.tint!['*'];
        if (c) mat.color.set(c);
      }
    });
  }
  const g = new THREE.Group();
  g.add(inner);
  const s = kitScale(def.m) * (def.s ?? 1);
  g.scale.setScalar(s);
  g.position.set(def.x, def.y ?? 0, def.z);
  g.rotation.y = THREE.MathUtils.degToRad(def.rot ?? 0);
  g.name = def.id ?? def.m;
  return g;
}

export function placeProp(def: PropDef, scene: THREE.Object3D, world: PhysicsWorld): PlacedProp {
  const g = makeProp(def);
  scene.add(g);
  g.visible = !def.hidden;
  const parts = new Map<string, THREE.Object3D>();
  g.traverse((o) => { if (o.name) parts.set(o.name, o); });
  let collider: Collider | null = null;
  const mode = def.collide ?? (NO_COLLIDE.test(def.m) ? 'none' : LOW.test(def.m) ? 'low' : 'box');
  if (mode !== 'none' && !def.hidden) {
    g.updateWorldMatrix(true, true);
    const b = new THREE.Box3().setFromObject(g, true);
    // shave a few cm so the player can squeeze between furniture
    b.min.x += 0.03; b.min.z += 0.03; b.max.x -= 0.03; b.max.z -= 0.03;
    const flags = mode === 'low' ? F.MOVE | F.NAV : F.ALL;
    const soft = /sofa|bed|chairCushion|lounge|pillow|bench|ottoman/i.test(def.m);
    collider = world.add(b.min, b.max, flags, {
      owner: def,
      climbable: def.climb ?? true,
      surface: soft ? 'soft' : 'wood',
    });
  }
  if (/rug/i.test(def.m)) {
    g.updateWorldMatrix(true, true);
    const b = new THREE.Box3().setFromObject(g, true);
    world.floorSurfaces.push({ minX: b.min.x, minZ: b.min.z, maxX: b.max.x, maxZ: b.max.z, surface: 'carpet' });
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = false; });
  }
  return { def, group: g, collider, parts };
}

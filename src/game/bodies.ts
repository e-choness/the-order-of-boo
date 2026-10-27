// Character bodies with procedural animation.
// Humans use Kenney's Blocky Characters (CC0), re-pivoted at the joints so the
// limbs can be animated and dressed in Halloween costumes; pets and the
// animatronic lawn skeletons are built in the same chunky style.

import * as THREE from 'three';
import { cloneModel, makeSkin } from '../core/assets';
import type { Costume, NPCDef } from '../levels/types';
import { spookyModel } from '../world/spooky';

export type Pose = 'stand' | 'walk' | 'run' | 'sit' | 'sleep' | 'lie' | 'phone' | 'cook' | 'carve' | 'read' | 'tv' | 'snack' | 'sniff' | 'clean' | 'look' | 'stunned' | 'alert' | 'talk' | 'sitUp';

export interface Body {
  root: THREE.Group;
  height: number;
  eyeHeight: number;
  headWorld(): THREE.Vector3;
  update(dt: number, pose: Pose, speed: number, headYaw: number, headPitch: number, time: number, seated?: boolean): void;
  setSitHeight(y: number): void;
  flashlight?: THREE.SpotLight;
  /** materials to flash/outline */
  meshes: THREE.Mesh[];
}

const U = 1 / 16; // blocky units → normalised height

function damp(cur: number, target: number, k: number, dt: number) {
  return cur + (target - cur) * Math.min(1, k * dt);
}

export async function buildBody(def: NPCDef): Promise<Body> {
  if (def.kind === 'dog' || def.kind === 'cat') return buildPet(def);
  if (def.kind === 'animatronic') return buildAnimatronic();
  return buildHuman(def);
}

async function buildHuman(def: NPCDef): Promise<Body> {
  const height = def.kind === 'kid' ? 1.12 : def.kind === 'teen' ? 1.62 : def.kind === 'elder' ? 1.68 : 1.78;
  const src = cloneModel('characters/advancedCharacter.gltf');
  const tex = await makeSkin(def.skin ?? { base: 'man' });
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
  const parts: Record<string, THREE.Mesh> = {};
  src.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) parts[m.name.replace(/\d+$/, '')] = m;
  });
  // some exporters name the mesh after the node; fall back to node names
  if (!parts.Body) src.children.forEach((c) => { if ((c as THREE.Mesh).isMesh) parts[c.name.replace(/\d+$/, '')] = c as THREE.Mesh; });

  const root = new THREE.Group();
  const scaler = new THREE.Group();
  const s = height * U;
  scaler.scale.setScalar(s);
  root.add(scaler);
  const meshes: THREE.Mesh[] = [];
  const pivot = (name: string, jx: number, jy: number, jz: number, parent: THREE.Object3D) => {
    const g = new THREE.Group();
    g.position.set(jx, jy, jz);
    const m = parts[name];
    if (m) {
      const mm = m.clone();
      mm.material = mat;
      mm.position.set(-jx, -jy, -jz);
      mm.castShadow = true;
      mm.receiveShadow = true;
      g.add(mm);
      meshes.push(mm);
    }
    parent.add(g);
    return g;
  };
  const hips = new THREE.Group();
  hips.position.set(0, 6, 0);
  scaler.add(hips);
  const torso = pivot('Body', 0, 0, 0, hips);
  // body mesh is authored in model space; the pivot helper offsets by the joint
  torso.children[0]?.position.set(0, -6, 0);
  const head = new THREE.Group();
  head.position.set(0, 6, 0);
  torso.add(head);
  const headMesh = parts.Head?.clone();
  if (headMesh) {
    headMesh.material = mat;
    headMesh.position.set(0, -12, 0);
    headMesh.castShadow = true;
    head.add(headMesh);
    meshes.push(headMesh);
  }
  if (def.kind === 'kid') head.scale.setScalar(1.22);
  const armL = new THREE.Group(); armL.position.set(3, 6, 0); torso.add(armL);
  const armR = new THREE.Group(); armR.position.set(-3, 6, 0); torso.add(armR);
  for (const [g, n, jx] of [[armL, 'ArmLeft', 3], [armR, 'ArmRight', -3]] as const) {
    const m = parts[n]?.clone();
    if (m) { m.material = mat; m.position.set(-jx, -12, 0); m.castShadow = true; g.add(m); meshes.push(m); }
  }
  const legL = pivot('LegLeft', 1, 6, 0, scaler);
  const legR = pivot('LegRight', -1, 6, 0, scaler);

  // Halloween costume pieces (blocky units, head space is model space)
  const costume = new THREE.Group();
  costume.position.set(0, -12, 0);
  head.add(costume);
  const torsoCostume = new THREE.Group();
  torsoCostume.position.set(0, -6, 0);
  torso.add(torsoCostume);
  dressUp(def.costume ?? 'none', costume, torsoCostume, meshes);
  const phone = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.6, 0.25), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x6fa8ff, emissiveIntensity: 0.6 }));
  phone.position.set(-1, -6.4, 1.3);
  phone.visible = false;
  armR.add(phone);

  let flashlight: THREE.SpotLight | undefined;
  if (def.flashlight) {
    const torch = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.35, 2.2, 10), new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.6, roughness: 0.4 }));
    torch.rotation.x = Math.PI / 2;
    torch.position.set(-1, -6.5, 1.4);
    armR.add(torch);
    flashlight = new THREE.SpotLight(0xffe2b0, 14, 11, 0.42, 0.45, 1.3);
    flashlight.position.set(-1, -6.5, 2.4);
    const tgt = new THREE.Object3D();
    tgt.position.set(-1, -9, 12);
    armR.add(flashlight, tgt);
    flashlight.target = tgt;
    flashlight.castShadow = false;
  }

  let walkPhase = 0;
  let sitK = 0, lieK = 0, armRaise = 0, armFwd = 0, bob = 0, sitY = 0.45;
  const state = { hy: 0, hp: 0 };
  return {
    root,
    height,
    eyeHeight: height * 0.9,
    meshes,
    flashlight,
    setSitHeight(y) { sitY = y; },
    headWorld() {
      const v = new THREE.Vector3();
      head.getWorldPosition(v);
      v.y += height * 0.06;
      return v;
    },
    update(dt, pose, speed, headYaw, headPitch, time, seated) {
      const moving = pose === 'walk' || pose === 'run';
      walkPhase += dt * speed * (def.kind === 'kid' ? 9 : 6.5);
      const swing = moving ? Math.min(1, speed / 1.2) * (pose === 'run' ? 0.95 : 0.6) : 0;
      sitK = damp(sitK, (seated && !moving && pose !== 'sleep' && pose !== 'lie') || pose === 'sit' || pose === 'tv' || pose === 'read' || pose === 'sitUp' ? 1 : 0, 6, dt);
      lieK = damp(lieK, pose === 'sleep' || pose === 'lie' ? 1 : 0, 4, dt);
      armRaise = damp(armRaise, pose === 'phone' ? 1 : pose === 'alert' ? 0.6 : 0, 6, dt);
      armFwd = damp(armFwd, pose === 'cook' || pose === 'carve' || pose === 'read' || pose === 'snack' || pose === 'clean' ? 1 : 0, 6, dt);
      phone.visible = pose === 'phone';
      const sw = Math.sin(walkPhase) * swing;
      legL.rotation.x = sw * (1 - sitK) - sitK * Math.PI / 2;
      legR.rotation.x = -sw * (1 - sitK) - sitK * Math.PI / 2;
      armL.rotation.x = -sw * 0.9 * (1 - armFwd) - armFwd * 1.1 + (pose === 'cook' || pose === 'carve' ? Math.sin(time * 6) * 0.15 : 0);
      armR.rotation.x = sw * 0.9 * (1 - armFwd) * (1 - armRaise) - armFwd * 1.1 - armRaise * 2.4 + (pose === 'clean' ? Math.sin(time * 5) * 0.4 : 0);
      armR.rotation.z = armRaise * 0.5;
      armL.rotation.z = pose === 'alert' ? -0.5 : 0;
      armR.rotation.y = pose === 'phone' ? 0.3 : 0;
      // breathing / bobbing
      bob = moving ? Math.abs(Math.sin(walkPhase)) * 0.25 * swing : Math.sin(time * 1.6) * 0.06;
      hips.position.y = 6 + bob - sitK * (6 - sitY / s);
      hips.position.z = sitK * -0.5;
      torso.rotation.x = pose === 'sniff' || pose === 'clean' ? 0.35 : pose === 'run' ? 0.15 : pose === 'stunned' ? Math.sin(time * 1.5) * 0.12 + 0.15 : 0;
      torso.rotation.z = pose === 'stunned' ? Math.sin(time * 1.1) * 0.1 : 0;
      // lie down for sleeping
      scaler.rotation.x = -lieK * Math.PI / 2;
      scaler.position.y = lieK * 0.12;
      scaler.position.z = lieK * height * 0.5;
      // head look
      state.hy = damp(state.hy, headYaw, 8, dt);
      state.hp = damp(state.hp, headPitch, 8, dt);
      head.rotation.y = state.hy;
      head.rotation.x = -state.hp + (pose === 'stunned' ? 0.35 : 0) + (pose === 'phone' ? 0.1 : 0);
    },
  };
}

function buildPet(def: NPCDef): Body {
  const isCat = def.kind === 'cat';
  const root = new THREE.Group();
  const furCol = new THREE.Color(def.skin?.shirt ?? (isCat ? '#f2efe9' : '#c48a4a'));
  const fur = new THREE.MeshStandardMaterial({ color: furCol, roughness: 0.95 });
  const fur2 = new THREE.MeshStandardMaterial({ color: new THREE.Color(def.skin?.pants ?? (isCat ? '#9aa0a8' : '#7a5230')), roughness: 0.95 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.4 });
  const pink = new THREE.MeshStandardMaterial({ color: 0xff9aa8, roughness: 0.7 });
  const L = isCat ? 0.42 : 0.62, Wd = isCat ? 0.2 : 0.28, Hh = isCat ? 0.2 : 0.27;
  const legH = isCat ? 0.16 : 0.26;
  const meshes: THREE.Mesh[] = [];
  const mk = (g: THREE.BufferGeometry, m: THREE.Material) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = true;
    meshes.push(mesh);
    return mesh;
  };
  const body = new THREE.Group();
  body.position.y = legH + Hh / 2;
  root.add(body);
  const torso = mk(new THREE.BoxGeometry(Wd, Hh, L), fur);
  body.add(torso);
  const patch = mk(new THREE.BoxGeometry(Wd + 0.01, Hh * 0.5, L * 0.4), fur2);
  patch.position.set(0, Hh * 0.28, -L * 0.1);
  body.add(patch);
  const head = new THREE.Group();
  head.position.set(0, Hh * 0.45, L / 2 + 0.02);
  body.add(head);
  const hs = isCat ? 0.17 : 0.22;
  const skull = mk(new THREE.BoxGeometry(hs, hs * 0.9, hs), fur);
  skull.position.set(0, hs * 0.35, hs * 0.3);
  head.add(skull);
  const snout = mk(new THREE.BoxGeometry(hs * 0.55, hs * 0.4, hs * (isCat ? 0.25 : 0.55)), isCat ? fur : fur2);
  snout.position.set(0, hs * 0.18, hs * (isCat ? 0.85 : 0.98));
  head.add(snout);
  const nose = mk(new THREE.BoxGeometry(hs * 0.2, hs * 0.14, hs * 0.08), isCat ? pink : dark);
  nose.position.set(0, hs * 0.32, hs * (isCat ? 0.99 : 1.27));
  head.add(nose);
  for (const sx of [-1, 1]) {
    const eye = mk(new THREE.BoxGeometry(hs * 0.14, hs * 0.16, 0.01), dark);
    eye.position.set(sx * hs * 0.24, hs * 0.5, hs * 0.81);
    head.add(eye);
    const shine = new THREE.Mesh(new THREE.BoxGeometry(hs * 0.05, hs * 0.05, 0.005), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    shine.position.set(sx * hs * 0.22, hs * 0.54, hs * 0.818);
    head.add(shine);
    if (isCat) {
      const ear = mk(new THREE.ConeGeometry(hs * 0.22, hs * 0.38, 4), fur);
      ear.position.set(sx * hs * 0.3, hs * 0.95, hs * 0.25);
      ear.rotation.y = Math.PI / 4;
      head.add(ear);
    } else {
      const ear = mk(new THREE.BoxGeometry(hs * 0.18, hs * 0.5, hs * 0.3), fur2);
      ear.position.set(sx * hs * 0.55, hs * 0.5, hs * 0.2);
      ear.rotation.z = sx * 0.3;
      head.add(ear);
    }
  }
  if (!isCat) {
    const collar = mk(new THREE.BoxGeometry(Wd * 0.9, 0.05, 0.06), new THREE.MeshStandardMaterial({ color: 0xc0182c }));
    collar.position.set(0, Hh * 0.3, L / 2 - 0.02);
    body.add(collar);
    const tag = mk(new THREE.CylinderGeometry(0.025, 0.025, 0.01, 10), new THREE.MeshStandardMaterial({ color: 0xffd36e, metalness: 0.8, roughness: 0.3 }));
    tag.rotation.x = Math.PI / 2;
    tag.position.set(0, Hh * 0.18, L / 2 + 0.02);
    body.add(tag);
  } else {
    const bell = mk(new THREE.SphereGeometry(0.022, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffd36e, metalness: 0.9, roughness: 0.25 }));
    bell.position.set(0, Hh * 0.05, L / 2 + 0.03);
    body.add(bell);
  }
  const tail = new THREE.Group();
  tail.position.set(0, Hh * 0.35, -L / 2);
  body.add(tail);
  const tailM = mk(new THREE.BoxGeometry(0.05, 0.05, isCat ? 0.34 : 0.2), isCat ? fur2 : fur);
  tailM.position.z = isCat ? -0.16 : -0.09;
  tail.add(tailM);
  tail.rotation.x = isCat ? -0.9 : -0.6;
  const legs: THREE.Group[] = [];
  for (const [lx, lz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const g = new THREE.Group();
    g.position.set(lx * (Wd / 2 - 0.04), legH, lz * (L / 2 - 0.06));
    const leg = mk(new THREE.BoxGeometry(0.07, legH, 0.07), fur);
    leg.position.y = -legH / 2;
    g.add(leg);
    root.add(g);
    legs.push(g);
  }
  let phase = 0, lie = 0;
  const st = { hy: 0, hp: 0 };
  return {
    root,
    height: legH + Hh + hs,
    eyeHeight: legH + Hh + hs * 0.5,
    meshes,
    setSitHeight() { /* pets lie on the floor */ },
    headWorld() {
      const v = new THREE.Vector3();
      head.getWorldPosition(v);
      v.y += hs * 0.5;
      return v;
    },
    update(dt, pose, speed, headYaw, headPitch, time) {
      const moving = pose === 'walk' || pose === 'run';
      phase += dt * speed * 11;
      const sw = moving ? Math.sin(phase) * Math.min(0.9, speed * 0.5) : 0;
      legs[0].rotation.x = sw; legs[3].rotation.x = sw;
      legs[1].rotation.x = -sw; legs[2].rotation.x = -sw;
      lie = damp(lie, pose === 'sleep' || pose === 'lie' || pose === 'sit' || pose === 'stunned' ? 1 : 0, 4, dt);
      body.position.y = legH + Hh / 2 - lie * legH * 0.9 + (moving ? Math.abs(Math.sin(phase)) * 0.02 : Math.sin(time * 2) * 0.004);
      for (const l of legs) l.scale.y = 1 - lie * 0.85;
      tail.rotation.y = Math.sin(time * (pose === 'alert' ? 14 : isCat ? 2 : 8)) * (isCat ? 0.3 : 0.6) * (pose === 'sleep' ? 0.1 : 1);
      tail.rotation.x = isCat ? -0.9 - (pose === 'alert' ? 0.6 : 0) : -0.6;
      st.hy = damp(st.hy, headYaw, 7, dt);
      st.hp = damp(st.hp, pose === 'sniff' ? -0.6 : pose === 'sleep' ? -0.3 : headPitch, 7, dt);
      head.rotation.y = st.hy;
      head.rotation.x = -st.hp;
      body.rotation.z = pose === 'sleep' ? lie * 0.4 : 0;
    },
  };
}

function dressUp(c: Costume, head: THREE.Group, torso: THREE.Group, meshes: THREE.Mesh[]) {
  const M = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true, ...extra });
  const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    meshes.push(mesh);
    return mesh;
  };
  switch (c) {
    case 'witch': {
      const felt = M(0x1f1630);
      add(head, new THREE.CylinderGeometry(3.4, 3.4, 0.3, 16), felt, 0, 16.3, 0);
      add(head, new THREE.ConeGeometry(2.1, 5.2, 10), felt, 0, 19, -0.3).rotation.x = -0.18;
      add(head, new THREE.CylinderGeometry(2.15, 2.2, 0.7, 10), M(0x8b4bd6), 0, 16.8, 0);
      add(head, new THREE.BoxGeometry(0.8, 0.7, 0.2), M(0xe8c062, { metalness: 0.8, roughness: 0.3 }), 0, 16.8, 2.15);
      break;
    }
    case 'wizard': {
      const blue = M(0x2b3f9a);
      add(head, new THREE.CylinderGeometry(3, 3, 0.3, 14), blue, 0, 16.3, 0);
      add(head, new THREE.ConeGeometry(2, 6.5, 10), blue, 0, 19.6, 0).rotation.z = 0.12;
      for (let i = 0; i < 6; i++) add(head, new THREE.OctahedronGeometry(0.35, 0), M(0xffd36e, { emissive: 0x6a5000 }), Math.cos(i * 2) * 1.4, 17.5 + i * 0.6, Math.sin(i * 2) * 1.4 + 0.3);
      add(head, new THREE.ConeGeometry(1.8, 3.2, 6), M(0xe8e4dc), 0, 10.6, 2.1).rotation.x = Math.PI; // beard
      break;
    }
    case 'vampire': {
      const black = M(0x111016);
      const red = M(0x8a0f1f);
      const cape = add(torso, new THREE.BoxGeometry(5.2, 7.6, 0.25), black, 0, 8.4, -1.35);
      cape.rotation.x = 0.08;
      add(torso, new THREE.BoxGeometry(4.8, 7.2, 0.1), red, 0, 8.4, -1.18).rotation.x = 0.08;
      for (const sx of [-1, 1]) add(torso, new THREE.BoxGeometry(1.6, 2.6, 0.25), red, sx * 2.1, 12.6, -0.6).rotation.set(-0.3, sx * 0.5, sx * 0.25);
      add(head, new THREE.BoxGeometry(4.15, 1.1, 4.15), black, 0, 15.8, -0.1); // slicked hair
      add(head, new THREE.ConeGeometry(0.7, 1.4, 3), black, 0, 15.2, 2.0).rotation.x = Math.PI; // widow's peak
      break;
    }
    case 'mummy': {
      const wrap = M(0xe9e0c8, { roughness: 1 });
      for (let i = 0; i < 5; i++) {
        const b = add(head, new THREE.BoxGeometry(4.25, 0.6, 4.25), wrap, 0, 12.6 + i * 0.75, 0);
        b.rotation.set((i % 2 ? 0.08 : -0.08), i * 0.3, (i % 2 ? -0.1 : 0.1));
      }
      for (let i = 0; i < 6; i++) {
        const b = add(torso, new THREE.BoxGeometry(4.3, 0.7, 2.3), wrap, 0, 6.5 + i * 0.95, 0);
        b.rotation.set(0, 0, (i % 2 ? -0.12 : 0.12));
      }
      add(torso, new THREE.BoxGeometry(0.5, 0.4, 2), wrap, 1.8, 5.6, 0.6).rotation.z = 0.4; // loose end
      break;
    }
    case 'pumpkin': {
      const p = spookyModel('jackOLantern');
      p.scale.setScalar(15);
      p.position.set(0, 11.6, 0);
      p.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; meshes.push(m); } });
      head.add(p);
      break;
    }
    case 'catEars': {
      const black = M(0x18141f);
      for (const sx of [-1, 1]) {
        add(head, new THREE.ConeGeometry(0.8, 1.6, 4), black, sx * 1.3, 16.8, 0.2).rotation.set(0, Math.PI / 4, sx * -0.2);
        add(head, new THREE.ConeGeometry(0.45, 0.9, 4), M(0xff9aa8), sx * 1.3, 16.75, 0.45).rotation.set(0, Math.PI / 4, sx * -0.2);
      }
      add(head, new THREE.BoxGeometry(4.2, 0.35, 4.2), black, 0, 16.1, 0);
      for (const sx of [-1, 1]) for (const dy of [-0.3, 0.3]) add(head, new THREE.BoxGeometry(1.4, 0.08, 0.05), M(0x111111), sx * 1.3, 13.4 + dy, 2.08).rotation.z = sx * dy * 0.6;
      break;
    }
    case 'devil': {
      const red = M(0xd0202c, { roughness: 0.5 });
      for (const sx of [-1, 1]) add(head, new THREE.ConeGeometry(0.5, 1.6, 6), red, sx * 1.3, 16.8, 0.4).rotation.z = sx * -0.35;
      const tail = add(torso, new THREE.CylinderGeometry(0.15, 0.15, 4.5, 5), red, 0, 4.6, -1.8);
      tail.rotation.x = 0.9;
      add(torso, new THREE.ConeGeometry(0.6, 1, 3), red, 0, 2.9, -3.6).rotation.x = 2.2;
      break;
    }
    case 'pirate': {
      const black = M(0x161214);
      add(head, new THREE.BoxGeometry(5.4, 1.4, 3.2), black, 0, 16.6, 0);
      add(head, new THREE.BoxGeometry(4.2, 1.2, 4.2), black, 0, 16.4, 0);
      add(head, new THREE.BoxGeometry(1.1, 0.5, 0.1), M(0xf2f2f2), 0, 16.7, 1.65); // skull badge
      add(head, new THREE.BoxGeometry(1.1, 1, 0.2), black, 0.9, 14.2, 2.08); // eyepatch
      add(head, new THREE.BoxGeometry(4.3, 0.2, 4.3), black, 0, 14.9, 0).rotation.z = 0.35;
      break;
    }
    case 'skeleton': {
      const bone = M(0xeee6d2);
      const face = add(head, new THREE.BoxGeometry(3.6, 3.4, 0.2), bone, 0, 14, 2.1);
      void face;
      for (const sx of [-1, 1]) add(head, new THREE.BoxGeometry(1, 1, 0.1), M(0x111111), sx * 0.85, 14.4, 2.22);
      add(head, new THREE.BoxGeometry(1.8, 0.2, 0.1), M(0x111111), 0, 13, 2.22);
      for (let i = 0; i < 4; i++) add(torso, new THREE.BoxGeometry(3.2 - i * 0.3, 0.4, 0.1), bone, 0, 10.8 - i * 1.1, 1.02);
      add(torso, new THREE.BoxGeometry(0.5, 4.6, 0.1), bone, 0, 8.8, 1.03);
      break;
    }
    case 'sheetGhost': {
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        const y = 1 + t * 16.5;
        const r = t > 0.8 ? Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.8) / 0.2, 2))) * 2.7 : 2.7 + (0.8 - t) * 1.6;
        pts.push(new THREE.Vector2(Math.max(0.01, r), y));
      }
      const sheet = add(torso, new THREE.LatheGeometry(pts, 12), M(0xf4f2ee, { side: THREE.DoubleSide }), 0, -6, 0);
      void sheet;
      for (const sx of [-1, 1]) add(head, new THREE.BoxGeometry(0.8, 1, 0.2), M(0x111111), sx * 0.9, 14.3, 2.55);
      break;
    }
    case 'none':
      break;
  }
}

function buildAnimatronic(): Body {
  // a cheap motion-sensor lawn skeleton on a black plastic stand, glowing red eyes
  const root = new THREE.Group();
  const meshes: THREE.Mesh[] = [];
  const bone = new THREE.MeshStandardMaterial({ color: 0xeee6d2, roughness: 0.55, flatShading: true });
  const plastic = new THREE.MeshStandardMaterial({ color: 0x15131a, roughness: 0.4 });
  const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    meshes.push(mesh);
    return mesh;
  };
  add(root, new THREE.CylinderGeometry(0.22, 0.26, 0.06, 12), plastic, 0, 0.03, 0);
  add(root, new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6), plastic, 0, 0.3, -0.05);
  for (const sx of [-1, 1]) {
    add(root, new THREE.BoxGeometry(0.045, 0.42, 0.045), bone, sx * 0.08, 0.3, 0);
    add(root, new THREE.BoxGeometry(0.04, 0.4, 0.04), bone, sx * 0.08, 0.72, 0);
    add(root, new THREE.BoxGeometry(0.09, 0.03, 0.14), bone, sx * 0.08, 0.075, 0.03);
  }
  add(root, new THREE.BoxGeometry(0.24, 0.08, 0.1), bone, 0, 0.94, 0); // pelvis
  const chest = new THREE.Group();
  chest.position.set(0, 1.0, 0);
  root.add(chest);
  add(chest, new THREE.BoxGeometry(0.035, 0.42, 0.035), bone, 0, 0.21, -0.04); // spine
  for (let i = 0; i < 5; i++) add(chest, new THREE.BoxGeometry(0.3 - Math.abs(i - 1.5) * 0.04, 0.025, 0.16), bone, 0, 0.14 + i * 0.055, 0.01);
  const arms: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(sx * 0.19, 0.4, 0);
    chest.add(arm);
    add(arm, new THREE.BoxGeometry(0.035, 0.3, 0.035), bone, 0, -0.15, 0);
    const fore = add(arm, new THREE.BoxGeometry(0.03, 0.28, 0.03), bone, 0, -0.3, 0.12);
    fore.rotation.x = -1.1;
    for (let f = 0; f < 3; f++) add(arm, new THREE.BoxGeometry(0.008, 0.07, 0.008), bone, (f - 1) * 0.015, -0.24, 0.28).rotation.x = -1.6;
    arm.rotation.z = sx * 0.25;
    arms.push(arm);
  }
  const head = new THREE.Group();
  head.position.set(0, 0.48, 0);
  chest.add(head);
  add(head, new THREE.IcosahedronGeometry(0.1, 1), bone, 0, 0.1, 0).scale.set(1, 1.05, 1.1);
  const jaw = add(head, new THREE.BoxGeometry(0.11, 0.04, 0.09), bone, 0, 0.0, 0.04);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff2030, emissiveIntensity: 2.5 });
  const eyes: THREE.Mesh[] = [];
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), eyeMat);
    e.position.set(sx * 0.038, 0.11, 0.095);
    head.add(e);
    eyes.push(e);
  }
  let jawT = 0;
  return {
    root,
    height: 1.62,
    eyeHeight: 1.6,
    meshes,
    setSitHeight() { /* n/a */ },
    headWorld() { const v = new THREE.Vector3(); eyes[0].getWorldPosition(v); return v; },
    update(dt, pose, _speed, headYaw, _hp, time) {
      const alarmed = pose === 'alert';
      eyeMat.emissive.set(pose === 'stunned' ? 0x7a60ff : alarmed ? 0xff2030 : 0x9a1018);
      eyeMat.emissiveIntensity = alarmed ? 3 + Math.sin(time * 24) * 2 : 1.2 + Math.sin(time * 1.3) * 0.4;
      jawT += dt * (alarmed ? 22 : 0);
      jaw.position.y = alarmed ? -0.02 - Math.abs(Math.sin(jawT)) * 0.03 : 0;
      head.rotation.y += ((alarmed ? Math.sin(time * 9) * 0.5 : headYaw * 0.6) - head.rotation.y) * Math.min(1, dt * 5);
      for (const [i, a] of arms.entries()) a.rotation.x = alarmed ? -1.4 + Math.sin(time * 18 + i) * 0.25 : -0.2 + Math.sin(time * 0.8 + i) * 0.03;
      chest.rotation.z = alarmed ? Math.sin(time * 14) * 0.06 : 0;
    },
  };
}

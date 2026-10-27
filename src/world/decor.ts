// Hand-built Halloween set dressing: fireplace mantel, bunting, picture frames,
// portraits whose eyes follow you, posters, clocks, calendars, bat garlands,
// paper bats and cobwebs.

import * as THREE from 'three';
import type { LevelDef } from '../levels/types';
import { makeProp } from './props';
import { F, type PhysicsWorld } from './physics';
import { paintingTexture, portraitTexture, wallTexture, batShape } from './textures';
import { cobwebTexture } from './spooky';

export interface DecorResult {
  group: THREE.Group;
  clocks: THREE.Object3D[];
  /** portrait eyes that turn to follow the camera */
  eyes: THREE.Object3D[];
}

export function buildFireplace(x: number, z: number, rot: number, world: PhysicsWorld): THREE.Group {
  const g = new THREE.Group();
  const brick = new THREE.MeshStandardMaterial({ map: wallTexture('brick', '#9a4a3a'), roughness: 0.95 });
  brick.map = brick.map!.clone();
  brick.map.needsUpdate = true;
  brick.map.repeat.set(1.5, 1.5);
  const stone = new THREE.MeshStandardMaterial({ color: 0x8f8a85, roughness: 0.9 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x5b3a26, roughness: 0.6 });
  const soot = new THREE.MeshStandardMaterial({ color: 0x120c0a, roughness: 1 });
  const W = 1.9, D = 0.55, H = 1.2;
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, px: number, py: number, pz: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(px, py, pz);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  // sides + top of the firebox surround
  add(new THREE.BoxGeometry(0.45, H, D), brick, -W / 2 + 0.225, H / 2, 0);
  add(new THREE.BoxGeometry(0.45, H, D), brick, W / 2 - 0.225, H / 2, 0);
  add(new THREE.BoxGeometry(W - 0.9, 0.35, D), brick, 0, H - 0.175, 0);
  add(new THREE.BoxGeometry(W - 0.9, H - 0.35, 0.1), soot, 0, (H - 0.35) / 2, -D / 2 + 0.05);
  // mantel
  add(new THREE.BoxGeometry(W + 0.25, 0.09, D + 0.18), wood, 0, H + 0.045, 0.05);
  // chimney breast to the ceiling
  add(new THREE.BoxGeometry(W - 0.3, 2.6 - H - 0.09, D - 0.12), brick, 0, H + 0.09 + (2.6 - H - 0.09) / 2, -0.06);
  // hearth
  add(new THREE.BoxGeometry(W + 0.3, 0.06, 0.55), stone, 0, 0.03, D / 2 + 0.25);
  // logs
  const logGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.7, 8);
  for (const [lx, ly, lr] of [[0, 0.1, 0.1], [0, 0.2, -0.2], [0.05, 0.1, 0.5]]) {
    const l = add(logGeo, wood, lx, ly, -0.02);
    l.rotation.z = Math.PI / 2 + lr;
  }
  // embers glow
  const ember = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.25), new THREE.MeshStandardMaterial({ color: 0, emissive: 0xff5a1a, emissiveIntensity: 5 }));
  ember.rotation.x = -Math.PI / 2;
  ember.position.set(0, 0.04, 0);
  g.add(ember);
  // mantel dressing: mini pumpkins, gourds, a skull and dripping candles
  for (const [m, mx, sc] of [['spooky/pumpkinSmall', -0.45, 1], ['spooky/gourds', 0.35, 0.9], ['spooky/skull', 0.05, 1.1], ['spooky/pumpkinWhite', 0.62, 0.55]] as const) {
    const p = makeProp({ m, x: mx, z: 0.12, y: H + 0.09, s: sc, rot: mx * 90 });
    g.add(p);
  }
  // a fringe of tattered black cloth hanging off the mantel edge
  const cloth = new THREE.MeshStandardMaterial({ color: 0x15121c, roughness: 1, side: THREE.DoubleSide });
  for (let i = 0; i < 14; i++) {
    const t = i / 13;
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.12 + ((i * 7) % 5) * 0.025), cloth);
    strip.position.set(-W / 2 - 0.05 + t * (W + 0.1), H - 0.02 - ((i * 7) % 5) * 0.012, D / 2 + 0.145);
    g.add(strip);
  }
  for (const cx of [-0.75, 0.75]) {
    const c = add(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 10), new THREE.MeshStandardMaterial({ color: 0xf3ead8 }), cx, H + 0.2, 0);
    c.castShadow = false;
    const drip = add(new THREE.CylinderGeometry(0.034, 0.03, 0.05, 10), new THREE.MeshStandardMaterial({ color: 0x5a0d14, roughness: 0.4 }), cx, H + 0.29, 0);
    drip.castShadow = false;
  }
  g.position.set(x, 0, z);
  g.rotation.y = THREE.MathUtils.degToRad(rot);
  g.updateWorldMatrix(true, true);
  // colliders: two pillars + mantel top (climbable!) + chimney breast
  const pillars = [-W / 2 + 0.225, W / 2 - 0.225];
  for (const px of pillars) {
    const p = new THREE.Vector3(px, 0, 0).applyMatrix4(g.matrixWorld);
    const ext = rot % 180 === 0 ? [0.45, D] : [D, 0.45];
    world.addBox(p.x, 0, p.z, ext[0], H + 0.09, ext[1], F.ALL, { surface: 'tile' });
  }
  const back = new THREE.Vector3(0, 0, -D / 2 + 0.1).applyMatrix4(g.matrixWorld);
  world.addBox(back.x, 0, back.z, rot % 180 === 0 ? W : 0.2, H + 0.09, rot % 180 === 0 ? 0.2 : W, F.ALL);
  const top = new THREE.Vector3(0, 0, 0).applyMatrix4(g.matrixWorld);
  world.addBox(top.x, H - 0.35, top.z, rot % 180 === 0 ? W - 0.9 : D, 0.44, rot % 180 === 0 ? D : W - 0.9, F.ALL, { surface: 'wood' });
  const breast = new THREE.Vector3(0, 0, -0.06).applyMatrix4(g.matrixWorld);
  world.addBox(breast.x, H + 0.09, breast.z, rot % 180 === 0 ? W - 0.3 : D - 0.12, 2.6 - H, rot % 180 === 0 ? D - 0.12 : W - 0.3, F.ALL);
  return g;
}

let batTex: THREE.CanvasTexture | null = null;
function paperBatTexture() {
  if (batTex) return batTex;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 80;
  const x = c.getContext('2d')!;
  x.fillStyle = '#121016';
  batShape(x, 64, 44, 60);
  batTex = new THREE.CanvasTexture(c);
  batTex.colorSpace = THREE.SRGBColorSpace;
  return batTex;
}

export function buildDecor(level: LevelDef, world: PhysicsWorld): DecorResult {
  const g = new THREE.Group();
  const clocks: THREE.Object3D[] = [];
  const eyes: THREE.Object3D[] = [];
  let seed = level.index * 31;
  for (const d of level.decor ?? []) {
    const o = new THREE.Group();
    o.position.set(d.x, d.y, d.z);
    o.rotation.y = THREE.MathUtils.degToRad(d.rot);
    switch (d.kind) {
      case 'bunting': {
        // pennant string spelling the label, one letter per flag
        const text = (d.label ?? 'BOO!').toUpperCase();
        const n = Math.max(3, text.length);
        const width = Math.min(2.6, n * 0.24);
        const cols = ['#e8731c', '#1d1626', '#8b4bd6', '#7cc85a'];
        const cord = new THREE.Mesh(new THREE.BoxGeometry(width + 0.1, 0.008, 0.008), new THREE.MeshStandardMaterial({ color: 0x222222 }));
        o.add(cord);
        for (let i = 0; i < n; i++) {
          const ch = text[i] ?? ' ';
          const c = document.createElement('canvas');
          c.width = 64; c.height = 80;
          const x = c.getContext('2d')!;
          x.fillStyle = cols[i % cols.length];
          x.beginPath(); x.moveTo(0, 0); x.lineTo(64, 0); x.lineTo(32, 80); x.closePath(); x.fill();
          x.fillStyle = i % cols.length === 1 ? '#e8731c' : '#fff6e0';
          x.font = '700 34px Creepster, Fraunces Variable, serif';
          x.textAlign = 'center';
          x.fillText(ch, 32, 38);
          const t = new THREE.CanvasTexture(c);
          t.colorSpace = THREE.SRGBColorSpace;
          const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.25), new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide }));
          const u = n === 1 ? 0.5 : i / (n - 1);
          flag.position.set((u - 0.5) * width, -0.13 - Math.sin(u * Math.PI) * 0.06, 0.01);
          flag.rotation.z = (u - 0.5) * 0.15;
          o.add(flag);
        }
        break;
      }
      case 'wreath': {
        // twisted black twigs, orange ribbon, a couple of tiny pumpkins
        const twig = new THREE.MeshStandardMaterial({ color: 0x1e1814, roughness: 1, flatShading: true });
        for (let i = 0; i < 22; i++) {
          const a = (i / 22) * Math.PI * 2;
          const b = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.16, 4), twig);
          b.position.set(Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0.02 + (i % 3) * 0.01);
          b.rotation.z = a + 0.5 + (i % 4) * 0.2;
          o.add(b);
        }
        const bow = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.018, 6, 12), new THREE.MeshStandardMaterial({ color: 0xe8731c, roughness: 0.6 }));
        bow.scale.set(1.6, 0.8, 1);
        bow.position.set(0, -0.2, 0.05);
        o.add(bow);
        for (const [px, py] of [[0.16, 0.1], [-0.17, 0.06]]) {
          const p = makeProp({ m: 'spooky/pumpkinSmall', x: px, z: 0.04, y: py - 0.06, s: 0.5 });
          o.add(p);
        }
        break;
      }
      case 'portrait': {
        const frame = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.7, 0.05), new THREE.MeshStandardMaterial({ color: 0x6a4a1a, roughness: 0.35, metalness: 0.6 }));
        const pic = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.56), new THREE.MeshStandardMaterial({ map: portraitTexture(seed++), roughness: 0.6 }));
        pic.position.z = 0.027;
        o.add(frame, pic);
        // eyes that follow you: white balls with pupils, turned toward the camera every frame
        for (const sx of [-1, 1]) {
          const eye = new THREE.Group();
          eye.position.set(sx * 0.035, 0.07, 0.02);
          const white = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), new THREE.MeshStandardMaterial({ color: 0xe8e0c8, roughness: 0.3 }));
          const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.0075, 8, 6), new THREE.MeshStandardMaterial({ color: 0x0a0806, emissive: 0x200800 }));
          pupil.position.z = 0.009;
          eye.add(white, pupil);
          o.add(eye);
          eyes.push(eye);
        }
        break;
      }
      case 'frame': {
        const frame = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.04), new THREE.MeshStandardMaterial({ color: 0xc19a5b, roughness: 0.4, metalness: 0.5 }));
        const pic = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.52), new THREE.MeshStandardMaterial({ map: paintingTexture(seed++), roughness: 0.7 }));
        pic.position.z = 0.021;
        o.add(frame, pic);
        break;
      }
      case 'poster': {
        const c = document.createElement('canvas');
        c.width = 256; c.height = 360;
        const x = c.getContext('2d')!;
        const grd = x.createLinearGradient(0, 0, 0, 360);
        grd.addColorStop(0, '#1d1430'); grd.addColorStop(0.65, '#6a2a5a'); grd.addColorStop(1, '#e8731c');
        x.fillStyle = grd; x.fillRect(0, 0, 256, 360);
        // B-movie poster: full moon behind a bolt-necked monster silhouette
        x.fillStyle = '#f4e3b0';
        x.beginPath(); x.arc(128, 170, 78, 0, Math.PI * 2); x.fill();
        x.fillStyle = '#0d0a12';
        x.fillRect(84, 140, 88, 100);
        x.fillRect(78, 128, 100, 22);
        x.fillRect(60, 196, 14, 12); x.fillRect(182, 196, 14, 12);
        x.fillRect(40, 240, 176, 120);
        x.fillStyle = '#9dff7a';
        x.fillRect(102, 176, 16, 8); x.fillRect(138, 176, 16, 8);
        x.fillStyle = '#ffdf9a';
        x.font = '400 44px Creepster, Fraunces Variable, serif';
        x.textAlign = 'center';
        x.fillText(d.label ?? 'IT LIVES!', 128, 70);
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        const p = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.84), new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 }));
        o.add(p);
        break;
      }
      case 'clock': {
        const face = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 32), new THREE.MeshStandardMaterial({ color: 0xf8f1e2 }));
        face.rotation.x = Math.PI / 2;
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.02, 8, 32), new THREE.MeshStandardMaterial({ color: 0x5b3a26, roughness: 0.5 }));
        const hand = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.15, 0.01), new THREE.MeshStandardMaterial({ color: 0x222222 }));
        hand.geometry.translate(0, 0.07, 0);
        hand.position.z = 0.03;
        const hand2 = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.1, 0.01), new THREE.MeshStandardMaterial({ color: 0x222222 }));
        hand2.geometry.translate(0, 0.045, 0);
        hand2.position.z = 0.035;
        o.add(face, rim, hand, hand2);
        o.userData.hands = [hand, hand2];
        clocks.push(o);
        break;
      }
      case 'calendar': {
        const c = document.createElement('canvas');
        c.width = 200; c.height = 260;
        const x = c.getContext('2d')!;
        x.fillStyle = '#fbf6ec'; x.fillRect(0, 0, 200, 260);
        x.fillStyle = '#2a1d3a'; x.fillRect(0, 0, 200, 54);
        x.fillStyle = '#fff'; x.font = '700 30px Fraunces Variable, serif'; x.textAlign = 'center';
        x.fillText('OCTOBER', 100, 38);
        x.font = '600 16px Nunito Variable, sans-serif';
        for (let i = 0; i < 31; i++) {
          const cx = 20 + (i % 7) * 27, cy = 80 + Math.floor(i / 7) * 34;
          x.fillStyle = i === 30 ? '#e8731c' : '#444';
          x.fillText(String(i + 1), cx + 6, cy + 6);
          if (i === 30) { x.strokeStyle = '#e8731c'; x.lineWidth = 3; x.beginPath(); x.arc(cx + 6, cy, 13, 0, Math.PI * 2); x.stroke(); }
          if (i < 30) { x.strokeStyle = '#8b4bd6'; x.lineWidth = 2; x.beginPath(); x.moveTo(cx - 4, cy - 6); x.lineTo(cx + 16, cy + 12); x.stroke(); }
        }
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        o.add(new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.39), new THREE.MeshStandardMaterial({ map: t })));
        break;
      }
      case 'garland': {
        // a string of paper bats with little orange bulbs between them
        const black = new THREE.MeshStandardMaterial({ color: 0x15121c, roughness: 0.9, side: THREE.DoubleSide });
        const batTex = paperBatTexture();
        for (let i = 0; i < 26; i++) {
          const t = i / 25;
          const y = -(Math.sin(t * Math.PI * 3) ** 2) * 0.12;
          if (i % 2 === 0) {
            const b = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.1), new THREE.MeshStandardMaterial({ map: batTex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide }));
            b.position.set((t - 0.5) * 2.2, y - 0.03, 0.05);
            b.rotation.z = Math.sin(i) * 0.25;
            o.add(b);
          } else {
            const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 4), new THREE.MeshStandardMaterial({ color: 0, emissive: i % 4 === 1 ? '#ff8a1a' : '#a35cff', emissiveIntensity: 3 }));
            bulb.position.set((t - 0.5) * 2.2, y - 0.05, 0.06);
            o.add(bulb);
          }
          const cord = new THREE.Mesh(new THREE.BoxGeometry(2.2 / 25 + 0.01, 0.006, 0.006), black);
          cord.position.set((t - 0.5) * 2.2, y, 0.05);
          o.add(cord);
        }
        break;
      }
      case 'bat': {
        // a little colony of paper bats taped to the wall / window
        const tex = paperBatTexture();
        for (let i = 0; i < 5; i++) {
          const s = 0.18 + ((i * 37) % 5) * 0.03;
          const b = new THREE.Mesh(new THREE.PlaneGeometry(s, s * 0.6), new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide }));
          b.position.set(((i * 0.618) % 1 - 0.5) * 0.7, ((i * 0.414) % 1 - 0.5) * 0.4, 0.005 + i * 0.001);
          b.rotation.z = ((i * 0.33) % 1 - 0.5) * 0.6;
          o.add(b);
        }
        break;
      }
      case 'cobweb': {
        const w = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), new THREE.MeshBasicMaterial({ map: cobwebTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0.75 }));
        w.position.set(0.4, -0.4, 0.01);
        o.add(w);
        break;
      }
    }
    o.traverse((m) => { if ((m as THREE.Mesh).isMesh) (m as THREE.Mesh).receiveShadow = true; });
    g.add(o);
  }
  // cobwebs in the ceiling corners of rooms that ask for them
  for (const r of level.rooms) {
    if (!r.cobwebs) continue;
    const h = (r.height ?? 2.6) - 0.02;
    const corners: [number, number, number][] = [[r.x + 0.01, r.z + 0.01, 0], [r.x + r.w - 0.01, r.z + 0.01, 90], [r.x + r.w - 0.01, r.z + r.d - 0.01, 180], [r.x + 0.01, r.z + r.d - 0.01, 270]];
    corners.forEach(([cx, cz, a], i) => {
      if ((i + level.index + r.id.length) % 3 === 2) return; // not every corner
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.75), new THREE.MeshBasicMaterial({ map: cobwebTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0.7 }));
      // a diagonal web spanning the corner, tilted down from the ceiling
      const o = new THREE.Group();
      o.position.set(cx, h, cz);
      o.rotation.y = THREE.MathUtils.degToRad(-a - 45);
      w.position.set(0, -0.26, 0.26);
      w.rotation.x = -Math.PI / 4;
      w.rotation.z = Math.PI / 4;
      o.add(w);
      g.add(o);
    });
  }
  void world;
  return { group: g, clocks, eyes };
}

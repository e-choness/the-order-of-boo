// Halloween night outside: a violet sky with a huge harvest moon and drifting
// clouds, spectral ribbons, falling autumn leaves, low ground fog, a flock of
// bats, will-o'-wisps, a leaf-strewn yard dressed for each mission, moonlight
// and the neighbours' glowing windows.

import * as THREE from 'three';
import type { LevelDef } from '../levels/types';
import { makeProp } from './props';
import { groundTexture, mulberry, batShape } from './textures';
import { F, type PhysicsWorld } from './physics';

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w; // at far plane
}`;

const skyFrag = /* glsl */ `
uniform float uTime;
uniform vec3 uMoonDir;
uniform float uSpirits;
varying vec3 vDir;
float hash(vec3 p){ p = fract(p * 0.3183099 + .1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  float a = hash(vec3(i,0.)), b = hash(vec3(i+vec2(1,0),0.)), c = hash(vec3(i+vec2(0,1),0.)), d = hash(vec3(i+vec2(1,1),0.));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -0.2, 1.0);
  vec3 top = vec3(0.016, 0.01, 0.045);
  vec3 mid = vec3(0.09, 0.04, 0.16);
  vec3 hor = vec3(0.42, 0.16, 0.12);
  vec3 col = mix(hor, mid, smoothstep(-0.02, 0.28, h));
  col = mix(col, top, smoothstep(0.28, 0.9, h));
  // stars
  vec3 sd = d * 420.0;
  float s = hash(floor(sd));
  float tw = 0.6 + 0.4 * sin(uTime * 2.0 + s * 50.0);
  col += vec3(0.95, 0.92, 1.0) * step(0.9978, s) * tw * smoothstep(0.05, 0.35, h) * 1.4;
  // harvest moon: big, warm, with craters and a hazy halo
  vec3 md = normalize(uMoonDir);
  float m = dot(d, md);
  float disc = smoothstep(0.9965, 0.9972, m);
  vec2 muv = vec2(dot(d, normalize(cross(md, vec3(0,1,0)))), d.y - md.y) * 60.0;
  float crater = fbm(muv * 1.4 + 3.0);
  vec3 moonCol = mix(vec3(1.0, 0.86, 0.6), vec3(0.85, 0.62, 0.42), smoothstep(0.45, 0.7, crater));
  col = mix(col, moonCol * 3.2, disc);
  col += vec3(1.0, 0.6, 0.35) * pow(max(m, 0.0), 90.0) * 0.55;
  col += vec3(0.55, 0.3, 0.5) * pow(max(m, 0.0), 10.0) * 0.22;
  // drifting clouds, lit from behind by the moon
  if (d.y > -0.05) {
    vec2 cuv = d.xz / (d.y + 0.35) * 1.6 + vec2(uTime * 0.012, uTime * 0.004);
    float c = smoothstep(0.5, 0.85, fbm(cuv));
    float rim = pow(max(m, 0.0), 30.0);
    vec3 cc = mix(vec3(0.05, 0.03, 0.08), vec3(0.75, 0.55, 0.45), rim);
    col = mix(col, cc, c * 0.85 * smoothstep(-0.05, 0.25, d.y));
  }
  // faint green spirit ribbons
  if (uSpirits > 0.0 && d.y > 0.08) {
    vec2 uv = d.xz / (d.y + 0.25);
    float band = 0.0;
    for (int i = 0; i < 2; i++) {
      float fi = float(i);
      float n = noise(uv * (1.1 + fi * 0.5) + vec2(uTime * 0.025 * (fi + 1.0), fi * 3.1));
      band += smoothstep(0.62, 0.95, n) * (0.5 - fi * 0.15);
    }
    vec3 ac = mix(vec3(0.35, 1.0, 0.45), vec3(0.6, 0.35, 1.0), smoothstep(0.1, 0.6, d.y));
    col += ac * band * uSpirits * smoothstep(0.08, 0.4, d.y) * 0.4;
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const leafVert = /* glsl */ `
uniform float uTime;
uniform vec3 uCenter;
uniform vec4 uHole; // minX, minZ, maxX, maxZ of the house (no leaves inside)
uniform float uScale;
attribute float aSeed;
varying float vA;
varying float vSeed;
varying float vRot;
void main() {
  vec3 p = position;
  float fall = mod(p.y - uTime * (0.35 + aSeed * 0.35), 14.0);
  p.y = fall - 1.0;
  // fluttering, wind-blown drift
  p.x += sin(uTime * 1.3 + aSeed * 30.0) * 0.6 + uTime * 0.45;
  p.z += cos(uTime * 0.9 + aSeed * 20.0) * 0.5 + uTime * 0.12;
  p.x = uCenter.x + mod(p.x - uCenter.x + 30.0, 60.0) - 30.0;
  p.z = uCenter.z + mod(p.z - uCenter.z + 30.0, 60.0) - 30.0;
  float inside = step(uHole.x - 0.3, p.x) * step(p.x, uHole.z + 0.3) * step(uHole.y - 0.3, p.z) * step(p.z, uHole.w + 0.3) * step(p.y, 3.4);
  vA = (1.0 - inside);
  vSeed = aSeed;
  vRot = uTime * (1.5 + aSeed * 3.0) + aSeed * 40.0;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = min(36.0, (0.9 + aSeed * 0.9) * uScale / max(0.1, -mv.z));
  gl_Position = projectionMatrix * mv;
}`;

const leafFrag = /* glsl */ `
varying float vA;
varying float vSeed;
varying float vRot;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float cs = cos(vRot), sn = sin(vRot);
  c = mat2(cs, -sn, sn, cs) * c;
  // a pointed leaf: an ellipse that tumbles (squashes) as it spins
  c.x /= 0.35 + 0.65 * abs(sin(vRot * 0.7));
  float leaf = smoothstep(0.5, 0.42, length(c * vec2(1.0, 1.8)));
  float a = leaf * vA;
  if (a < 0.05) discard;
  vec3 col = mix(vec3(0.85, 0.32, 0.08), vec3(0.95, 0.62, 0.15), fract(vSeed * 7.0));
  col = mix(col, vec3(0.5, 0.15, 0.08), step(0.75, fract(vSeed * 13.0)));
  gl_FragColor = vec4(col * 0.55, a);
}`;

const fogVert = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const fogFrag = /* glsl */ `
uniform float uTime;
uniform vec4 uHole;
uniform float uAlpha;
uniform vec3 uColor;
varying vec3 vWorld;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), f.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y); }
void main() {
  vec2 p = vWorld.xz * 0.18 + vec2(uTime * 0.04, uTime * 0.015);
  float n = noise(p) * 0.6 + noise(p * 2.3 - uTime * 0.03) * 0.4;
  float inside = step(uHole.x, vWorld.x) * step(vWorld.x, uHole.z) * step(uHole.y, vWorld.z) * step(vWorld.z, uHole.w);
  float d = length(vWorld.xz - (uHole.xy + uHole.zw) * 0.5);
  float a = smoothstep(0.35, 0.8, n) * uAlpha * (1.0 - inside) * smoothstep(70.0, 20.0, d);
  gl_FragColor = vec4(uColor, a);
}`;

/** Yard dressing per mission: [model, dx, dz (relative to a house corner), rotation, scale]. */
type YardItem = [string, number, number, number, number?];

export class Environment {
  group = new THREE.Group();
  sky: THREE.Mesh;
  leaves: THREE.Points;
  moon: THREE.DirectionalLight;
  moonDir: THREE.Vector3;
  hemi: THREE.HemisphereLight;
  private chimneySmoke: THREE.Vector3 | null = null;
  eaveLights: THREE.InstancedMesh | null = null;
  private eaveColors: THREE.Color[] = [];
  private fog: THREE.Mesh[] = [];
  private bats: { mesh: THREE.Mesh; r: number; h: number; speed: number; phase: number }[] = [];
  private center: THREE.Vector3;
  private extent: number;

  constructor(level: LevelDef, world: PhysicsWorld, shadowSize: number) {
    const [bx0, bz0, bx1, bz1] = level.bounds;
    const cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2;
    this.center = new THREE.Vector3(cx, 0, cz);
    const style = level.exterior.style;
    this.moonDir = new THREE.Vector3(-0.55, 0.5, 0.62).normalize();
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(150, 32, 16),
      new THREE.ShaderMaterial({
        vertexShader: skyVert,
        fragmentShader: skyFrag,
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          uTime: { value: 0 },
          uMoonDir: { value: this.moonDir },
          uSpirits: { value: style === 'academy' || style === 'manor' ? 1 : 0.4 },
        },
      }),
    );
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.group.add(this.sky);

    // moonlight (the only shadow caster → moonbeams through windows)
    this.moon = new THREE.DirectionalLight(0xc9b8ff, 1.45);
    this.moon.position.set(cx, 0, cz).addScaledVector(this.moonDir, 30);
    this.moon.target.position.set(cx, 0, cz);
    this.moon.castShadow = shadowSize > 0;
    const ext = Math.max(bx1 - bx0, bz1 - bz0) / 2 + 6;
    this.extent = ext;
    const sc = this.moon.shadow.camera;
    sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext;
    sc.near = 1; sc.far = 70;
    this.moon.shadow.mapSize.set(shadowSize, shadowSize);
    this.moon.shadow.bias = -0.0006;
    this.moon.shadow.normalBias = 0.03;
    this.group.add(this.moon, this.moon.target);

    this.hemi = new THREE.HemisphereLight(0x4a3a7a, 0x2a1a12, 0.55);
    this.group.add(this.hemi);
    this.group.add(new THREE.AmbientLight(0x6a5a90, 0.12));

    // leaf-strewn lawn
    const gt = groundTexture();
    gt.repeat.set(30, 30);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(120, 48), new THREE.MeshStandardMaterial({ map: gt, roughness: 0.95, color: 0xb8b0a0 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    this.group.add(ground);

    const rnd = mulberry(level.index * 977 + 13);
    // leaf piles scattered across the lawn
    for (let i = 0; i < 26; i++) {
      const a = rnd() * Math.PI * 2;
      const r = ext + 1 + rnd() * 26;
      const p = makeProp({ m: 'spooky/leafPile', x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r, rot: rnd() * 360, s: 0.8 + rnd() * 1.4 });
      this.group.add(p);
    }

    // trees: bare, twisted dead trees mixed with dark pines
    for (let i = 0; i < 64; i++) {
      const a = rnd() * Math.PI * 2;
      const r = ext + 4 + rnd() * 45 * (style === 'farm' ? 0.8 : 1);
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      const dead = rnd() < 0.55;
      const t = dead
        ? makeProp({ m: 'spooky/deadTree', x, z, rot: rnd() * 360, s: 0.9 + rnd() * 0.9 })
        : makeProp({ m: 'holiday/treePine', x, z, rot: rnd() * 360, s: 1.5 + rnd() * 1.6, tint: { '*': rnd() < 0.5 ? '#1f2a22' : '#2a2a1c' } });
      this.group.add(t);
    }

    // per-mission yard: pumpkins on the porch, lawn graves, scarecrows, hay…
    const yard = yardFor(style, bx0, bz0, bx1, bz1, rnd);
    for (const [m, x, z, r, s] of yard) {
      const p = makeProp({ m, x, z, rot: r, s: s ?? 1 });
      this.group.add(p);
      if (!/leafPile|pumpkinSmall|gourds/.test(m)) world.addFromObject(p, F.MOVE | F.SIGHT | F.LIGHT | F.CAMERA, {}, 0.05);
    }
    // two warm lantern posts by the path (fixed count = no shader recompiles)
    for (const lp of [[bx0 - 1.2, bz1 + 1.5], [bx1 + 1.2, bz0 - 1.5]]) {
      const post = makeProp({ m: 'spooky/lanternPost', x: lp[0], z: lp[1] });
      this.group.add(post);
      world.addFromObject(post, F.MOVE | F.SIGHT | F.CAMERA, {}, 0.05);
      const l = new THREE.PointLight(0xffa050, 6, 9, 1.6);
      l.position.set(lp[0], 2.2, lp[1]);
      this.group.add(l);
    }

    // neighbours' houses: dark shapes with orange and violet windows, a lit jack-o'-lantern on each step
    const nbMat = new THREE.MeshStandardMaterial({ color: 0x1a1424, roughness: 1 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x0e0c14, roughness: 1 });
    const winA = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffa040, emissiveIntensity: 2.2 });
    const winB = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x9a5cff, emissiveIntensity: 1.8 });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + rnd() * 0.3;
      const r = 45 + rnd() * 20;
      const hx = cx + Math.cos(a) * r, hz = cz + Math.sin(a) * r;
      const w = 6 + rnd() * 4, d = 5 + rnd() * 3, h = 3 + rnd() * 2;
      const house = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), nbMat);
      body.position.y = h / 2;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.75, 2.8 + rnd() * 1.2, 4), roofMat);
      roof.position.y = h + 1.4;
      roof.rotation.y = Math.PI / 4;
      house.add(body, roof);
      for (let k = 0; k < 4; k++) {
        if (rnd() < 0.35) continue;
        const win = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.9), rnd() < 0.7 ? winA : winB);
        win.position.set(-w / 2 + 1 + k * (w - 2) / 3, h * 0.55, d / 2 + 0.01);
        house.add(win);
      }
      const jack = makeProp({ m: 'spooky/jackOLantern', x: 0.6, z: d / 2 + 0.4, s: 1.4 });
      house.add(jack);
      house.position.set(hx, 0, hz);
      house.lookAt(cx, 0, cz);
      this.group.add(house);
    }

    // eave string lights: orange, violet and slime green
    const n = Math.floor(((bx1 - bx0) + (bz1 - bz0)) * 2 * 3);
    const inst = new THREE.InstancedMesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshStandardMaterial({ color: 0, emissive: 0xffffff, emissiveIntensity: 1.5 }), n);
    const pal = ['#ff7a1a', '#a35cff', '#ff9a3c', '#7cff6b'].map((c) => new THREE.Color(c));
    const per = [(bx1 - bx0), (bz1 - bz0), (bx1 - bx0), (bz1 - bz0)];
    const total = per.reduce((s, v) => s + v, 0);
    const mtx = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      let u = (i / n) * total;
      let side = 0;
      while (u > per[side]) { u -= per[side]; side++; }
      const sag = Math.sin((u % 1) * Math.PI) * 0.12;
      const y = 2.72 - sag;
      let x = 0, z = 0;
      if (side === 0) { x = bx0 + u; z = bz0 - 0.35; }
      else if (side === 1) { x = bx1 + 0.35; z = bz0 + u; }
      else if (side === 2) { x = bx1 - u; z = bz1 + 0.35; }
      else { x = bx0 - 0.35; z = bz1 - u; }
      mtx.setPosition(x, y, z);
      inst.setMatrixAt(i, mtx);
      const c = pal[i % pal.length];
      this.eaveColors.push(c);
      inst.setColorAt(i, c);
    }
    this.eaveLights = inst;
    this.group.add(inst);

    // falling autumn leaves
    const N = 1400;
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = cx + (rnd() - 0.5) * 60;
      pos[i * 3 + 1] = rnd() * 14;
      pos[i * 3 + 2] = cz + (rnd() - 0.5) * 60;
      seed[i] = rnd();
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    lg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.leaves = new THREE.Points(
      lg,
      new THREE.ShaderMaterial({
        vertexShader: leafVert,
        fragmentShader: leafFrag,
        transparent: true,
        depthWrite: false,
        uniforms: {
          uTime: { value: 0 },
          uCenter: { value: new THREE.Vector3(cx, 0, cz) },
          uHole: { value: new THREE.Vector4(bx0, bz0, bx1, bz1) },
          uScale: { value: window.innerHeight * 0.06 },
        },
      }),
    );
    this.leaves.frustumCulled = false;
    this.group.add(this.leaves);

    // low ground fog: two noisy layers hugging the lawn (never inside the house)
    for (const [y, alpha] of [[0.1, 0.26], [0.5, 0.1]] as const) {
      const f = new THREE.Mesh(
        new THREE.PlaneGeometry(140, 140),
        new THREE.ShaderMaterial({
          vertexShader: fogVert,
          fragmentShader: fogFrag,
          transparent: true,
          depthWrite: false,
          uniforms: {
            uTime: { value: 0 },
            uHole: { value: new THREE.Vector4(bx0 - 0.25, bz0 - 0.25, bx1 + 0.25, bz1 + 0.25) },
            uAlpha: { value: alpha },
            uColor: { value: new THREE.Color(0x5e4e7e) },
          },
        }),
      );
      f.rotation.x = -Math.PI / 2;
      f.position.set(cx, y, cz);
      f.renderOrder = 2;
      this.fog.push(f);
      this.group.add(f);
    }

    // bats circling the rooftop
    const bc = document.createElement('canvas');
    bc.width = 128; bc.height = 80;
    const bx = bc.getContext('2d')!;
    bx.fillStyle = '#08060c';
    batShape(bx, 64, 44, 60);
    const batTex = new THREE.CanvasTexture(bc);
    batTex.colorSpace = THREE.SRGBColorSpace;
    const batMat = new THREE.MeshBasicMaterial({ map: batTex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, fog: false });
    for (let i = 0; i < 14; i++) {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.31), batMat);
      this.bats.push({ mesh: b, r: 4 + rnd() * (ext + 4), h: 4.5 + rnd() * 5, speed: (0.25 + rnd() * 0.3) * (rnd() < 0.5 ? -1 : 1), phase: rnd() * Math.PI * 2 });
      this.group.add(b);
    }
    this.chimneySmoke = new THREE.Vector3(level.chimney[0], 5.2, level.chimney[2]);
  }

  update(dt: number, time: number, camPos: THREE.Vector3, fx?: import('../fx/particles').FX) {
    (this.sky.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
    this.sky.position.copy(camPos);
    const lu = (this.leaves.material as THREE.ShaderMaterial).uniforms;
    lu.uTime.value = time;
    lu.uCenter.value.set(camPos.x, 0, camPos.z);
    for (const f of this.fog) (f.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
    if (this.eaveLights) {
      const c = new THREE.Color();
      for (let i = 0; i < this.eaveColors.length; i++) {
        // a slow spooky chase with the odd dying flicker
        const on = 0.35 + 0.65 * Math.max(0, Math.sin(time * 1.2 - i * 0.35)) * (Math.sin(time * 37 + i * 11) > 0.97 ? 0.2 : 1);
        c.copy(this.eaveColors[i]).multiplyScalar(on);
        this.eaveLights.setColorAt(i, c);
      }
      this.eaveLights.instanceColor!.needsUpdate = true;
    }
    for (const b of this.bats) {
      const a = b.phase + time * b.speed;
      b.mesh.position.set(this.center.x + Math.cos(a) * b.r, b.h + Math.sin(time * 1.7 + b.phase) * 0.6, this.center.z + Math.sin(a) * b.r);
      b.mesh.lookAt(camPos);
      b.mesh.scale.set(1, 0.4 + Math.abs(Math.sin(time * 14 + b.phase)) * 0.8, 1); // flapping
    }
    if (fx) {
      if (this.chimneySmoke && Math.random() < dt * 6) {
        fx.smoke.emit({ pos: this.chimneySmoke, posJitter: 0.3, vel: new THREE.Vector3(0.25, 0.7, 0.05), spread: 0.15, life: [3, 5], size: [0.6, 1.0], endSize: 3, color: 0x6a6078, alpha: 0.35, spin: 0.3 });
      }
      // will-o'-wisps drifting over the lawn
      if (Math.random() < dt * 3) {
        const a = Math.random() * Math.PI * 2;
        const r = this.extent + 1 + Math.random() * 14;
        fx.light.emit({ pos: new THREE.Vector3(this.center.x + Math.cos(a) * r, 0.4 + Math.random() * 1.2, this.center.z + Math.sin(a) * r), vel: new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.12, (Math.random() - 0.5) * 0.3), life: [2.5, 4], size: [0.08, 0.14], endSize: 0.4, color: [0x9dff7a, 0xbff6ff], alpha: 0.85 });
      }
    }
  }
}

function yardFor(style: LevelDef['exterior']['style'], bx0: number, bz0: number, bx1: number, bz1: number, rnd: () => number): YardItem[] {
  const out: YardItem[] = [];
  // porch pumpkins by the front (south) wall, always
  for (let i = 0; i < 4; i++) out.push([i % 2 ? 'spooky/jackOLantern' : 'spooky/pumpkin', bx0 + 1 + i * 0.5, bz1 + 0.55 + (i % 2) * 0.2, 180 + (rnd() - 0.5) * 40, 1 + rnd() * 0.4]);
  out.push(['spooky/pumpkinLarge', bx0 + 3.2, bz1 + 0.7, 160]);
  out.push(['spooky/gourds', bx0 + 2.6, bz1 + 0.5, 0]);
  if (style === 'suburb') {
    out.push(['spooky/inflatableGhost', bx1 + 3, bz1 + 3, 200]);
    out.push(['spooky/gravestone', bx0 - 2.5, bz1 + 3, 170], ['spooky/gravestone', bx0 - 1.2, bz1 + 3.6, 190], ['spooky/gravestoneCross', bx0 - 3.6, bz1 + 3.8, 160]);
    out.push(['spooky/spider', bx1 + 1.5, bz1 + 1.4, 30, 2]);
    out.push(['holiday/rockFormationMedium', bx0 - 6, bz1 + 4, 20]);
  } else if (style === 'farm') {
    out.push(['spooky/scarecrow', bx1 + 3.5, bz1 + 4, 200]);
    out.push(['spooky/hayBale', bx1 + 2, bz1 + 2.2, 15], ['spooky/hayBale', bx1 + 2.3, bz1 + 2.9, -10], ['spooky/hayBale', bx0 - 2.4, bz0 - 2, 70]);
    // a pumpkin patch in rows
    for (let r = 0; r < 4; r++) for (let c = 0; c < 7; c++) {
      if (rnd() < 0.3) continue;
      out.push([rnd() < 0.15 ? 'spooky/pumpkinLarge' : rnd() < 0.2 ? 'spooky/pumpkinWhite' : 'spooky/pumpkin', bx0 - 3 - c * 1.1 + rnd() * 0.3, bz1 + 3 + r * 1.2 + rnd() * 0.3, rnd() * 360, 0.8 + rnd() * 0.6]);
    }
    out.push(['spooky/scarecrow', bx0 - 6, bz1 + 5, 150, 0.9]);
  } else if (style === 'manor') {
    for (let i = 0; i < 7; i++) out.push(['spooky/fence', bx0 - 2 + i * 2, bz1 + 5, 0]);
    for (let i = 0; i < 6; i++) out.push([i % 3 === 1 ? 'spooky/gravestoneCross' : 'spooky/gravestone', bx1 + 2.5 + (i % 3) * 1.3, bz0 + 1 + Math.floor(i / 3) * 1.6, 270 + (rnd() - 0.5) * 30, 1 + rnd() * 0.3]);
    out.push(['spooky/inflatableGhost', bx0 - 3, bz1 + 2.5, 160]);
    out.push(['spooky/crow', bx1 + 2.5, bz0 + 1, 260, 1.6]);
  } else {
    // the academy sits in an old cemetery
    for (let i = 0; i < 14; i++) {
      const a = rnd() * Math.PI * 2, r = 4 + rnd() * 8;
      const x = (bx0 + bx1) / 2 + Math.cos(a) * (r + (bx1 - bx0) / 2), z = (bz0 + bz1) / 2 + Math.sin(a) * (r + (bz1 - bz0) / 2);
      out.push([rnd() < 0.3 ? 'spooky/gravestoneCross' : 'spooky/gravestone', x, z, rnd() * 40 - 20 + (z > bz1 ? 180 : 0), 0.9 + rnd() * 0.5]);
    }
    for (let i = 0; i < 6; i++) out.push(['spooky/fence', bx0 - 3 + i * 2, bz1 + 6, 0]);
    out.push(['spooky/cauldron', bx1 + 2, bz1 + 1.5, 0, 1.4]);
  }
  return out;
}

// CPU-simulated, GPU-drawn sprite particles using Kenney's Particle Pack (CC0).

import * as THREE from 'three';
import { loadTexture } from '../core/assets';

const vert = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
attribute float aAngle;
varying vec4 vColor;
varying float vAngle;
uniform float uScale;
void main() {
  vColor = aColor;
  vAngle = aAngle;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.05, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const frag = /* glsl */ `
uniform sampler2D uMap;
uniform float uBoost;
varying vec4 vColor;
varying float vAngle;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float c = cos(vAngle), s = sin(vAngle);
  p = mat2(c, -s, s, c) * p + 0.5;
  vec4 t = texture2D(uMap, p);
  float a = t.a * vColor.a;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor.rgb * t.rgb * uBoost, a);
  #include <colorspace_fragment>
}`;

export interface EmitOpts {
  pos: THREE.Vector3;
  vel?: THREE.Vector3;
  spread?: number;      // random velocity magnitude
  posJitter?: number;
  life?: [number, number];
  size?: [number, number];
  endSize?: number;     // multiplier at end of life
  color?: THREE.ColorRepresentation | THREE.ColorRepresentation[];
  alpha?: number;
  gravity?: number;
  drag?: number;
  spin?: number;
  count?: number;
  fadeIn?: number;      // fraction of life
}

export class ParticleSystem {
  points: THREE.Points;
  private max: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private baseSize: Float32Array;
  private endSize: Float32Array;
  private angle: Float32Array;
  private spin: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private alpha0: Float32Array;
  private fadeIn: Float32Array;
  private cursor = 0;
  private geo: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;

  constructor(texture: string | THREE.Texture, max = 600, additive = true, boost = 1) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.baseSize = new Float32Array(max);
    this.endSize = new Float32Array(max);
    this.angle = new Float32Array(max);
    this.spin = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.alpha0 = new Float32Array(max);
    this.fadeIn = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAngle', new THREE.BufferAttribute(this.angle, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: typeof texture === 'string' ? loadTexture(`particles/${texture}.png`, false) : texture },
        uScale: { value: window.innerHeight * 0.62 },
        uBoost: { value: 1 },
      },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.material.uniforms.uBoost.value = boost;
    this.points = new THREE.Points(this.geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    window.addEventListener('resize', () => { this.material.uniforms.uScale.value = window.innerHeight * 0.62; });
  }

  emit(o: EmitOpts) {
    const n = o.count ?? 1;
    const cols = Array.isArray(o.color) ? o.color : [o.color ?? 0xffffff];
    const tmp = new THREE.Color();
    for (let k = 0; k < n; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const j = (o.posJitter ?? 0);
      this.pos[i * 3] = o.pos.x + (Math.random() - 0.5) * j;
      this.pos[i * 3 + 1] = o.pos.y + (Math.random() - 0.5) * j;
      this.pos[i * 3 + 2] = o.pos.z + (Math.random() - 0.5) * j;
      const sp = o.spread ?? 0;
      const rv = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(sp * Math.random());
      this.vel[i * 3] = (o.vel?.x ?? 0) + rv.x;
      this.vel[i * 3 + 1] = (o.vel?.y ?? 0) + rv.y;
      this.vel[i * 3 + 2] = (o.vel?.z ?? 0) + rv.z;
      tmp.set(cols[(Math.random() * cols.length) | 0]);
      this.col[i * 4] = tmp.r;
      this.col[i * 4 + 1] = tmp.g;
      this.col[i * 4 + 2] = tmp.b;
      this.alpha0[i] = o.alpha ?? 1;
      this.col[i * 4 + 3] = 0;
      const [s0, s1] = o.size ?? [0.1, 0.2];
      this.baseSize[i] = s0 + Math.random() * (s1 - s0);
      this.endSize[i] = o.endSize ?? 1;
      this.size[i] = this.baseSize[i];
      const [l0, l1] = o.life ?? [0.6, 1.2];
      this.maxLife[i] = this.life[i] = l0 + Math.random() * (l1 - l0);
      this.grav[i] = o.gravity ?? 0;
      this.drag[i] = o.drag ?? 0;
      this.angle[i] = Math.random() * Math.PI * 2;
      this.spin[i] = (Math.random() - 0.5) * (o.spin ?? 1);
      this.fadeIn[i] = o.fadeIn ?? 0.15;
    }
  }

  update(dt: number) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        if (this.col[i * 4 + 3] !== 0) { this.col[i * 4 + 3] = 0; this.size[i] = 0; }
        continue;
      }
      this.life[i] -= dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= dr;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * dr - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= dr;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const fi = this.fadeIn[i];
      const a = t < fi ? t / fi : 1 - (t - fi) / (1 - fi);
      this.col[i * 4 + 3] = Math.max(0, a) * this.alpha0[i];
      this.size[i] = this.baseSize[i] * (1 + (this.endSize[i] - 1) * t);
      this.angle[i] += this.spin[i] * dt;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAngle.needsUpdate = true;
  }
}

/** All shared particle systems for a level. */
export class FX {
  group = new THREE.Group();
  fire = new ParticleSystem(flameTexture(), 500, true, 3.2);
  sparkle = new ParticleSystem('star_06', 900, true, 1.8);
  glitter = new ParticleSystem('star_04', 600, true);
  magic = new ParticleSystem('magic_02', 400, true);
  smoke = new ParticleSystem('smoke_04', 300, false);
  mist = new ParticleSystem('twirl_02', 400, true);
  zzz = new ParticleSystem('circle_05', 80, true);
  hearts = new ParticleSystem('symbol_01', 60, false);
  light = new ParticleSystem('star_07', 200, true);

  constructor() {
    for (const s of [this.smoke, this.fire, this.magic, this.mist, this.sparkle, this.glitter, this.light, this.zzz, this.hearts]) this.group.add(s.points);
  }

  update(dt: number) {
    this.fire.update(dt);
    this.sparkle.update(dt);
    this.glitter.update(dt);
    this.magic.update(dt);
    this.smoke.update(dt);
    this.mist.update(dt);
    this.zzz.update(dt);
    this.hearts.update(dt);
    this.light.update(dt);
  }

  burst(pos: THREE.Vector3, colors: THREE.ColorRepresentation[] = [0xffb050, 0x9dff7a, 0xc9a2ff, 0xbff6ff], count = 40, spread = 2.4) {
    this.sparkle.emit({ pos, count, spread, life: [0.4, 1.1], size: [0.05, 0.14], endSize: 0.2, color: colors, gravity: 1.5, drag: 2.5, spin: 6 });
    this.glitter.emit({ pos, count: Math.floor(count / 2), spread: spread * 0.6, life: [0.6, 1.6], size: [0.03, 0.07], color: colors, gravity: 0.4, drag: 1.5 });
  }
}

/** Soft teardrop flame: white-hot core fading to orange, drawn once on a canvas. */
function flameTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 40, 2, 32, 36, 30);
  grd.addColorStop(0, 'rgba(255,255,240,1)');
  grd.addColorStop(0.25, 'rgba(255,230,160,0.9)');
  grd.addColorStop(0.6, 'rgba(255,170,80,0.45)');
  grd.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = grd;
  g.beginPath();
  g.moveTo(32, 2);
  g.bezierCurveTo(46, 22, 58, 34, 52, 48);
  g.bezierCurveTo(46, 62, 18, 62, 12, 48);
  g.bezierCurveTo(6, 34, 18, 22, 32, 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

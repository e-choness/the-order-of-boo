// WebGL renderer + post-processing stack:
//   Scene → N8AO ambient occlusion → Bloom → "Stealth" grading (magic states,
//   detection pulse, frost vignette, film grain) → AgX tone mapping → SMAA.

import * as THREE from 'three';
import {
  BlendFunction,
  BloomEffect,
  Effect,
  EffectComposer,
  EffectPass,
  KernelSize,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { settings, onSettings, type Quality } from './settings';

const stealthFrag = /* glsl */ `
uniform float uTime;
uniform float uAlert;      // 0..1 red pulse at screen edges
uniform float uSuspicion;  // 0..1 amber tint
uniform float uInvisible;  // 0..1 fade (ghostly see-through)
uniform float uSight;      // 0..1 spirit sight (green, fisheye)
uniform float uMorph;      // 0..1 pumpkin-vision (warm candlelight, soft)
uniform float uExposure;
uniform float uFade;       // 0..1 fade to black
uniform float uFrost;      // 0..1 misty violet corners
uniform float uGrain;
uniform float uHurt;       // flash when caught

float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }

void mainUv(inout vec2 uv) {
  // Spirit sight: gentle fisheye bulge, like peering out of a glass eye
  vec2 c = uv - 0.5;
  float r2 = dot(c, c);
  uv = 0.5 + c * (1.0 - uSight * 0.22 * r2 * 2.0);
  // Fade: ectoplasmic wobble
  uv += uInvisible * 0.0035 * vec2(sin(uv.y * 40.0 + uTime * 6.0), cos(uv.x * 36.0 + uTime * 5.0));
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 col = inputColor.rgb * uExposure;
  vec2 c = uv - 0.5;
  float d = length(c * vec2(1.0, 0.8));

  // spirit sight: spectral green grade + glowing edge
  if (uSight > 0.0) {
    float l = dot(col, vec3(0.3, 0.59, 0.11));
    vec3 g = mix(vec3(l) * vec3(0.8, 1.15, 0.85), col, 0.35);
    g += vec3(0.06, 0.16, 0.05) * smoothstep(0.35, 0.7, d);
    col = mix(col, g, uSight);
  }
  // possess: looking out through carved pumpkin eyes — warm, flickering, dark vignette
  if (uMorph > 0.0) {
    vec3 p = floor(col * 10.0) / 10.0;
    float flick = 0.92 + 0.08 * sin(uTime * 13.0) * sin(uTime * 4.7);
    col = mix(col, p * vec3(1.2, 0.92, 0.65) * flick, uMorph * 0.6);
    col *= 1.0 - uMorph * smoothstep(0.3, 0.75, d) * 0.7;
  }
  // fade: cold, desaturated, ghost-sparkles
  if (uInvisible > 0.0) {
    float l = dot(col, vec3(0.3, 0.59, 0.11));
    col = mix(col, vec3(l) * vec3(0.85, 1.05, 1.15), uInvisible * 0.55);
    float sp = step(0.9975, hash(floor(uv * vec2(320.0, 180.0)) + floor(uTime * 8.0)));
    col += sp * uInvisible * vec3(0.7, 1.0, 0.8) * smoothstep(0.2, 0.6, d);
  }
  // suspicion amber + alert red pulse at edges
  float edge = smoothstep(0.38, 0.85, d);
  col = mix(col, col * vec3(1.15, 0.95, 0.7), uSuspicion * edge * 0.6);
  float pulse = 0.65 + 0.35 * sin(uTime * 7.0);
  col = mix(col, vec3(0.9, 0.05, 0.08), uAlert * edge * pulse * 0.55);
  // violet mist curling in from the corners
  float frost = smoothstep(0.6, 1.0, d) * (0.8 + 0.2 * sin(uv.x * 9.0 + uv.y * 7.0 + uTime * 0.6));
  col = mix(col, vec3(0.32, 0.2, 0.45), frost * uFrost * 0.55);
  // grain
  col += (hash(uv * 1000.0 + uTime) - 0.5) * uGrain;
  col = mix(col, vec3(1.0, 0.95, 0.9), uHurt);
  col *= 1.0 - uFade;
  outputColor = vec4(col, inputColor.a);
}
`;

export class StealthEffect extends Effect {
  constructor() {
    super('StealthEffect', stealthFrag, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ['uTime', new THREE.Uniform(0)],
        ['uAlert', new THREE.Uniform(0)],
        ['uSuspicion', new THREE.Uniform(0)],
        ['uInvisible', new THREE.Uniform(0)],
        ['uSight', new THREE.Uniform(0)],
        ['uMorph', new THREE.Uniform(0)],
        ['uExposure', new THREE.Uniform(1.0)],
        ['uFade', new THREE.Uniform(0)],
        ['uFrost', new THREE.Uniform(0.35)],
        ['uGrain', new THREE.Uniform(0.012)],
        ['uHurt', new THREE.Uniform(0)],
      ]),
    });
  }
  set(name: string, v: number) {
    this.uniforms.get(name)!.value = v;
  }
  get(name: string): number {
    return this.uniforms.get(name)!.value;
  }
}

export class Renderer {
  gl: THREE.WebGLRenderer;
  composer: EffectComposer;
  stealth: StealthEffect;
  private bloom: BloomEffect;
  private ao: N8AOPostPass | null = null;
  private renderPass: RenderPass;
  private passes: EffectPass[] = [];
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  quality: Quality;
  canvas: HTMLCanvasElement;

  constructor(container: HTMLElement) {
    this.gl = new THREE.WebGLRenderer({
      antialias: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
    });
    this.canvas = this.gl.domElement;
    this.canvas.id = 'game-canvas';
    container.appendChild(this.canvas);
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.NoToneMapping;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(settings.fov, 16 / 9, 0.06, 160);

    this.composer = new EffectComposer(this.gl, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.stealth = new StealthEffect();
    this.bloom = new BloomEffect({
      intensity: 1.15,
      luminanceThreshold: 0.72,
      luminanceSmoothing: 0.25,
      mipmapBlur: true,
      radius: 0.72,
      kernelSize: KernelSize.LARGE,
    });
    this.quality = settings.quality;
    this.buildPipeline();
    window.addEventListener('resize', () => this.resize());
    this.resize();
    onSettings((s) => {
      this.camera.fov = s.fov;
      this.camera.updateProjectionMatrix();
      if (s.quality !== this.quality) {
        this.quality = s.quality;
        this.buildPipeline();
        this.resize();
      }
    });
  }

  setScene(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.scene = scene;
    this.camera = camera;
    camera.fov = settings.fov;
    this.buildPipeline();
    this.resize();
  }

  private buildPipeline() {
    this.composer.removeAllPasses();
    for (const p of this.passes) p.dispose?.();
    (this.ao as unknown as { dispose?: () => void } | null)?.dispose?.();
    this.passes = [];
    const q = this.quality;
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    if (q === 'high' || q === 'ultra') {
      this.ao = new N8AOPostPass(this.scene, this.camera, window.innerWidth, window.innerHeight);
      this.ao.configuration.aoRadius = 0.9;
      this.ao.configuration.distanceFalloff = 0.6;
      this.ao.configuration.intensity = 2.6;
      this.ao.configuration.color = new THREE.Color(0x0a0612);
      this.ao.configuration.halfRes = q !== 'ultra';
      this.ao.configuration.aoSamples = q === 'ultra' ? 16 : 10;
      this.ao.configuration.denoiseSamples = q === 'ultra' ? 8 : 4;
      this.ao.configuration.gammaCorrection = false;
      this.composer.addPass(this.ao as any);
    } else {
      this.ao = null;
    }
    if (q !== 'low') {
      const bp = new EffectPass(this.camera, this.bloom);
      this.passes.push(bp);
      this.composer.addPass(bp);
    }
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    const grade = new EffectPass(this.camera, this.stealth, tone);
    this.passes.push(grade);
    this.composer.addPass(grade);
    if (q !== 'low') {
      const smaa = new EffectPass(this.camera, new SMAAEffect({ preset: q === 'ultra' ? SMAAPreset.ULTRA : SMAAPreset.HIGH }));
      this.passes.push(smaa);
      this.composer.addPass(smaa);
    }
    this.gl.shadowMap.enabled = q !== 'low';
  }

  get shadowMapSize() {
    return { low: 512, medium: 1024, high: 2048, ultra: 4096 }[this.quality];
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio, { low: 0.75, medium: 1, high: 1.5, ultra: 2 }[this.quality]);
    this.gl.setPixelRatio(pr);
    this.gl.setSize(w, h);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(dt: number) {
    this.stealth.set('uTime', this.stealth.get('uTime') + dt);
    this.composer.render(dt);
  }
}

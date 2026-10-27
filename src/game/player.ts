// First-person Boo: movement, crouch, jump, mantling onto furniture, footsteps
// (surface-aware audio + AI noise), head bob and the bedsheet-and-twig-wand viewmodel.

import * as THREE from 'three';
import type { Input } from '../core/input';
import { audio } from '../core/audio';
import { settings } from '../core/settings';
import { F, type PhysicsWorld, type Surface } from '../world/physics';

export const BOO = {
  radius: 0.2,
  height: 1.0,
  crouchHeight: 0.62,
  eye: 0.86,
  crouchEye: 0.5,
  walk: 2.5,
  sprint: 4.3,
  crouch: 1.3,
  jump: 4.5,
  gravity: 13,
  step: 0.32,
};

const STEP_NOISE: Record<Surface, number> = { wood: 3.2, tile: 3.6, carpet: 1.6, soft: 1.2, leaves: 2.4 };
const STEP_SOUND: Record<Surface, string> = { wood: 'sfx/step_wood', tile: 'sfx/step_concrete', carpet: 'sfx/step_carpet', soft: 'sfx/step_carpet', leaves: 'sfx/step_snow' };

export interface PlayerHooks {
  noise: (pos: THREE.Vector3, radius: number, kind: import('./events').NoiseKind) => void;
  creakAt: (x: number, z: number) => boolean;
}

export class Player {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  grounded = true;
  crouched = false;
  sprinting = false;
  camera: THREE.PerspectiveCamera;
  /** smoothed eye height */
  private eyeH = BOO.eye;
  private bob = 0;
  private bobAmt = 0;
  private landDip = 0;
  private stepDist = 0;
  private mantle: { from: THREE.Vector3; to: THREE.Vector3; t: number } | null = null;
  surface: Surface = 'wood';
  frozen = false;
  /** horizontal speed this frame */
  speed = 0;
  moveIntent = 0;
  viewmodel = new THREE.Group();
  private wand: THREE.Group;
  private hand: THREE.Group;
  private wandTip: THREE.Mesh;
  wandGlow = new THREE.Color(0x9dff7a);
  private castAnim = 0;
  private fovKick = 0;
  carryAnchor = new THREE.Object3D();
  private lastCreak = '';
  private fallStartY = 0;
  hideBox = false;

  constructor(private world: PhysicsWorld, private input: Input, private hooks: PlayerHooks) {
    this.camera = new THREE.PerspectiveCamera(settings.fov, window.innerWidth / window.innerHeight, 0.06, 160);
    this.camera.rotation.order = 'YXZ';
    // viewmodel: a bedsheet-covered ghost hand holding a crooked twig wand with a will-o'-wisp tip
    this.hand = new THREE.Group();
    const sheetMat = new THREE.MeshStandardMaterial({ color: 0xf3f1ea, roughness: 0.95, emissive: 0x1a2030, flatShading: true });
    const nub = new THREE.Mesh(new THREE.IcosahedronGeometry(0.026, 2), sheetMat);
    nub.scale.set(1, 0.85, 1.25);
    // the sheet's frayed hem trailing back from the "hand"
    const hem = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.035, 9, 1, true), sheetMat.clone());
    (hem.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    hem.rotation.x = Math.PI / 2;
    hem.position.set(0, -0.004, 0.032);
    this.hand.add(nub, hem);
    this.hand.scale.setScalar(0.75);
    this.wand = new THREE.Group();
    const twigMat = new THREE.MeshStandardMaterial({ color: 0x4a3222, roughness: 0.9, flatShading: true });
    const twig = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.007, 0.16, 5), twigMat);
    twig.position.y = 0.03;
    twig.rotation.z = 0.08;
    const knot = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.003, 0.035, 4), twigMat);
    knot.position.set(0.008, 0.06, 0);
    knot.rotation.z = -0.9;
    this.wand.add(twig, knot);
    this.wandTip = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), new THREE.MeshStandardMaterial({ color: 0, emissive: this.wandGlow, emissiveIntensity: 4 }));
    this.wandTip.position.set(-0.006, 0.12, 0);
    this.wand.add(this.wandTip);
    this.wand.rotation.x = -0.9;
    this.wand.position.set(0, 0.02, -0.03);
    this.hand.add(this.wand);
    this.viewmodel.add(this.hand);
    this.viewmodel.position.set(0.19, -0.17, -0.34);
    this.viewmodel.traverse((o) => { if ((o as THREE.Mesh).isMesh) { (o as THREE.Mesh).castShadow = false; (o as THREE.Mesh).renderOrder = 10; } });
    this.camera.add(this.viewmodel);
    this.carryAnchor.position.set(0.02, -0.1, -0.38);
    this.camera.add(this.carryAnchor);
  }

  get height() { return this.crouched ? BOO.crouchHeight : BOO.height; }
  get eyePos() { return this.camera.position; }
  get chest() { return new THREE.Vector3(this.pos.x, this.pos.y + this.height * 0.6, this.pos.z); }

  spawn(x: number, z: number, rotDeg: number) {
    this.pos.set(x, 0, z);
    const g = this.world.groundHeight(x, z, BOO.radius, 2, 2);
    this.pos.y = g.y;
    this.yaw = THREE.MathUtils.degToRad(rotDeg) + Math.PI;
    this.pitch = 0;
    this.vel.set(0, 0, 0);
    this.updateCamera(0);
  }

  look(dt: number) {
    const s = 0.0022 * settings.sensitivity;
    this.yaw -= this.input.mouseDX * s;
    this.pitch -= this.input.mouseDY * s * (settings.invertY ? -1 : 1);
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.45, 1.45);
    void dt;
  }

  forward() {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }
  lookDir() {
    const d = new THREE.Vector3();
    this.camera.getWorldDirection(d);
    return d;
  }

  cast() { this.castAnim = 1; }

  update(dt: number, canMove: boolean) {
    const inp = this.input;
    // crouch
    const crouchKey = inp.wasPressed('KeyQ') || inp.wasPressed('KeyC') || inp.wasPressed('ControlLeft');
    if (settings.crouchToggle) {
      if (crouchKey && canMove) this.tryCrouch(!this.crouched);
    } else if (canMove) {
      this.tryCrouch(inp.anyDown('KeyQ', 'KeyC', 'ControlLeft'));
    }

    let mx = 0, mz = 0;
    if (canMove && !this.frozen) {
      if (inp.isDown('KeyW') || inp.isDown('ArrowUp')) mz += 1;
      if (inp.isDown('KeyS') || inp.isDown('ArrowDown')) mz -= 1;
      if (inp.isDown('KeyA') || inp.isDown('ArrowLeft')) mx -= 1;
      if (inp.isDown('KeyD') || inp.isDown('ArrowRight')) mx += 1;
    }
    const len = Math.hypot(mx, mz);
    this.moveIntent = len > 0 ? 1 : 0;
    this.sprinting = canMove && inp.isDown('ShiftLeft') && mz > 0 && !this.crouched && !this.hideBox;
    const maxSp = this.hideBox ? 0.9 : this.crouched ? BOO.crouch : this.sprinting ? BOO.sprint : BOO.walk;
    const fwd = this.forward();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const wish = new THREE.Vector3().addScaledVector(fwd, mz).addScaledVector(right, mx);
    if (len > 0) wish.normalize().multiplyScalar(maxSp);

    if (this.mantle) {
      this.updateMantle(dt);
      this.updateCamera(dt);
      return;
    }

    const accel = this.grounded ? 14 : 3;
    this.vel.x += (wish.x - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (wish.z - this.vel.z) * Math.min(1, accel * dt);

    // jump / mantle
    if (canMove && inp.wasPressed('Space') && !this.hideBox) {
      if (!this.tryMantle()) {
        if (this.grounded) {
          this.vel.y = BOO.jump * (this.crouched ? 0.7 : 1);
          this.grounded = false;
          this.fallStartY = this.pos.y;
          audio.play('sfx/cloth', { volume: 0.35 });
        }
      }
    }
    // auto-mantle while airborne and pushing into a ledge
    if (!this.grounded && this.vel.y < 1.5 && mz > 0 && canMove) this.tryMantle(true);

    this.vel.y -= BOO.gravity * dt;
    const next = this.pos.clone().addScaledVector(this.vel, dt);
    // vertical
    const ground = this.world.groundHeight(next.x, next.z, BOO.radius, this.pos.y, BOO.step);
    const ceil = this.world.ceilingHeight(next.x, next.z, BOO.radius, this.pos.y + 0.05);
    if (next.y + this.height > ceil) {
      next.y = ceil - this.height;
      if (this.vel.y > 0) this.vel.y = 0;
    }
    if (next.y <= ground.y) {
      if (!this.grounded) this.onLand(this.fallStartY - ground.y, ground.surface ?? 'wood');
      next.y = ground.y;
      this.vel.y = 0;
      this.grounded = true;
      this.surface = ground.surface ?? 'wood';
    } else if (next.y > ground.y + 0.05) {
      if (this.grounded) this.fallStartY = this.pos.y;
      this.grounded = false;
    } else {
      next.y = ground.y; // snap down small steps
    }
    // horizontal collisions
    this.world.moveCylinder(next, BOO.radius, this.height, BOO.step);
    const prev = this.pos.clone();
    this.pos.copy(next);
    const moved = Math.hypot(this.pos.x - prev.x, this.pos.z - prev.z);
    this.speed = moved / Math.max(dt, 1e-4);
    if (this.grounded && moved > 0.0005) {
      this.stepDist += moved;
      const stride = this.sprinting ? 0.62 : this.crouched ? 0.38 : 0.48;
      if (this.stepDist > stride) {
        this.stepDist = 0;
        this.footstep();
      }
    }
    this.updateCamera(dt);
  }

  private tryCrouch(want: boolean) {
    if (want === this.crouched) return;
    if (!want) {
      // need headroom to stand
      const ceil = this.world.ceilingHeight(this.pos.x, this.pos.z, BOO.radius, this.pos.y + BOO.crouchHeight - 0.05);
      if (ceil < this.pos.y + BOO.height) return;
    }
    this.crouched = want;
    audio.play('sfx/cloth', { volume: 0.25 });
  }

  private tryMantle(auto = false): boolean {
    const fwd = this.forward();
    const probe = this.pos.clone().addScaledVector(fwd, BOO.radius + 0.28);
    const top = this.world.groundHeight(probe.x, probe.z, 0.12, this.pos.y + 1.45, 2);
    const rise = top.y - this.pos.y;
    if (rise < 0.35 || rise > 1.35) return false;
    if (top.collider && top.collider.climbable === false) return false;
    if (auto && rise > 1.1) return false;
    // headroom on top
    const ceil = this.world.ceilingHeight(probe.x, probe.z, BOO.radius * 0.8, top.y + 0.02);
    if (ceil - top.y < BOO.crouchHeight) return false;
    const to = new THREE.Vector3(probe.x, top.y, probe.z);
    // make sure the landing spot itself is free
    const test = to.clone();
    this.world.moveCylinder(test, BOO.radius * 0.9, BOO.crouchHeight, 0.05);
    if (test.distanceTo(to) > 0.2) return false;
    this.mantle = { from: this.pos.clone(), to: test, t: 0 };
    if (ceil - top.y < BOO.height) this.crouched = true;
    this.vel.set(0, 0, 0);
    audio.play('sfx/cloth', { volume: 0.4, rate: 1.2 });
    this.hooks.noise(this.pos, 1.2, 'step');
    return true;
  }

  private updateMantle(dt: number) {
    const m = this.mantle!;
    m.t += dt / 0.38;
    const t = Math.min(1, m.t);
    const e = t * t * (3 - 2 * t);
    this.pos.lerpVectors(m.from, m.to, e);
    // up first, then over
    this.pos.y = m.from.y + (m.to.y - m.from.y) * Math.min(1, e * 1.6);
    this.landDip = Math.sin(t * Math.PI) * 0.06;
    if (t >= 1) {
      this.mantle = null;
      this.grounded = true;
      this.surface = this.world.groundHeight(this.pos.x, this.pos.z, BOO.radius, this.pos.y, 0.1).surface ?? 'wood';
      this.footstep(0.6);
    }
  }

  private onLand(fall: number, surface: Surface) {
    if (fall > 0.45) {
      this.landDip = Math.min(0.18, fall * 0.12);
      const r = Math.min(9, STEP_NOISE[surface] * (0.6 + fall * 0.9));
      this.hooks.noise(this.pos, r, 'land');
      audio.play(STEP_SOUND[surface], { volume: Math.min(1, 0.4 + fall * 0.4), rate: 0.85 });
    }
  }

  private footstep(mult = 1) {
    const surf = this.surface;
    let r = STEP_NOISE[surf] * mult;
    if (this.sprinting) r *= 2.1;
    else if (this.crouched) r *= 0.3;
    // squeaky floorboards!
    const key = `${Math.round(this.pos.x * 2)},${Math.round(this.pos.z * 2)}`;
    if (this.pos.y < 0.05 && this.hooks.creakAt(this.pos.x, this.pos.z) && key !== this.lastCreak) {
      this.lastCreak = key;
      audio.play('sfx/creak', { volume: this.crouched ? 0.35 : 0.8, pos: this.pos });
      r = Math.max(r, this.crouched ? 2.5 : 6);
      this.hooks.noise(this.pos.clone(), r, 'creak');
    } else {
      this.hooks.noise(this.pos.clone(), r, 'step');
    }
    const vol = (this.sprinting ? 0.75 : this.crouched ? 0.22 : 0.45) * (surf === 'carpet' || surf === 'soft' ? 0.7 : 1);
    audio.play(STEP_SOUND[surf], { volume: vol, rate: this.crouched ? 1.15 : 1.05, vary: 0.1 });
  }

  updateCamera(dt: number) {
    const targetEye = this.crouched ? BOO.crouchEye : BOO.eye;
    this.eyeH += (targetEye - this.eyeH) * Math.min(1, dt * 10);
    const moving = this.grounded && this.speed > 0.3;
    this.bobAmt += ((moving && settings.headBob && !settings.reduceMotion ? 1 : 0) - this.bobAmt) * Math.min(1, dt * 6);
    this.bob += dt * (this.sprinting ? 13 : this.crouched ? 6 : 9.5) * (moving ? 1 : 0.3);
    const bobY = Math.sin(this.bob * 2) * 0.022 * this.bobAmt * (this.sprinting ? 1.6 : 1);
    const bobX = Math.cos(this.bob) * 0.012 * this.bobAmt;
    this.landDip *= Math.max(0, 1 - dt * 7);
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.camera.position.set(this.pos.x, this.pos.y + this.eyeH + bobY - this.landDip, this.pos.z).addScaledVector(right, bobX);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    // sprint FOV kick
    this.fovKick += ((this.sprinting && moving ? 6 : 0) - this.fovKick) * Math.min(1, dt * 5);
    const fov = settings.fov + (settings.reduceMotion ? 0 : this.fovKick);
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    // viewmodel sway
    this.castAnim = Math.max(0, this.castAnim - dt * 3);
    const c = Math.sin(this.castAnim * Math.PI);
    this.viewmodel.position.set(
      0.19 + bobX * 1.5 - this.input.mouseDX * 0.00008,
      -0.17 + bobY * 1.2 + c * 0.05 + this.input.mouseDY * 0.00008 - (this.crouched ? 0.01 : 0),
      -0.34 - c * 0.08,
    );
    this.hand.rotation.set(-c * 0.8, 0.15, -0.1);
    const tm = this.wandTip.material as THREE.MeshStandardMaterial;
    tm.emissive.copy(this.wandGlow);
    tm.emissiveIntensity = 3 + Math.sin(performance.now() * 0.006) * 1 + c * 6;
  }

  /** Line of sight from the eye toward a point (for interaction occlusion). */
  canSee(p: THREE.Vector3) {
    return this.world.lineClear(this.camera.position, p, F.SIGHT);
  }
}

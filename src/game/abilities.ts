// Boo magic, fuelled by ectoplasm: Fade (invisibility), Possess (become a
// jack-o'-lantern), Spirit Sight (look through a spooky decoration's eyes),
// Bump in the Night (a thrown will-o'-wisp that knocks to lure people away)
// and Snuff (blow out a light from across the room) — plus Slumber Mist,
// the non-lethal doze-off puff on the left mouse button.

import * as THREE from 'three';
import type { Game } from './game';
import { audio } from '../core/audio';
import type { SightToy } from './interact';
import { F } from '../world/physics';
import { possessPumpkin } from './interact';
import type { LightSource } from '../world/lights';

export type AbilityId = 'fade' | 'possess' | 'sight' | 'bump' | 'snuff';

export const ABILITIES: Record<AbilityId, { name: string; icon: string; color: string; desc: string; detail: string }> = {
  fade: {
    name: 'Fade',
    icon: '👻',
    color: '#bff6ff',
    desc: 'Turn fully see-through for 6 seconds.',
    detail: 'People can’t see you. Dogs can still smell you up close, cats can still see spirits, and you still make noise.',
  },
  possess: {
    name: 'Possess',
    icon: '🎃',
    color: '#ff9a3c',
    desc: 'Hop inside a jack-o’-lantern. Move to pop back out.',
    detail: 'Completely undetectable while still. Ectoplasm won’t recharge while you’re possessing.',
  },
  sight: {
    name: 'Spirit Sight',
    icon: '👁️',
    color: '#9dff7a',
    desc: 'See through the eyes of a spooky decoration (look at it and cast).',
    detail: 'Decorations are marked with green wisps. While watching, people show through walls and nearby clues glow. Press [F] to tag a person.',
  },
  bump: {
    name: 'Bump in the Night',
    icon: '🦇',
    color: '#c9a2ff',
    desc: 'Toss a will-o’-wisp that knocks and rattles to draw people away.',
    detail: 'Lands where you aim and starts knocking after a moment. Everyone nearby comes to investigate — cats chase it.',
  },
  snuff: {
    name: 'Snuff',
    icon: '🕯️',
    color: '#ffd36e',
    desc: 'Blow out any light you can see, from up to 12 m away.',
    detail: 'A ghostly gust puts out lamps, candles and lanterns without touching a switch. People still notice — and relight what they care about.',
  },
};

export class Abilities {
  maxCharges = 3;
  charges = 3;
  regen = 0;
  regenTime = 9;
  mist = 3;
  mistMax = 3;
  mistRegen = 0;
  mistTime = 6.5;
  active: AbilityId | null = null;
  activeTime = 0;
  private possessMesh: THREE.Object3D | null = null;
  private possessYaw = 0;
  private possessPitch = -0.3;
  sightToy: SightToy | null = null;
  private sightYaw = 0;
  private sightPitch = 0;
  private wisps: { mesh: THREE.Object3D; halo: THREE.Mesh; vel: THREE.Vector3; landed: boolean; t: number; knock: number }[] = [];
  private puffs: { pos: THREE.Vector3; vel: THREE.Vector3; t: number }[] = [];
  private gusts: { from: THREE.Vector3; to: THREE.Vector3; t: number; light: LightSource }[] = [];
  private savedCam: { pos: THREE.Vector3; yaw: number; pitch: number } | null = null;
  tagged = new Map<string, number>();
  flash = 0;

  constructor(private g: Game, public slots: [AbilityId, AbilityId]) {}

  keyFor(id: AbilityId): string | null {
    const i = this.slots.indexOf(id);
    return i < 0 ? null : String(i + 1);
  }

  addCharge() {
    this.charges = Math.min(this.maxCharges, this.charges + 1);
  }

  private spend() {
    if (this.charges <= 0) {
      audio.play('sfx/ui_error', { bus: 'ui', volume: 0.4 });
      this.g.toast('Out of ectoplasm — it recharges over time (or sneak a sweet from a candy bowl).', 'muted');
      return false;
    }
    this.charges--;
    this.g.stats.spells++;
    return true;
  }

  update(dt: number) {
    const g = this.g;
    const inp = g.input;
    // recharge (not while a sustained spell is active)
    if (this.charges < this.maxCharges && this.active !== 'possess' && this.active !== 'sight') {
      this.regen += dt;
      if (this.regen >= this.regenTime) {
        this.regen = 0;
        this.charges++;
        audio.chime(81, 3, 0.05, 0.08);
      }
    } else if (this.charges >= this.maxCharges) this.regen = 0;
    if (this.mist < this.mistMax) {
      this.mistRegen += dt;
      if (this.mistRegen >= this.mistTime) {
        this.mistRegen = 0;
        this.mist++;
      }
    }

    if (g.canAct()) {
      if (inp.wasPressed('Digit1')) this.cast(this.slots[0]);
      if (inp.wasPressed('Digit2')) this.cast(this.slots[1]);
      if (inp.wasPressed('Mouse0') && !g.carrying && !this.active) this.throwMist();
    }

    if (this.active === 'fade') {
      this.activeTime -= dt;
      g.renderer.stealth.set('uInvisible', Math.min(1, this.activeTime * 2, 1));
      if (Math.random() < dt * 30) g.fx.glitter.emit({ pos: g.player.chest.add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0, (Math.random() - 0.5) * 0.4)), vel: new THREE.Vector3(0, 0.3, 0), life: [0.5, 1], size: [0.02, 0.04], color: [0xbff6ff, 0xffffff, 0x9dff7a] });
      if (this.activeTime <= 0) this.endActive();
    } else if (this.active === 'possess') {
      this.updatePossess(dt);
    } else if (this.active === 'sight') {
      this.updateSight(dt);
    }
    this.updateWisps(dt);
    this.updatePuffs(dt);
    this.updateGusts(dt);
    for (const [k, v] of this.tagged) {
      if (v - dt <= 0) this.tagged.delete(k);
      else this.tagged.set(k, v - dt);
    }
  }

  cast(id: AbilityId) {
    const g = this.g;
    if (this.active) {
      // pressing again cancels sustained spells
      if (this.active === id && (id === 'possess' || id === 'sight')) this.endActive();
      return;
    }
    if (id === 'sight') {
      const toy = g.focusedSightToy();
      if (!toy) {
        g.toast('Look at a decoration marked with a green wisp to use Spirit Sight.', 'muted');
        audio.play('sfx/ui_error', { bus: 'ui', volume: 0.3 });
        return;
      }
      this.trySight(toy);
      return;
    }
    if (id === 'snuff') {
      const l = this.focusedLight();
      if (!l) {
        g.toast('Look at a lit lamp, candle or lantern to snuff it out.', 'muted');
        audio.play('sfx/ui_error', { bus: 'ui', volume: 0.3 });
        return;
      }
      if (!this.spend()) return;
      g.player.cast();
      this.gusts.push({ from: g.player.eyePos.clone().addScaledVector(g.player.lookDir(), 0.3), to: l.pos.clone(), t: 0, light: l });
      audio.whoosh(1.3, true, 0.22);
      g.hud.flashSlot(this.slots.indexOf(id));
      return;
    }
    if (!this.spend()) return;
    g.player.cast();
    if (id === 'fade') {
      this.active = 'fade';
      this.activeTime = 6;
      audio.whoosh(0.9, true, 0.3);
      audio.chime(76, 6, 0.06, 0.12);
      g.fx.burst(g.player.chest, [0xbff6ff, 0xffffff, 0x9dff7a], 40, 2);
      g.player.wandGlow.set(0xbff6ff);
    } else if (id === 'possess') {
      this.active = 'possess';
      this.activeTime = 0;
      audio.whoosh(0.6, false, 0.3);
      audio.chime(69, 4, 0.08, 0.12);
      g.fx.smoke.emit({ pos: g.player.chest, count: 14, posJitter: 0.4, spread: 0.8, life: [0.8, 1.4], size: [0.3, 0.5], endSize: 2, color: 0xd8c8ff, alpha: 0.6 });
      g.fx.burst(g.player.chest, [0xff9a3c, 0xffd36e, 0xffffff], 30, 1.6);
      const m = possessPumpkin();
      m.scale.setScalar(1.7);
      m.position.copy(g.player.pos);
      m.rotation.y = g.player.yaw + Math.PI;
      g.scene.add(m);
      this.possessMesh = m;
      this.possessYaw = g.player.yaw;
      this.possessPitch = -0.25;
      this.savedCam = { pos: g.player.pos.clone(), yaw: g.player.yaw, pitch: g.player.pitch };
      g.player.viewmodel.visible = false;
      g.player.frozen = true;
      g.renderer.stealth.set('uMorph', 1);
    } else if (id === 'bump') {
      this.throwWisp();
    }
    g.hud.flashSlot(this.slots.indexOf(id));
  }

  /** The lit light closest to the crosshair, if any, within snuffing range and in plain view. */
  focusedLight(): LightSource | null {
    const g = this.g;
    const cam = g.player.camera.position;
    const dir = g.player.lookDir();
    let best: LightSource | null = null;
    let bestScore = Infinity;
    for (const l of g.level.lights) {
      if (!l.isLit() || l.def.kind === 'fire' || l.def.kind === 'tv' || l.def.kind === 'fridge') continue;
      const to = l.pos.clone().sub(cam);
      const d = to.length();
      if (d > 12) continue;
      const dot = to.normalize().dot(dir);
      if (dot < 0.975 - 0.12 / Math.max(1, d)) continue;
      if (!g.world.lineClear(cam, l.pos, F.SIGHT) && d > 1.5) continue;
      const score = (1 - dot) * 40 + d * 0.1;
      if (score < bestScore) { bestScore = score; best = l; }
    }
    return best;
  }

  trySight(toy: SightToy) {
    const g = this.g;
    if (this.active) return;
    if (!this.keyFor('sight')) return;
    if (!g.world.lineClear(g.player.eyePos, toy.pos, F.SIGHT) && toy.pos.distanceTo(g.player.eyePos) > 2) {
      g.toast('You need a clear line of sight to the decoration.', 'muted');
      return;
    }
    if (!this.spend()) return;
    g.player.cast();
    this.active = 'sight';
    this.sightToy = toy;
    this.sightYaw = toy.yaw;
    this.sightPitch = -0.1;
    this.savedCam = { pos: g.player.pos.clone(), yaw: g.player.yaw, pitch: g.player.pitch };
    g.player.frozen = true;
    g.player.viewmodel.visible = false;
    audio.whoosh(1.1, true, 0.28);
    audio.chime(74, 5, 0.1, 0.14);
    g.fx.burst(toy.pos.clone(), [0x9dff7a, 0xbff6ff], 30, 1.2);
    g.renderer.stealth.set('uSight', 1);
    g.hud.flashSlot(this.slots.indexOf('sight'));
  }

  private updatePossess(dt: number) {
    const g = this.g;
    const inp = g.input;
    this.possessYaw -= inp.mouseDX * 0.003;
    this.possessPitch = THREE.MathUtils.clamp(this.possessPitch - inp.mouseDY * 0.003, -1.2, 0.3);
    const cam = g.player.camera;
    const center = g.player.pos.clone().setY(g.player.pos.y + 0.4);
    const off = new THREE.Vector3(Math.sin(this.possessYaw) * Math.cos(this.possessPitch), -Math.sin(this.possessPitch), Math.cos(this.possessYaw) * Math.cos(this.possessPitch)).multiplyScalar(1.6);
    const dir = off.clone().normalize();
    const hit = g.world.raycast(center, dir, 1.6, F.CAMERA);
    const dist = hit ? Math.max(0.3, hit.dist - 0.1) : 1.6;
    cam.position.copy(center).addScaledVector(dir, dist);
    cam.lookAt(center);
    // the possessed pumpkin's candle breathes
    if (this.possessMesh) {
      const glow = this.possessMesh.userData.glow as THREE.MeshStandardMaterial | undefined;
      if (glow) glow.emissiveIntensity = 2.6 + Math.sin(g.time * 9) * 0.5 + Math.sin(g.time * 23) * 0.3;
    }
    if (g.input.anyPressed('KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space')) this.endActive();
    void dt;
  }

  private updateSight(dt: number) {
    const g = this.g;
    const toy = this.sightToy!;
    const inp = g.input;
    this.sightYaw -= inp.mouseDX * 0.0022;
    this.sightPitch = THREE.MathUtils.clamp(this.sightPitch - inp.mouseDY * 0.0022, -1.2, 1.0);
    const cam = g.player.camera;
    cam.position.copy(toy.eye);
    cam.rotation.set(this.sightPitch, this.sightYaw, 0);
    if (inp.wasPressed('KeyF')) {
      const fwd = new THREE.Vector3();
      cam.getWorldDirection(fwd);
      let best: { id: string; d: number } | null = null;
      for (const n of g.npcs) {
        const to = n.body.headWorld().sub(cam.position);
        const d = to.length();
        const dot = to.normalize().dot(fwd);
        if (dot > 0.96 && (!best || d < best.d)) best = { id: n.def.id, d };
      }
      if (best) {
        this.tagged.set(best.id, 45);
        audio.play('sfx/pluck', { bus: 'ui', volume: 0.6 });
        g.toast(`Tagged ${g.npcs.find((n) => n.def.id === best!.id)!.name} — visible through walls for 45s.`);
      }
    }
    if (Math.random() < dt * 6) g.revealCluesNear(toy.pos, 7);
    if (g.input.anyPressed('KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'Escape')) this.endActive();
  }

  endActive() {
    const g = this.g;
    const was = this.active;
    this.active = null;
    g.player.wandGlow.set(0x9dff7a);
    if (was === 'fade') {
      g.renderer.stealth.set('uInvisible', 0);
      audio.whoosh(0.5, false, 0.18);
    } else if (was === 'possess') {
      if (this.possessMesh) {
        g.fx.smoke.emit({ pos: this.possessMesh.position.clone().setY(0.4), count: 10, posJitter: 0.3, spread: 0.6, life: [0.6, 1.1], size: [0.3, 0.45], endSize: 2, color: 0xd8c8ff, alpha: 0.6 });
        g.fx.burst(this.possessMesh.position.clone().setY(0.4), [0xff9a3c, 0xffd36e], 18, 1.2);
        g.scene.remove(this.possessMesh);
      }
      this.possessMesh = null;
      g.renderer.stealth.set('uMorph', 0);
      audio.whoosh(0.4, true, 0.2);
      g.player.frozen = false;
      g.player.viewmodel.visible = true;
    } else if (was === 'sight') {
      g.renderer.stealth.set('uSight', 0);
      audio.whoosh(0.6, false, 0.2);
      g.player.frozen = false;
      g.player.viewmodel.visible = true;
      this.sightToy = null;
    }
    if (this.savedCam && (was === 'possess' || was === 'sight')) {
      g.player.yaw = this.savedCam.yaw;
      g.player.pitch = this.savedCam.pitch;
      g.player.updateCamera(0);
    }
    this.savedCam = null;
    g.input.clear();
  }

  // ---------------------------------------------------------------- slumber mist

  private throwMist() {
    const g = this.g;
    if (this.mist <= 0) {
      audio.play('sfx/ui_error', { bus: 'ui', volume: 0.3 });
      return;
    }
    this.mist--;
    g.stats.mist++;
    g.player.cast();
    const dir = g.player.lookDir();
    const from = g.player.eyePos.clone().addScaledVector(dir, 0.3).add(new THREE.Vector3(0, -0.1, 0));
    this.puffs.push({ pos: from, vel: dir.multiplyScalar(11), t: 0 });
    audio.whoosh(0.7, true, 0.14);
    audio.chime(86, 4, 0.04, 0.07);
  }

  private updatePuffs(dt: number) {
    const g = this.g;
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const d = this.puffs[i];
      d.t += dt;
      const step = d.vel.clone().multiplyScalar(dt);
      const len = step.length();
      const hit = g.world.raycast(d.pos, step.clone().normalize(), len, F.MOVE);
      let hitNpc = null as import('./npc').NPC | null;
      for (const n of g.npcs) {
        const c = n.pos.clone().setY(n.body.height * 0.6);
        if (c.distanceTo(d.pos) < 0.55 + n.body.height * 0.25) hitNpc = n;
      }
      g.fx.mist.emit({ pos: d.pos, count: 2, posJitter: 0.08, vel: d.vel.clone().multiplyScalar(0.05), spread: 0.3, life: [0.3, 0.6], size: [0.06, 0.12], endSize: 0.3, color: [0xc9a2ff, 0x9dff7a, 0xbff6ff, 0xffffff], spin: 6 });
      if (hitNpc || hit || d.t > 0.9) {
        const at = hit ? hit.point : d.pos.clone();
        this.cloud(at, hitNpc);
        this.puffs.splice(i, 1);
        continue;
      }
      d.pos.add(step);
    }
  }

  private cloud(at: THREE.Vector3, npc: import('./npc').NPC | null) {
    const g = this.g;
    g.fx.burst(at, [0xc9a2ff, 0x9dff7a, 0xbff6ff, 0xffffff], 50, 2.2);
    g.fx.smoke.emit({ pos: at, count: 18, posJitter: 0.6, spread: 0.4, life: [3.5, 5], size: [0.5, 0.9], endSize: 2.2, color: [0xd9c6ff, 0xc8f5e0, 0xe6dcff], alpha: 0.5, spin: 0.4 });
    audio.play('sfx/sparkle', { pos: at, volume: 0.5, rate: 0.7 });
    g.addMistCloud(at.clone().setY(0), 5.5);
    if (npc) {
      npc.stunFor(npc.isPet ? 9 : 7);
      g.stats.misted++;
      g.onNpcMisted(npc);
    } else {
      // anyone standing in the cloud gets drowsy too
      for (const n of g.npcs) if (n.pos.distanceTo(at) < 1.3) { n.stunFor(5); g.stats.misted++; }
    }
  }

  // ---------------------------------------------------------------- snuff

  private updateGusts(dt: number) {
    const g = this.g;
    for (let i = this.gusts.length - 1; i >= 0; i--) {
      const s = this.gusts[i];
      s.t += dt * 2.6;
      const p = s.from.clone().lerp(s.to, Math.min(1, s.t));
      p.y += Math.sin(s.t * Math.PI) * 0.25;
      g.fx.mist.emit({ pos: p, count: 3, posJitter: 0.12, spread: 0.2, life: [0.4, 0.8], size: [0.05, 0.1], endSize: 0.5, color: [0xffffff, 0xbff6ff], alpha: 0.7, spin: 4 });
      if (s.t >= 1) {
        const l = s.light;
        if (l.isLit()) {
          l.toggle(false);
          l.motionTimer = 0;
          g.stats.lightsOut++;
          g.flags.add('lamp');
        }
        g.fx.smoke.emit({ pos: l.pos.clone(), count: 6, posJitter: 0.1, vel: new THREE.Vector3(0, 0.4, 0), spread: 0.15, life: [1.2, 2], size: [0.08, 0.14], endSize: 4, color: 0x9a9aa8, alpha: 0.5, spin: 0.8 });
        audio.whoosh(0.35, false, 0.16, l.pos);
        g.noise(l.pos.clone(), 1.2, 'switch', true);
        this.gusts.splice(i, 1);
      }
    }
  }

  // ---------------------------------------------------------------- bump in the night

  private throwWisp() {
    const g = this.g;
    const wisp = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 10), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x9dff7a, emissiveIntensity: 4 }));
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 10), new THREE.MeshBasicMaterial({ color: 0x9dff7a, transparent: true, opacity: 0.18, depthWrite: false }));
    // no PointLight here: adding lights at runtime would recompile every material
    wisp.add(core, halo);
    const dir = g.player.lookDir();
    wisp.position.copy(g.player.eyePos).addScaledVector(dir, 0.3);
    g.scene.add(wisp);
    this.wisps.push({ mesh: wisp, halo, vel: dir.multiplyScalar(8).add(new THREE.Vector3(0, 2.2, 0)), landed: false, t: 0, knock: 0 });
    audio.whoosh(0.4, true, 0.15);
  }

  private updateWisps(dt: number) {
    const g = this.g;
    for (let i = this.wisps.length - 1; i >= 0; i--) {
      const b = this.wisps[i];
      b.t += dt;
      if (Math.random() < dt * 25) g.fx.glitter.emit({ pos: b.mesh.position, posJitter: 0.05, vel: new THREE.Vector3(0, 0.25, 0), life: [0.4, 0.8], size: [0.02, 0.04], color: [0x9dff7a, 0xbff6ff] });
      if (!b.landed) {
        b.vel.y -= 9.8 * dt;
        const step = b.vel.clone().multiplyScalar(dt);
        const hit = g.world.raycast(b.mesh.position, step.clone().normalize(), step.length() + 0.05, F.MOVE);
        if (hit || b.mesh.position.y + step.y < 0.05) {
          if (hit && hit.normal.y < 0.5) {
            b.vel.reflect(hit.normal).multiplyScalar(0.3);
            continue;
          }
          b.landed = true;
          b.t = 0;
          if (hit) b.mesh.position.copy(hit.point).add(new THREE.Vector3(0, 0.08, 0));
          else b.mesh.position.y = 0.08;
          audio.play('sfx/soft', { pos: b.mesh.position, volume: 0.3 });
        } else b.mesh.position.add(step);
      } else {
        // hover, then knock & rattle for 4.5 s
        b.mesh.position.y += Math.sin(b.t * 3) * 0.0015;
        if (b.t > 0.8 && b.t < 5.3) {
          b.knock -= dt;
          b.mesh.scale.setScalar(1 + Math.max(0, b.knock - 0.9) * 2);
          if (b.knock <= 0) {
            b.knock = 1.1;
            audio.knock(b.mesh.position, 0.8);
            g.noise(b.mesh.position.clone(), 10, 'knock', false);
            g.fx.sparkle.emit({ pos: b.mesh.position, count: 10, spread: 1, life: [0.4, 0.9], size: [0.04, 0.08], color: [0x9dff7a, 0xc9a2ff, 0xffffff], gravity: 0.5 });
          }
        }
        (b.halo.material as THREE.MeshBasicMaterial).opacity = 0.18 + Math.sin(b.t * 12) * 0.08;
        if (b.t > 6) {
          g.fx.burst(b.mesh.position, [0x9dff7a, 0xffffff], 20, 1);
          g.scene.remove(b.mesh);
          this.wisps.splice(i, 1);
        }
      }
    }
  }
}

// The slice of the Game that NPCs / interactables / abilities talk to.

import type * as THREE from 'three';
import type { Level } from '../world/level';
import type { PhysicsWorld } from '../world/physics';
import type { NavGrid } from '../world/nav';
import type { FX } from '../fx/particles';
import type { Player } from './player';
import type { NPC } from './npc';
import type { NoiseKind } from './events';

export interface PlayerState {
  invisible: boolean;
  morphed: boolean;
  hiddenSpot: boolean;
  inBox: boolean;
  inCloud: boolean;
  sight: boolean;
}

export interface Disturbed {
  pos: THREE.Vector3;
  kind: 'broken' | 'moved';
  /** called when an NPC tidies it up */
  fix: () => void;
}

export interface GameCtx {
  scene: THREE.Scene;
  level: Level;
  world: PhysicsWorld;
  nav: NavGrid;
  fx: FX;
  player: Player;
  /** 0..1 how visible the Boo is right now (light, stance, motion, magic) */
  playerVis: number;
  /** visibility ignoring Fade (cats see spirits) */
  playerVisSpirit: number;
  playerState: PlayerState;
  showCones: boolean;
  time: number;
  npcs: NPC[];
  noise(pos: THREE.Vector3, radius: number, kind: NoiseKind, byPlayer?: boolean, source?: string): void;
  sound(name: string, pos: THREE.Vector3, volume?: number): void;
  subtitle(npc: NPC | { name: string; pos?: THREE.Vector3 }, text: string, seconds?: number): void;
  onSpotted(npc: NPC): void;
  onCaught(npc: NPC): void;
  fixThing(npc: NPC, f: { kind: string; ref: unknown; pos: THREE.Vector3 }): void;
  disturbed(): Disturbed[];
  groundAt(p: THREE.Vector3): number;
}

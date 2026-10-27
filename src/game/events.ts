// Tiny typed event bus + noise events used by the AI's hearing.

import type * as THREE from 'three';

export type NoiseKind = 'step' | 'land' | 'impact' | 'shatter' | 'door' | 'switch' | 'bark' | 'hiss' | 'knock' | 'creak' | 'voice' | 'search' | 'beep' | 'eat';

export interface Noise {
  pos: THREE.Vector3;
  radius: number;
  kind: NoiseKind;
  byPlayer: boolean;
  /** world time it happened */
  t: number;
  /** NPC id that produced it (barks) */
  source?: string;
}

type Handler<T> = (e: T) => void;

export class Emitter<Events extends Record<string, unknown>> {
  private h = new Map<keyof Events, Set<Handler<any>>>();
  on<K extends keyof Events>(k: K, f: Handler<Events[K]>) {
    let s = this.h.get(k);
    if (!s) this.h.set(k, (s = new Set()));
    s.add(f);
    return () => s!.delete(f);
  }
  emit<K extends keyof Events>(k: K, e: Events[K]) {
    this.h.get(k)?.forEach((f) => f(e));
  }
  clear() { this.h.clear(); }
}

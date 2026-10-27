// Developer viewer: renders a level from a fixed camera (used for screenshots).
import * as THREE from 'three';
import { Renderer } from '../core/renderer';
import { Level } from '../world/level';
import { LEVELS } from '../levels';

export async function runViewer() {
  const params = new URLSearchParams(location.hash.slice(1).split('?')[1] ?? '');
  const id = params.get('level') ?? 'johnson';
  const def = LEVELS.find((l) => l.id === id)!;
  const q = params.get('q');
  if (q) (await import('../core/settings')).updateSettings({ quality: q as any });
  const r = new Renderer(document.getElementById('app')!);
  const level = new Level(def);
  await level.load(r.shadowMapSize);
  const cam = new THREE.PerspectiveCamera(75, 1, 0.05, 200);
  const [x, y, z, tx, ty, tz] = (params.get('cam') ?? '3.5,1.5,5,3.5,0.8,0').split(',').map(Number);
  cam.position.set(x, y, z);
  cam.lookAt(tx, ty, tz);
  r.setScene(level.scene, cam);
  let t = 0;
  let frames = Number(params.get('frames') ?? 1e9);
  const loop = () => {
    t += 1 / 60;
    level.update(1 / 60, t, cam.position);
    r.render(1 / 60);
    if (--frames > 0) requestAnimationFrame(loop);
    else (window as any).__done = true;
  };
  loop();
  (window as any).__ready = true;
}

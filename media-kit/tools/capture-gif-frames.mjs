// Usage: node media-kit/tools/capture-gif-frames.mjs <orbit|sneak> [frames]  (with `npm run dev` running), then:
//   ffmpeg -framerate 10 -i media-kit/tools/.frames/sneak/%03d.png -vf "scale=560:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160[p];[b][p]paletteuse=dither=bayer" media-kit/gif/sneaking.gif
// Captures frame sequences for GIFs by stepping the app manually (deterministic, GPU-free).
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import fs from 'fs';
const D = fileURLToPath(new URL('./.frames', import.meta.url));
const which = process.argv[2];
fs.mkdirSync(`${D}/${which}`, { recursive: true });
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 800, height: 450 } });
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto('http://localhost:5173/?throttle=100000000');
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('boo.settings.v1', JSON.stringify({ quality: 'medium' })); });
await p.reload();
await p.waitForFunction(() => document.querySelector('.title-screen'), null, { timeout: 240000 });
const step = (dt) => p.evaluate((dt) => { const a = window.__app; a.last = performance.now() - dt * 1000; a.frame(); a.input.endFrame(); }, dt);
const N = Number(process.argv[3] ?? 48);
if (which === 'orbit') {
  await p.evaluate(() => { document.querySelector('.ui').style.visibility = 'hidden'; document.querySelector('.leaffall').style.display = 'none'; window.__app.menuT = -16; });
  for (let i = 0; i < N; i++) {
    await p.evaluate(() => { window.__app.menuT += 0.9; });
    await step(1 / 12);
    await p.screenshot({ path: `${D}/${which}/${String(i).padStart(3, '0')}.png`, timeout: 120000 });
  }
} else if (which === 'sneak') {
  await p.evaluate(() => { window.__app.loadout = ['fade', 'snuff']; window.__app.startMission(window.__LEVELS[1]); });
  await p.waitForFunction(() => window.__app.screen === 'play', null, { timeout: 240000 });
  await p.evaluate(() => {
    const g = window.__app.game, inp = window.__app.input; inp.allowUnlocked = true; g.intro = 0; g.renderer.stealth.set('uFade', 0);
    g.end = function () {};
    document.querySelector('.click-to-play')?.remove();
    for (const n of g.npcs) n.perceive = function () { return (this.seeing = 0); };
    for (let i = 0; i < 300; i++) { g.update(0.05); inp.endFrame(); }
    g.player.crouched = true;
    // camera path: hearth -> past the sofa -> pumpkins -> hallway door
    const P = [[3.5, 1.6], [4.6, 2.0], [5.4, 3.2], [5.1, 4.6], [4.3, 5.5], [4.2, 6.6]];
    const L = [[3.5, 6.0], [6.2, 5.0], [6.2, 5.0], [6.2, 5.0], [4.2, 8.0], [3.0, 10.5]];
    window.__path = (t) => {
      const f = t * (P.length - 1), i = Math.min(P.length - 2, Math.floor(f)), u = f - i, e = u * u * (3 - 2 * u);
      const px = P[i][0] + (P[i + 1][0] - P[i][0]) * e, pz = P[i][1] + (P[i + 1][1] - P[i][1]) * e;
      const lx = L[i][0] + (L[i + 1][0] - L[i][0]) * e, lz = L[i][1] + (L[i + 1][1] - L[i][1]) * e;
      g.player.pos.set(px, 0, pz); g.player.speed = 1.2;
      g.player.yaw = Math.atan2(-(lx - px), -(lz - pz)); g.player.pitch = 0.05;
    };
  });
  for (let i = 0; i < N; i++) {
    await p.evaluate(([i, N]) => {
      const g = window.__app.game;
      window.__path(i / (N - 1));
      if (i === Math.floor(N * 0.55)) g.abilities.cast('fade');
      if (i === Math.floor(N * 0.3)) g.fx.burst(new window.__THREE.Vector3(6.2, 1.2, 5.0), [0x9dff7a, 0xc9a2ff, 0xffb050], 30, 1.5);
    }, [i, N]);
    await step(1 / 12);
    await p.screenshot({ path: `${D}/${which}/${String(i).padStart(3, '0')}.png`, timeout: 120000 });
  }
}
await b.close();
console.log('frames done', which);

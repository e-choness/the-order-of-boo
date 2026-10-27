// Application shell: boot, title diorama, menus, briefing & loadout, the
// mission loop, journal/pause, report form and results.

import * as THREE from 'three';
import { Renderer } from '../core/renderer';
import { Input } from '../core/input';
import { initAudio, audio } from '../core/audio';
import { settings, updateSettings, defaultSettings, type Settings } from '../core/settings';
import { save, recordMission } from '../core/save';
import { LEVELS } from '../levels';
import type { LevelDef, ClueDef, Ledger } from '../levels/types';
import { Level } from '../world/level';
import { Game, type MissionResult } from '../game/game';
import { ABILITIES, type AbilityId } from '../game/abilities';
import { HudView } from './hud';
import { Overlays } from './overlays';
import { h, esc, kbd, leafOverlay, CATEGORY_ICON, CATEGORY_NAME } from './dom';

const TIPS = [
  'Rugs and carpets muffle your sheet-swishing. Kitchen tiles do not.',
  'The moon at the bottom of your screen is your glow gauge — the dimmer it is, the harder you are to see.',
  'Snuff a candle to make a pool of shadow… but someone may notice and light it again.',
  'A puff of Slumber Mist hides you as well as sending people off to dreamland.',
  'Doors block sight. Close one behind you and you buy yourself a moment.',
  'Squeaky floorboards are loud — even for a ghost. Crouch to soften them.',
  'Pets can talk to Boos. Make sure no human is watching first.',
  'Dogs can smell you while you Fade. Cats can SEE you. Bring treats.',
  'Candy bowls restore ectoplasm. The sign says “take ONE”. Ghosts can’t read. Officially.',
  'Old evidence can lie. Check the dates and the handwriting.',
  'Thrown things make noise where they land. Potions make a LOT of noise.',
  'Press Space to clamber onto furniture. Boos are surprisingly bouncy.',
  'Motion-sensor skeletons only see you while you move. Freeze!',
  'People notice what’s out of place. Tidy ghosts are quiet ghosts.',
];

type Screen = 'title' | 'missions' | 'briefing' | 'loading' | 'play' | 'pause' | 'report' | 'results' | 'settings' | 'manual' | 'credits';

export class App {
  renderer: Renderer;
  input: Input;
  hud: HudView;
  overlays: Overlays;
  private ui: HTMLElement;
  private screenEl: HTMLElement | null = null;
  screen: Screen = 'title';
  game: Game | null = null;
  private menuLevel: Level | null = null;
  private menuCam = new THREE.PerspectiveCamera(50, 1, 0.1, 300);
  private last = performance.now();
  private menuT = 0;
  private leaves: HTMLElement;
  private loadout: AbilityId[] = ['fade', 'sight'];
  private clickToPlay: HTMLElement | null = null;
  private fadeEl: HTMLElement;

  constructor(root: HTMLElement) {
    this.renderer = new Renderer(root);
    this.input = new Input(this.renderer.canvas);
    initAudio();
    this.hud = new HudView(root);
    this.overlays = new Overlays(root, this.input);
    this.hud.show(false);
    this.ui = h('div', { class: 'layer ui' });
    root.append(this.ui);
    this.leaves = leafOverlay();
    root.append(this.leaves);
    this.fadeEl = h('div', { class: 'fade-black' });
    root.append(this.fadeEl);
    this.input.onLockChange = (locked) => this.onLockChange(locked);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.game && this.screen === 'play' && !this.game.ended) this.openPause();
    });
    if (matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches) {
      root.append(h('div', { class: 'toast glass', style: 'position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:20;max-width:90vw' }, 'The Order of B.O.O. is played with a keyboard and mouse — float over to a computer for the full haunt!'));
    }
    try {
      const l = JSON.parse(localStorage.getItem('boo.loadout') ?? 'null');
      if (Array.isArray(l) && l.length === 2 && l.every((x) => x in ABILITIES)) this.loadout = l;
    } catch { /* ignore */ }
    // Hovering buttons makes a soft tick
    document.addEventListener('pointerover', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('.btn, .mission, .ability, .wish, .ledger, .tab')) audio.ui('hover');
    });
    requestAnimationFrame(() => this.loop());
  }

  async boot() {
    this.showLoading('Lighting the jack-o’-lanterns…', 0.05);
    const audioP = audio.loadAll();
    this.menuLevel = new Level(LEVELS.find((l) => l.id === 'hollowell') ?? LEVELS[0]);
    await this.menuLevel.load(this.renderer.shadowMapSize, (p) => this.setLoading(0.1 + p * 0.8, 'Hanging the cobwebs…'));
    await audioP;
    this.renderer.setScene(this.menuLevel.scene, this.menuCam);
    this.showTitle();
  }

  // ---------------------------------------------------------------- frame loop

  /** test hook: ?throttle=ms limits the frame rate (headless screenshots) */
  private throttle = Number(new URLSearchParams(location.search).get('throttle') ?? 0);
  private lastRun = 0;

  private loop() {
    requestAnimationFrame(() => this.loop());
    if (this.throttle) {
      const now = performance.now();
      if (now - this.lastRun < this.throttle) return;
      this.lastRun = now;
    }
    try {
      this.frame();
    } catch (e) {
      console.error(e);
      this.input.endFrame();
    }
  }

  private frame() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.game && (this.screen === 'play')) {
      this.overlays.update(dt);
      this.game.update(dt);
      this.renderer.render(dt);
    } else if (this.game && (this.screen === 'pause' || this.screen === 'report' || this.screen === 'results' || this.screen === 'settings' || this.screen === 'manual')) {
      this.renderer.render(dt * 0.0);
    } else if (this.menuLevel && this.menuLevel.env) {
      this.menuT += dt;
      const t = this.menuT * 0.05;
      const [x0, z0, x1, z1] = this.menuLevel.def.bounds;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      this.menuCam.position.set(cx + Math.sin(t) * 19, 4.2 + Math.sin(t * 0.7) * 0.8, cz + Math.cos(t) * 19);
      this.menuCam.lookAt(cx - 2, 1.6, cz);
      this.menuLevel.update(dt, this.menuT, this.menuCam.position);
      this.renderer.render(dt);
    }
    this.input.endFrame();
  }

  private onLockChange(locked: boolean) {
    if (!this.game || this.screen !== 'play') return;
    if (!locked) {
      if (this.overlays.isModalOpen()) this.overlays.forceClose();
      if (!this.game.ended) this.openPause();
    }
  }

  // ---------------------------------------------------------------- screens

  private setScreen(s: Screen, el: HTMLElement | null) {
    this.screen = s;
    this.screenEl?.remove();
    this.screenEl = el;
    if (el) this.ui.append(el);
    this.leaves.classList.toggle('hidden', !['title', 'missions', 'briefing', 'credits', 'manual', 'loading'].includes(s) || (s === 'settings' && !!this.game));
  }

  private showLoading(label: string, p: number) {
    const tip = TIPS[(Math.random() * TIPS.length) | 0];
    const el = h('div', { class: 'screen loading' });
    el.innerHTML = `<div>
      <div class="spinner-pumpkin"><div class="pk"><i></i><i></i><b></b></div>${Array.from({ length: 8 }, (_, i) => `<span style="--a:${i * 45}deg"></span>`).join('')}</div>
      <h2 class="ld-label">${esc(label)}</h2>
      <div class="bar"><span style="width:${p * 100}%"></span></div>
      <p class="tip">“${esc(tip)}”</p></div>`;
    this.setScreen('loading', el);
  }

  private setLoading(p: number, label?: string) {
    const el = this.screenEl;
    if (!el || this.screen !== 'loading') return;
    (el.querySelector('.bar span') as HTMLElement).style.width = `${Math.round(p * 100)}%`;
    if (label) (el.querySelector('.ld-label') as HTMLElement).textContent = label;
  }

  showTitle() {
    audio.music.play('funeralMarch');
    this.renderer.stealth.set('uFade', 0);
    const el = h('div', { class: 'screen title-screen' });
    el.innerHTML = `
      <div>
        <div class="logo">
          <div class="the">The Order of</div>
          <div class="boo">B.O.O.</div>
          <div class="tagline"><b>B</b>oos <b>O</b>bserving <b>O</b>minously</div>
        </div>
        <div class="menu">
          <button class="btn primary" data-a="play"><span class="ico">🎃</span>${this.playLabel()}</button>
          <button class="btn" data-a="missions"><span class="ico">🗺️</span>Missions</button>
          <button class="btn" data-a="manual"><span class="ico">📖</span>Field Manual</button>
          <button class="btn" data-a="settings"><span class="ico">⚙️</span>Settings</button>
          <button class="btn ghost" data-a="credits"><span class="ico">🦇</span>Credits</button>
        </div>
      </div>
      <div></div>
      <div class="title-foot">A Halloween immersive sim · Art: Kenney (CC0) + procedural · Non-commercial licence</div>
      <div class="title-hint">Best with headphones 🎧<br/>Mouse + keyboard</div>`;
    el.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest('[data-a]')?.getAttribute('data-a');
      if (!a) return;
      audio.ui('click');
      if (a === 'play') { const n = this.nextMission(); if (n) this.showBriefing(n); else this.showMissions(); }
      if (a === 'missions') this.showMissions();
      if (a === 'manual') this.showManual(() => this.showTitle());
      if (a === 'settings') this.showSettings(() => this.showTitle());
      if (a === 'credits') this.showCredits();
    });
    this.setScreen('title', el);
  }

  private playLabel() {
    const next = this.nextMission();
    if (!Object.keys(save.missions).length) return 'Begin ghost school';
    return next ? `Continue: ${esc(next.title)}` : 'Replay a mission';
  }

  private nextMission(): LevelDef | null {
    for (const l of LEVELS) if (!save.missions[l.id]?.completed) return l;
    return null;
  }

  private unlocked(l: LevelDef) {
    const i = LEVELS.indexOf(l);
    // the tutorial and the first real house are always open
    return i <= 1 || !!save.missions[LEVELS[i - 1].id]?.completed;
  }

  showMissions() {
    const el = h('div', { class: 'screen' });
    const page = h('div', { class: 'page glass' });
    const arts = ['#2c3a2a,#0b120c', '#5a2a5a,#140a18', '#7a3a14,#1a0e08', '#2a2f4a,#0b0c18', '#5a3a7a,#120c1c'];
    page.innerHTML = `
      <div class="page-head"><div><div class="eyebrow">Hollow Hill Dispatch</div><h2>Hauntings for Halloween Night</h2></div>
      <button class="btn" data-a="back">← Back</button></div>
      <div class="mission-grid">${LEVELS.map((l, i) => {
        const rec = save.missions[l.id];
        const lock = !this.unlocked(l);
        const stars = rec?.bestRank ?? 0;
        return `<button class="mission ${lock ? 'locked' : ''}" data-id="${l.id}" ${lock ? 'disabled' : ''}>
          <div class="art" style="background: radial-gradient(ellipse at 50% 120%, rgba(255,140,40,.35), transparent 60%), linear-gradient(180deg, ${arts[i % arts.length]})">
            ${houseSvg(i)}
          </div>
          <div class="body">
            <span class="eyebrow">${i === 0 ? 'Ghost School' : `Haunting ${l.index}`}</span>
            <h3>${esc(l.title)}</h3>
            <p>${esc(l.child.name)}, ${l.child.age} · ${esc(l.subtitle)}</p>
            <div class="meta"><span class="stars">${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}</span>
            ${rec?.bestEnding ? `<span class="badge ${rec.bestEnding === 'promotion' ? 'gold' : rec.bestEnding === 'recognition' ? 'green' : 'red'}">${rec.bestEnding}</span>` : ''}
            ${rec?.ghost ? '<span class="badge">🌫️ unseen</span>' : ''}
            <span>⏱ ${l.minutes} min</span></div>
          </div></button>`;
      }).join('')}</div>`;
    page.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-a="back"]')) { audio.ui('back'); this.showTitle(); return; }
      const id = t.closest('.mission')?.getAttribute('data-id');
      const l = LEVELS.find((x) => x.id === id);
      if (l && this.unlocked(l)) { audio.ui('click'); this.showBriefing(l); }
    });
    el.append(page);
    this.setScreen('missions', el);
  }

  showBriefing(l: LevelDef) {
    audio.music.play('toccata');
    const el = h('div', { class: 'screen' });
    const page = h('div', { class: 'page glass' });
    const household = l.npcs.map((n) => {
      const ic = { adult: '🧑', kid: '🧒', teen: '🧑‍🎤', elder: '🧓', dog: '🐶', cat: '🐈‍⬛', animatronic: '💀' }[n.kind];
      return `<div><b>${ic} ${esc(n.name)}</b>${esc(roleOf(n))}</div>`;
    }).join('');
    const sel = new Set(this.loadout);
    const render = () => {
      page.innerHTML = `
        <div class="page-head"><div><div class="eyebrow">${l.index === 0 ? 'Ghost School' : `Haunting ${l.index}`} · Top Secret</div><h2>${esc(l.title)}</h2></div>
        <button class="btn" data-a="back">← Missions</button></div>
        <div class="briefing">
          <div class="dossier">
            <div class="stamp">EYES ONLY 👁</div>
            <h2>Dossier</h2>
            <div class="sub">${esc(l.family)} · ${esc(l.subtitle)}</div>
            ${l.briefing.map((p) => `<p>${esc(p)}</p>`).join('')}
            <div class="polaroid"><div class="pic">${l.child.age < 10 ? '🧒' : '🧑'}</div><div><b>${esc(l.child.name)}</b>, age ${l.child.age}<br/><span style="font-size:.85rem">${esc(l.child.blurb)}</span></div></div>
            <div style="font-size:.85rem;opacity:.7;margin-bottom:.3rem">HOUSEHOLD</div>
            <div class="household">${household}</div>
          </div>
          <div class="loadout">
            <ul class="objectives">
              <li>Find out ${esc(l.child.name.split(' ')[0])}’s secret Midnight Wish — and whether ${l.child.pronoun} earned a Treat or a Trick this year.</li>
              <li>Gather at least ${l.minCluesForReport} of ${l.clues.length} clues, then float back up the chimney to report.</li>
              <li>Stay unseen. If the fright meter fills, the haunting is blown.</li>
              <li>Be gone before the witching hour — you have ${l.minutes} minutes.</li>
            </ul>
            <h3>Choose two spells</h3>
            <span class="dim" style="font-size:.88rem">Bound to ${kbd('1')} and ${kbd('2')}. Slumber Mist (${kbd('LMB')}) is always with you.</span>
            <div class="ability-grid">${(Object.keys(ABILITIES) as AbilityId[]).map((id) => {
              const a = ABILITIES[id];
              const idx = this.loadout.indexOf(id);
              return `<button class="ability ${sel.has(id) ? 'sel' : ''}" data-ab="${id}" style="--c:${a.color}">
                ${idx >= 0 ? `<span class="slot kbd">${idx + 1}</span>` : ''}
                <span class="ico">${a.icon}</span><b>${a.name}</b><p>${esc(a.desc)}</p><p style="margin-top:.35rem;opacity:.75">${esc(a.detail)}</p></button>`;
            }).join('')}</div>
            <div style="display:flex;gap:.8rem;flex-wrap:wrap">
              <button class="btn primary" data-a="go" ${this.loadout.length === 2 ? '' : 'disabled'}>👻 Drift down the chimney</button>
              <button class="btn ghost" data-a="manual">📖 Controls</button>
            </div>
          </div>
        </div>`;
    };
    render();
    page.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const a = t.closest('[data-a]')?.getAttribute('data-a');
      const ab = t.closest('[data-ab]')?.getAttribute('data-ab') as AbilityId | null;
      if (ab) {
        audio.ui('toggle');
        if (this.loadout.includes(ab)) this.loadout = this.loadout.filter((x) => x !== ab);
        else {
          this.loadout.push(ab);
          if (this.loadout.length > 2) this.loadout.shift();
        }
        sel.clear();
        this.loadout.forEach((x) => sel.add(x));
        try { localStorage.setItem('boo.loadout', JSON.stringify(this.loadout)); } catch { /* ignore */ }
        render();
        return;
      }
      if (a === 'back') { audio.ui('back'); this.showMissions(); }
      if (a === 'manual') { audio.ui('click'); this.showManual(() => this.showBriefing(l)); }
      if (a === 'go' && this.loadout.length === 2) { audio.ui('confirm'); this.startMission(l); }
    });
    el.append(page);
    this.setScreen('briefing', el);
  }

  async startMission(l: LevelDef) {
    // ask for pointer lock while we still have the click gesture
    this.input.lock();
    this.showLoading('Drifting down the chimney…', 0.02);
    audio.music.stop();
    this.disposeGame();
    const game = new Game(l, this.renderer, this.input, this.overlays, this.hud, {
      onEnd: (r) => this.onEnd(r),
      onReport: () => this.openReport(),
      onPause: () => this.openPause(),
    }, [this.loadout[0], this.loadout[1]]);
    this.game = game;
    try {
      await game.load((p, label) => this.setLoading(p, label));
    } catch (e) {
      console.error(e);
      this.showTitle();
      return;
    }
    this.hud.clear();
    this.hud.setup(game);
    this.hud.show(true);
    this.setScreen('play', null);
    audio.music.play('mountainKing');
    audio.whoosh(1.2, false, 0.3);
    audio.rattle(undefined, 0.8, 0.25);
    this.hud.toast(`${l.title} — ${l.clockStart[0] % 12}:${String(l.clockStart[1]).padStart(2, '0')} PM`, 'gold');
    if (!this.input.locked) this.showClickToPlay();
  }

  private showClickToPlay() {
    if (this.clickToPlay) return;
    const el = h('div', { class: 'click-to-play' });
    el.innerHTML = `<div class="glass"><h3>Click to start haunting</h3><p class="dim">Your mouse will be captured. Press ${kbd('Esc')} or ${kbd('Tab')} for the journal.</p></div>`;
    el.addEventListener('click', () => {
      this.input.lock();
      el.remove();
      this.clickToPlay = null;
    });
    this.ui.append(el);
    this.clickToPlay = el;
  }

  private disposeGame() {
    if (this.game) {
      this.game.dispose();
      this.game = null;
    }
  }

  // ---------------------------------------------------------------- pause / journal

  openPause(tab: 'clues' | 'household' | 'wishes' | 'controls' = 'clues') {
    const g = this.game;
    if (!g || g.ended) return;
    g.paused = true;
    this.input.unlock();
    this.hud.show(false);
    audio.ui('page');
    audio.music.intensity = 0;
    const el = h('div', { class: 'screen' });
    el.style.background = 'rgba(5,8,20,.55)';
    const j = h('div', { class: 'journal glass' });
    const found = new Set(g.found.map((f) => f.clue.id));
    const counts = { wish: 0, deed: 0, rumor: 0 } as Record<string, number>;
    for (const f of g.found) counts[f.clue.category]++;
    const render = (t: typeof tab) => {
      tab = t;
      let content = '';
      if (t === 'clues') {
        content = `<h3>Evidence journal</h3><p class="dim" style="margin-top:-.4rem">${g.found.length} of ${g.def.clues.length} clues · ${g.found.length >= g.def.minCluesForReport ? 'You can file your report at the chimney.' : `${g.def.minCluesForReport - g.found.length} more needed before you can report.`}</p>`;
        for (const cat of ['wish', 'deed', 'rumor'] as const) {
          const list = g.def.clues.filter((c) => c.category === cat);
          if (!list.length) continue;
          content += `<div class="cat-head"><span class="eyebrow">${CATEGORY_ICON[cat]} ${CATEGORY_NAME[cat]}</span><span class="dim" style="font-size:.8rem">${counts[cat]}/${list.length}</span></div><div class="clue-list">`;
          content += list.map((c) => clueCard(c, found.has(c.id))).join('');
          content += '</div>';
        }
      } else if (t === 'household') {
        content = `<h3>The household</h3><div class="clue-list">${g.npcs.map((n) => {
          const ic = { adult: '🧑', kid: '🧒', teen: '🧑‍🎤', elder: '🧓', dog: '🐶', cat: '🐈‍⬛', animatronic: '💀' }[n.def.kind];
          const st = n.befriended ? '<span class="badge green">befriended</span>' : n.state === 'sleep' ? '<span class="badge">asleep</span>' : n.state === 'alert' ? '<span class="badge red">alerted</span>' : '';
          return `<div class="clue-card"><span class="ic">${ic}</span><div><b>${esc(n.name)}</b> ${st}<p>${esc(roleOf(n.def))}</p></div></div>`;
        }).join('')}</div>`;
      } else if (t === 'wishes') {
        content = `<h3>The shortlist</h3><p class="dim" style="margin-top:-.4rem">The Order’s crystal ball says ${esc(g.def.child.name.split(' ')[0])}’s Midnight Wish is one of these. Your evidence decides which.</p><div class="wishes" style="margin-top:1rem">${g.def.wishes.map((gf) => `<div class="wish" style="cursor:default"><div class="ic">${gf.icon}</div><b>${esc(gf.name)}</b><small>${esc(gf.blurb)}</small></div>`).join('')}</div>`;
      } else {
        content = controlsHtml();
      }
      j.innerHTML = `
        <nav>
          <h2>📓 Spook Book</h2>
          <button class="tab ${t === 'clues' ? 'on' : ''}" data-t="clues">Evidence <span>${g.found.length}/${g.def.clues.length}</span></button>
          <button class="tab ${t === 'household' ? 'on' : ''}" data-t="household">Household</button>
          <button class="tab ${t === 'wishes' ? 'on' : ''}" data-t="wishes">Wish shortlist</button>
          <button class="tab ${t === 'controls' ? 'on' : ''}" data-t="controls">Controls</button>
          <div class="spacer"></div>
          <button class="btn primary" data-a="resume">▶ Resume</button>
          ${g.found.length >= g.def.minCluesForReport ? '<button class="btn gold" data-a="report">📝 File report</button>' : ''}
          <button class="btn" data-a="settings">⚙️ Settings</button>
          <button class="btn" data-a="restart">↺ Restart</button>
          <button class="btn ghost" data-a="quit">⏏ Quit to menu</button>
        </nav>
        <div class="content">${content}</div>`;
    };
    render(tab);
    j.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const tb = t.closest('[data-t]')?.getAttribute('data-t') as typeof tab | null;
      if (tb) { audio.ui('page'); render(tb); return; }
      const a = t.closest('[data-a]')?.getAttribute('data-a');
      if (!a) return;
      audio.ui('click');
      if (a === 'resume') this.resume();
      if (a === 'report') { this.openReport(); }
      if (a === 'settings') this.showSettings(() => this.openPause());
      if (a === 'restart') { const def = g.def; this.startMission(def); }
      if (a === 'quit') { this.disposeGame(); this.hud.show(false); this.renderer.setScene(this.menuLevel!.scene, this.menuCam); this.showTitle(); }
    });
    const onKey = (e: KeyboardEvent) => {
      if (this.screen !== 'pause') { window.removeEventListener('keydown', onKey); return; }
      if (e.code === 'Tab' || e.code === 'KeyJ') { e.preventDefault(); window.removeEventListener('keydown', onKey); this.resume(); }
    };
    window.addEventListener('keydown', onKey);
    el.append(j);
    this.setScreen('pause', el);
  }

  private resume() {
    const g = this.game;
    if (!g) return;
    g.paused = false;
    this.hud.show(true);
    this.setScreen('play', null);
    this.input.clear();
    this.input.lock();
    window.setTimeout(() => { if (!this.input.locked && this.screen === 'play') this.showClickToPlay(); }, 300);
  }

  // ---------------------------------------------------------------- report

  openReport() {
    const g = this.game;
    if (!g) return;
    g.paused = true;
    this.input.unlock();
    this.hud.show(false);
    audio.play('sfx/book_open', { bus: 'ui', volume: 0.5 });
    let wish = '';
    let ledger: '' | Ledger = '';
    const el = h('div', { class: 'screen' });
    el.style.background = 'rgba(5,8,20,.6)';
    const wrap = h('div', { class: 'report' });
    const found = new Set(g.found.map((f) => f.clue.id));
    const evidence = h('div', { class: 'evidence glass' });
    evidence.innerHTML = `<h3>Your evidence</h3><div class="clue-list">${g.def.clues.filter((c) => found.has(c.id)).map((c) => clueCard(c, true)).join('') || '<p class="dim">No evidence… spooky.</p>'}</div>`;
    const form = h('div', { class: 'report-form' });
    const render = () => {
      form.innerHTML = `
        <div class="head"><div><span class="eyebrow" style="color:var(--blood)">Order of B.O.O. · Form 31-10</span><h2>Field Report: ${esc(g.def.child.name)}</h2></div>
        <div class="formno">Filed ${g.clock()[0] % 12}:${String(g.clock()[1]).padStart(2, '0')} PM<br/>Agent: you</div></div>
        <h4>1. WHAT IS ${esc(g.def.child.name.split(' ')[0].toUpperCase())}’S SECRET MIDNIGHT WISH?</h4>
        <div class="wishes">${g.def.wishes.map((gf) => {
          const n = g.found.filter((f) => f.clue.points === gf.id).length;
          return `<button class="wish ${wish === gf.id ? 'sel' : ''}" data-g="${gf.id}">${n ? `<span class="hint-count">📎 ${n}</span>` : ''}<div class="ic">${gf.icon}</div><b>${esc(gf.name)}</b><small>${esc(gf.blurb)}</small></button>`;
        }).join('')}</div>
        <h4>2. TREAT OR TRICK? WHICH LEDGER DOES ${esc(g.def.child.pronoun === 'she' ? 'SHE' : g.def.child.pronoun === 'he' ? 'HE' : 'THEY')} BELONG IN?</h4>
        <div class="ledgers">
          <button class="ledger treat ${ledger === 'treat' ? 'sel' : ''}" data-l="treat"><div class="ic">🍬</div><b>Treat — to Old Jack</b><small>Kind, brave, generally lovely.</small><span class="stamp-mark">TREAT</span></button>
          <button class="ledger trick ${ledger === 'trick' ? 'sel' : ''}" data-l="trick"><div class="ic">🕷️</div><b>Trick — to the Bogeyman</b><small>Mischief beyond the forgivable.</small><span class="stamp-mark">TRICK</span></button>
        </div>
        <div class="report-actions">
          <button class="btn" style="color:var(--paper-ink);border-color:rgba(43,36,51,.3)" data-a="back">← Keep investigating</button>
          <button class="btn primary" data-a="submit" ${wish && ledger ? '' : 'disabled'}>🕯️ Seal with wax & send by raven</button>
        </div>`;
    };
    render();
    form.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const gid = t.closest('[data-g]')?.getAttribute('data-g');
      const lid = t.closest('[data-l]')?.getAttribute('data-l') as Ledger | null;
      const a = t.closest('[data-a]')?.getAttribute('data-a');
      if (gid) { wish = gid; audio.ui('toggle'); render(); }
      if (lid) { ledger = lid; audio.play('sfx/wood', { bus: 'ui', volume: 0.7, rate: 0.7 }); render(); }
      if (a === 'back') { audio.ui('back'); this.resume(); }
      if (a === 'submit' && wish && ledger) {
        audio.ui('confirm');
        audio.rattle(undefined, 1.4, 0.35);
        g.paused = false;
        g.submitReport(wish, ledger);
      }
    });
    wrap.append(form, evidence);
    el.append(wrap);
    this.setScreen('report', el);
  }

  // ---------------------------------------------------------------- results

  private onEnd(r: MissionResult) {
    const g = this.game!;
    this.overlays.forceClose();
    this.clickToPlay?.remove();
    this.clickToPlay = null;
    this.input.unlock();
    this.hud.show(false);
    const def = g.def;
    let ending: 'promotion' | 'recognition' | 'demotion' | 'caught' | 'timeout';
    if (r.outcome === 'caught') ending = 'caught';
    else if (r.outcome === 'timeout') ending = 'timeout';
    else {
      const wishOk = r.wish === def.answer.wish;
      const ledgerOk = r.ledger === def.answer.ledger;
      ending = wishOk && ledgerOk ? 'promotion' : wishOk || ledgerOk ? 'recognition' : 'demotion';
    }
    const ghost = r.stats.spotted === 0 && r.outcome === 'report';
    const allClues = r.clues.length >= def.clues.length;
    let stars = { promotion: 3, recognition: 2, demotion: 1, caught: 0, timeout: 0 }[ending];
    if (r.outcome === 'report') {
      if (ghost) stars++;
      if (allClues) stars++;
    }
    stars = Math.min(5, stars);
    const ranks = ['Dust Bunny', 'Draughty Wisp', 'Creaky Floorboard', 'Bump in the Night', 'Poltergeist', 'Grand Phantom of the Order'];
    if (r.outcome === 'report') {
      recordMission(def.id, { completed: true, bestEnding: ending as 'promotion', bestRank: stars, bestTime: r.time, ghost });
    } else recordMission(def.id, { completed: false, bestRank: 0 });
    audio.music.stop();
    window.setTimeout(() => audio.play(ending === 'promotion' ? 'music/win' : ending === 'recognition' ? 'music/partial' : ending === 'caught' ? 'music/caught' : 'music/lose', { bus: 'music', volume: 0.7, vary: 0 }), 300);
    window.setTimeout(() => audio.music.play('toccata'), 4500);

    const medals: string[] = [];
    if (ghost) medals.push('🌫️ Truly Invisible — never spotted');
    if (ghost && r.stats.misted === 0) medals.push('🕊️ Rest in Peace — no one misted');
    if (allClues) medals.push('🔎 Sherlock Bones — every clue');
    if (r.stats.candy >= 2) medals.push('🍬 Sweet Tooth');
    if (r.stats.pets > 0) medals.push('🐾 Familiar Spirit');
    if (r.stats.broken > 0) medals.push('💥 Poltergeist Activity');
    if (r.stats.lightsOut >= 3) medals.push('🕯️ Lights Out');
    if (r.outcome === 'report' && r.time < def.minutes * 30) medals.push('🧹 Speedy Broomstick');

    const titles = {
      promotion: ['🏅', 'Promoted!', `Spot on. ${def.child.name.split(' ')[0]}’s Halloween is in safe hands.`],
      recognition: ['🎖️', 'Honourable Haunting', 'Half right — the Order appreciates the effort.'],
      demotion: ['🧹', 'Demoted', 'Wrong wish, wrong ledger. Report to the attic for dust-bunny duty.'],
      caught: ['🚨', 'Caught!', `${r.caughtBy ?? 'Someone'} pulled the sheet off a real ghost. Awkward.`],
      timeout: ['🕛', 'Midnight!', 'The witching hour struck before your report did.'],
    } as const;
    const [emoji, big, line] = titles[ending];
    const wishName = def.wishes.find((x) => x.id === r.wish)?.name ?? '';
    const first = def.child.name.split(' ')[0];
    let letter = '';
    if (r.outcome === 'report') {
      if (r.ledger === 'treat') {
        letter = `<div class="letter">Dear Agent,<br/><br/>Your report on ${esc(first)} arrived by raven at the stroke of midnight. ${ending === 'promotion' ? `A ${esc(wishName)} it is — wrapped in cobweb, tied with a ribbon of candlelight, and left on the doorstep at dawn. You have a gift for this work.` : ending === 'recognition' ? `I shall leave the ${esc(wishName)}… though my candle flickers. There was more to uncover.` : `Hmm. A ${esc(wishName)}? My pumpkin head creaks with doubt.`}<br/><br/>Glowingly yours,<div class="sig">— Old Jack o’ the Lantern</div><div class="seal">🎃</div></div>`;
      } else {
        letter = `<div class="letter bogey">Little Boo,<br/><br/>You sent ${esc(first)}’s name to <i>me</i>. ${ending === 'promotion' ? 'A wise choice. Tonight: shoelaces tied together, one sock missing forever, and a rubber spider in the cereal… and, grudgingly, the ' + esc(wishName) + ' — for an honest prankster can still change.' : ending === 'recognition' ? 'Interesting. Are you <i>sure</i>? My closet door creaks with doubt.' : 'I have rarely seen a name so wrongly delivered. Even I feel bad, and I live under beds.'}<br/><br/>Lurkingly yours,<div class="sig">— The Bogeyman</div></div>`;
      }
    } else {
      letter = `<div class="letter">Agent,<br/><br/>${ending === 'caught' ? `The ${esc(def.family)} now believe in ghosts. Our lawyers (also ghosts) are handling it. Try again — quieter, darker, spookier.` : 'Twelve bells have tolled and your report is nowhere. Remember: you only need enough evidence, not all of it.'}<br/><br/>Regards,<div class="sig">— Grand Phantom of the Order</div></div>`;
    }
    const mm = Math.floor(r.time / 60), ss = Math.floor(r.time % 60);
    const el = h('div', { class: 'screen' });
    el.style.background = 'rgba(5,8,20,.7)';
    const idx = LEVELS.indexOf(def);
    const next = LEVELS[idx + 1];
    el.innerHTML = `<div class="results">
      <div class="verdict glass ${ending}">
        <div class="emoji">${emoji}</div>
        <div class="eyebrow">${esc(def.title)}</div>
        <div class="big">${big}</div>
        <p class="dim">${esc(line)}</p>
        <div class="rank">${Array.from({ length: 5 }, (_, i) => `<i class="${i < stars ? 'on' : ''}" style="animation-delay:${0.4 + i * 0.15}s">★</i>`).join('')}</div>
        <div class="rank-name">${ranks[stars]}</div>
        ${r.outcome === 'report' ? `<p style="font-size:.9rem;margin:.8rem 0 0" class="dim">The truth: <b style="color:var(--ink)">${esc(def.wishes.find((x) => x.id === def.answer.wish)?.name ?? '')}</b> · <b style="color:var(--ink)">${def.answer.ledger === 'treat' ? 'Treat 🍬' : 'Trick 🕷️'}</b></p>` : ''}
        <div class="stats">
          <div><span>Time</span><b>${mm}:${String(ss).padStart(2, '0')}</b></div>
          <div><span>Clues</span><b>${r.clues.length}/${def.clues.length}</b></div>
          <div><span>Times spotted</span><b>${r.stats.spotted}</b></div>
          <div><span>People misted</span><b>${r.stats.misted}</b></div>
          <div><span>Spells cast</span><b>${r.stats.spells}</b></div>
          <div><span>Peak detection</span><b>${Math.round(r.stats.maxDetection)}%</b></div>
        </div>
        <div class="medals">${medals.map((m) => `<span class="badge gold">${esc(m)}</span>`).join('')}</div>
      </div>
      ${letter}
      <div class="results-actions">
        ${r.outcome === 'report' && next ? `<button class="btn primary" data-a="next">Next: ${esc(next.title)} →</button>` : ''}
        <button class="btn" data-a="retry">↺ Replay mission</button>
        <button class="btn ghost" data-a="menu">⏏ Main menu</button>
      </div></div>`;
    el.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest('[data-a]')?.getAttribute('data-a');
      if (!a) return;
      audio.ui('click');
      if (a === 'next' && next) this.showBriefing(next);
      if (a === 'retry') this.showBriefing(def);
      if (a === 'menu') { this.disposeGame(); this.renderer.setScene(this.menuLevel!.scene, this.menuCam); this.showTitle(); return; }
      this.disposeGame();
      this.renderer.setScene(this.menuLevel!.scene, this.menuCam);
    });
    this.setScreen('results', el);
  }

  // ---------------------------------------------------------------- settings / manual / credits

  showSettings(back: () => void) {
    const el = h('div', { class: 'screen' });
    if (this.game) el.style.background = 'rgba(5,8,20,.6)';
    const page = h('div', { class: 'page glass' });
    const slider = (k: keyof Settings, label: string, min: number, max: number, step: number, fmt: (v: number) => string) =>
      `<div class="setting"><label>${label}</label><div style="display:flex;gap:.6rem;align-items:center"><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${settings[k]}"/><span class="val">${fmt(settings[k] as number)}</span></div></div>`;
    const toggle = (k: keyof Settings, label: string) => `<div class="setting"><label>${label}</label><button class="toggle ${settings[k] ? 'on' : ''}" data-tg="${k}" aria-pressed="${settings[k]}"></button></div>`;
    const seg = (k: keyof Settings, label: string, opts: string[]) => `<div class="setting"><label>${label}</label><div class="seg">${opts.map((o) => `<button class="${settings[k] === o ? 'on' : ''}" data-seg="${k}" data-v="${o}">${o}</button>`).join('')}</div></div>`;
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    const render = () => {
      page.innerHTML = `
        <div class="page-head"><div><div class="eyebrow">The Crypt</div><h2>Settings</h2></div>
        <div style="display:flex;gap:.6rem"><button class="btn ghost" data-a="reset">Reset</button><button class="btn" data-a="back">← Back</button></div></div>
        <div class="settings">
          <div class="setting-group"><h3>🔊 Sound</h3>
            ${slider('masterVolume', 'Master', 0, 1, 0.05, pct)}
            ${slider('musicVolume', 'Music', 0, 1, 0.05, pct)}
            ${slider('sfxVolume', 'Effects', 0, 1, 0.05, pct)}
          </div>
          <div class="setting-group"><h3>🖥️ Graphics</h3>
            ${seg('quality', 'Quality', ['low', 'medium', 'high', 'ultra'])}
            ${slider('fov', 'Field of view', 60, 100, 1, (v) => `${v}°`)}
            ${toggle('headBob', 'Head bob')}
            ${toggle('reduceMotion', 'Reduce motion')}
          </div>
          <div class="setting-group"><h3>🖱️ Controls</h3>
            ${slider('sensitivity', 'Mouse sensitivity', 0.2, 3, 0.05, (v) => v.toFixed(2))}
            ${toggle('invertY', 'Invert Y')}
            ${toggle('crouchToggle', 'Crouch is a toggle')}
          </div>
          <div class="setting-group"><h3>♿ Accessibility</h3>
            ${toggle('subtitles', 'Subtitles')}
            ${seg('subtitleSize', 'Subtitle size', ['small', 'medium', 'large'])}
            ${toggle('showVisionCones', 'Show vision cones')}
          </div>
        </div>`;
    };
    render();
    page.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      const k = t.getAttribute('data-k') as keyof Settings | null;
      if (!k) return;
      updateSettings({ [k]: parseFloat(t.value) } as Partial<Settings>);
      const v = parseFloat(t.value);
      (t.nextElementSibling as HTMLElement).textContent = k === 'fov' ? `${v}°` : k === 'sensitivity' ? v.toFixed(2) : `${Math.round(v * 100)}%`;
    });
    page.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const tg = t.getAttribute('data-tg') as keyof Settings | null;
      const sg = t.getAttribute('data-seg') as keyof Settings | null;
      const a = t.closest('[data-a]')?.getAttribute('data-a');
      if (tg) { updateSettings({ [tg]: !settings[tg] } as Partial<Settings>); audio.ui('toggle'); render(); }
      if (sg) { updateSettings({ [sg]: t.getAttribute('data-v') } as Partial<Settings>); audio.ui('toggle'); render(); }
      if (a === 'reset') { updateSettings({ ...defaultSettings }); render(); }
      if (a === 'back') { audio.ui('back'); back(); }
      this.hud.applySubSize();
      if (this.game) this.game.showCones = settings.showVisionCones;
    });
    el.append(page);
    this.setScreen('settings', el);
  }

  showManual(back: () => void) {
    const el = h('div', { class: 'screen' });
    const page = h('div', { class: 'page glass' });
    page.innerHTML = `
      <div class="page-head"><div><div class="eyebrow">Order of B.O.O. — Issue 31</div><h2>Field Manual</h2></div><button class="btn" data-a="back">← Back</button></div>
      <div class="manual-grid">
        <div class="manual-card">${controlsHtml()}</div>
        <div class="manual-card"><h3>🎯 Your haunting</h3><p>Every Halloween, children make a secret <b>Midnight Wish</b> — and someone has to find out what it really is. Drift down the chimney, gather evidence of what the child <i>truly</i> wants and how they’ve behaved, then float back up and file your report: the right wish, and the right ledger — <b>Treat</b> (Old Jack o’ the Lantern) or <b>Trick</b> (the Bogeyman).</p>
          <ul><li><b>Wishes</b> point to the Midnight Wish — but some are out of date or belong to someone else.</li><li><b>Deeds</b> reveal behaviour. Weigh the good against the bad.</li><li><b>Rumours</b> come from eavesdropping, sleep-talk and gossiping pets.</li></ul></div>
        <div class="manual-card"><h3>🌙 Staying unseen</h3><ul>
          <li>Your <b>glow gauge</b> ☾ shows how visible you are. Shadows are your friend; lamps can be switched off or snuffed.</li>
          <li>Crouching makes you smaller and quieter. Sprinting is loud.</li>
          <li><b>Carpet</b> is quiet, <b>tile</b> is loud, and some floorboards <b>squeak</b>.</li>
          <li>People have <b>vision cones</b>. A <b>?</b> means they’re suspicious; a <b>!</b> means you’ve been spotted. Break line of sight and hide.</li>
          <li><b>Cats see spirits</b> even when you Fade, <b>dogs smell</b> you, and <b>motion-sensor skeletons</b> shriek if you move in front of them.</li>
          <li>If the fright meter fills, the haunting is over.</li></ul></div>
        <div class="manual-card"><h3>👻 Boo magic</h3><ul>
          <li><b>Fade</b> — 6 s of see-through invisibility.</li>
          <li><b>Possess</b> — hop into a jack-o’-lantern until you move.</li>
          <li><b>Spirit Sight</b> — look at a decoration marked with a green wisp and see through its eyes; tag people with ${kbd('F')}.</li>
          <li><b>Bump in the Night</b> — a thrown will-o’-wisp that knocks and rattles to lure people over.</li>
          <li><b>Snuff</b> — blow out a lamp, candle or lantern you can see, from across the room.</li>
          <li><b>Slumber Mist</b> (${kbd('LMB')}) — a violet puff that makes people doze and leaves a misty hiding cloud.</li>
          <li>Ectoplasm recharges slowly. Candy bowls restore it instantly.</li></ul></div>
        <div class="manual-card"><h3>🧰 Tricks of the trade</h3><ul>
          <li>Hide in closets, under beds, behind curtains, in a pile of pumpkins — or <i>inside a cardboard box</i>.</li>
          <li>Throw books, toys and pumpkins to make a distraction. Potion bottles shatter loudly.</li>
          <li>People notice what’s out of place: a candle gone out, a smashed potion, a squashed pumpkin.</li>
          <li>Doors block sight and muffle sound. Close them behind you.</li>
          <li>Give a pet a treat and it’ll be your familiar for the night.</li></ul></div>
      </div>`;
    page.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-a="back"]')) { audio.ui('back'); back(); }
    });
    el.append(page);
    this.setScreen('manual', el);
  }

  showCredits() {
    const el = h('div', { class: 'screen' });
    const page = h('div', { class: 'page glass' });
    page.innerHTML = `
      <div class="page-head"><div><div class="eyebrow">With thanks</div><h2>Credits</h2></div><button class="btn" data-a="back">← Back</button></div>
      <div class="credits-cols">
        <div><h3 style="margin-bottom:.6rem">The Order of B.O.O.</h3><table>
          <tr><td>Echo (Beili) Yin</td><td>Design, code & haunting</td></tr>
          <tr><td>Procedural props</td><td>Pumpkins, gravestones, cauldrons, skeletons & cobwebs — built in code</td></tr>
          <tr><td>Music</td><td>Chopin, Grieg & Bach (public domain), arranged live with Web Audio</td></tr></table>
          <p class="dim" style="margin-top:1rem;font-size:.85rem">Free to play. Non-commercial — see the licence in the repository.</p></div>
        <div><h3 style="margin-bottom:.6rem">Open assets & tech</h3><table>
          <tr><td>3D models</td><td>Kenney — Furniture Kit, Holiday Kit, Food Kit, Blocky Characters (CC0)</td></tr>
          <tr><td>Particles</td><td>Kenney — Particle Pack (CC0)</td></tr>
          <tr><td>Sound effects</td><td>Kenney — Impact, Interface, RPG & UI Audio (CC0)</td></tr>
          <tr><td>Jingles</td><td>Kenney — Music Jingles (CC0)</td></tr>
          <tr><td>Fonts</td><td>Creepster, Fraunces, Nunito, Caveat, Special Elite (OFL)</td></tr>
          <tr><td>Engine</td><td>three.js, pmndrs postprocessing, N8AO, Vite, TypeScript</td></tr></table>
          <p class="dim" style="margin-top:1rem;font-size:.85rem">Kenney assets: <a href="https://kenney.nl" target="_blank" rel="noopener">kenney.nl</a>. Licence files ship in <code>assets/licenses</code>.</p></div>
      </div>`;
    page.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-a="back"]')) { audio.ui('back'); this.showTitle(); }
    });
    el.append(page);
    this.setScreen('credits', el);
  }
}

function roleOf(n: import('../levels/types').NPCDef) {
  const r: Record<string, string> = { adult: 'Grown-up', kid: 'The child', teen: 'Teenager', elder: 'Grandparent', dog: 'Dog — smells ghosts', cat: 'Cat — sees spirits, gossips', animatronic: 'Motion-sensor skeleton — hates movement' };
  return n.barks?.giveUp ? r[n.kind] : r[n.kind];
}

function clueCard(c: ClueDef, known: boolean) {
  if (!known) return `<div class="clue-card unknown"><span class="ic">❔</span><div><b>Undiscovered ${c.category === 'wish' ? 'wish' : c.category === 'deed' ? 'deed' : 'rumour'}</b><p>Keep searching.</p></div></div>`;
  return `<div class="clue-card"><span class="ic">${CATEGORY_ICON[c.category]}</span><div><b>${esc(c.title)}</b><p>${esc(c.text)}</p></div></div>`;
}

function controlsHtml() {
  const rows: [string[], string][] = [
    [['W', 'A', 'S', 'D'], 'Move'],
    [['Mouse'], 'Look'],
    [['Shift'], 'Sprint (loud)'],
    [['Q', 'C'], 'Crouch (toggle)'],
    [['Space'], 'Jump / climb onto furniture'],
    [['E'], 'Interact · pick up · read · hide (hold to search)'],
    [['LMB'], 'Slumber Mist / throw held item'],
    [['RMB'], 'Drop held item'],
    [['1', '2'], 'Cast your two spells'],
    [['F'], 'Tag a person (during Spirit Sight)'],
    [['3'], 'Jump to report once every clue is found'],
    [['Tab', 'Esc'], 'Journal & pause'],
  ];
  return `<h3>⌨️ Controls</h3><div class="controls-table">${rows.map(([k, d]) => `<div class="keys">${k.map(kbd).join('')}</div><div>${esc(d)}</div>`).join('')}</div>`;
}

function houseSvg(i: number) {
  const roof = ['#1e1a28', '#2a2433', '#3b2a22', '#1e2028', '#2a2433'][i % 5];
  const body = ['#3a4a3a', '#4a3a5a', '#6b4a32', '#2e3440', '#3a3150'][i % 5];
  const lights = Array.from({ length: 9 }, (_, k) => `<circle cx="${18 + k * 10.5}" cy="31" r="1.6" fill="${['#ff7a1a', '#a35cff', '#7cff6b'][k % 3]}"/>`).join('');
  const jack = `<g transform="translate(36 62)"><ellipse rx="6" ry="5" fill="#e8731c"/><path d="M-3,-1 l1.5,-2 l1.5,2z M0.5,-1 l1.5,-2 l1.5,2z" fill="#ffd36e"/><path d="M-3,1.5 q3,2.5 6,0" stroke="#ffd36e" fill="none"/></g>`;
  return `<svg class="house" viewBox="0 0 120 70"><circle cx="100" cy="12" r="9" fill="#ffd9a0" opacity=".9"/><polygon points="10,32 60,6 110,32" fill="${roof}"/><rect x="18" y="30" width="84" height="40" fill="${body}"/><rect x="28" y="40" width="14" height="12" fill="#ff9a3c"/><rect x="78" y="40" width="14" height="12" fill="#a35cff"/><rect x="54" y="46" width="12" height="24" fill="#2a1420"/>${lights}${jack}<rect x="80" y="8" width="8" height="16" fill="#4a3a3a"/><path d="M14,18 l3,-2 l1,2 l1,-2 l3,2 l-4,1z" fill="#0a0810"/></svg>`;
}

// In-mission HUD: clock & objectives, fright meter, glow-gauge moon,
// ability slots, ecto/mist orbs, interaction prompt, subtitles, toasts,
// NPC awareness markers (+ off-screen arrows) and hide-spot vignettes.

import * as THREE from 'three';
import type { Game, Hud } from '../game/game';
import { ABILITIES } from '../game/abilities';
import { SightToy } from '../game/interact';
import type { ClueDef } from '../levels/types';
import { h, esc, kbd, CATEGORY_ICON } from './dom';
import { settings } from '../core/settings';

const STAR_SVG = `<svg viewBox="0 0 100 100"><defs><radialGradient id="sg" cx="45%" cy="40%" r="65%"><stop offset="0" stop-color="#fff"/><stop offset="0.5" stop-color="var(--gc)"/><stop offset="1" stop-color="#2a1a30"/></radialGradient></defs><circle cx="50" cy="50" r="40" fill="url(#sg)" stroke="#fff1d6" stroke-width="2"/><circle cx="36" cy="38" r="7" fill="#000" opacity=".12"/><circle cx="62" cy="60" r="10" fill="#000" opacity=".1"/><circle cx="60" cy="30" r="4" fill="#000" opacity=".12"/><path d="M8 52 q4 -4 9 -1 l3 -5 l3 5 q5 -3 9 1 q-6 1 -12 6 q-6 -5 -12 -6z" fill="#120a18"/></svg>`;

export class HudView implements Hud {
  root: HTMLElement;
  private els: Record<string, HTMLElement> = {};
  private markers = new Map<string, HTMLElement>();
  private toyMarkers = new Map<SightToy, HTMLElement>();
  private subs: HTMLElement;
  private toastsEl: HTMLElement;
  private lastPrompt = '';
  private hideClass = '';

  constructor(parent: HTMLElement) {
    this.root = h('div', { class: 'layer hud' });
    this.root.innerHTML = `
      <div class="vignette-hide"><div class="lbl"></div></div>
      <div class="markers"></div>
      <div class="hud-tl glass">
        <div class="eyebrow mission-sub"></div>
        <div class="mission-name"></div>
        <div class="clock"><b>10:00</b><span>PM · witching hour at midnight</span></div>
        <div class="clues-pips"></div>
        <div class="objective"></div>
      </div>
      <div class="detect"><div class="label">Unseen</div><div class="meter"><span></span></div></div>
      <div class="crosshair"></div>
      <svg class="hold-ring" viewBox="0 0 46 46"><circle cx="23" cy="23" r="19" stroke-dasharray="119.4" stroke-dashoffset="119.4"/></svg>
      <div class="prompt glass hidden"></div>
      <div class="subtitles"></div>
      <div class="toasts"></div>
      <div class="hint glass hidden"><span class="eyebrow">Field training</span><span class="txt"></span></div>
      <div class="gem">
        <div class="stance left">Standing</div>
        <div class="star">${STAR_SVG}</div>
        <div class="stance right">Dark</div>
        <div class="noise"><i></i><i></i><i></i><i></i><i></i><span>noise</span></div>
      </div>
      <div class="slots">
        <div class="orbs">
          <small>ECTO</small><div class="row magic"></div>
          <small>MIST</small><div class="row cheer"></div>
        </div>
        <div class="slot s0"><div class="face"><span class="ic"></span><span class="k kbd">1</span></div><small></small></div>
        <div class="slot s1"><div class="face"><span class="ic"></span><span class="k kbd">2</span></div><small></small></div>
      </div>`;
    parent.append(this.root);
    const q = (s: string) => this.root.querySelector(s) as HTMLElement;
    Object.assign(this.els, {
      vignette: q('.vignette-hide'), vlabel: q('.vignette-hide .lbl'), markers: q('.markers'),
      sub: q('.mission-sub'), name: q('.mission-name'), clock: q('.clock'), clockB: q('.clock b'), pips: q('.clues-pips'), obj: q('.objective'),
      detLabel: q('.detect .label'), detBar: q('.detect .meter span'),
      cross: q('.crosshair'), ring: q('.hold-ring circle'), ringSvg: q('.hold-ring'), prompt: q('.prompt'),
      hint: q('.hint'), hintTxt: q('.hint .txt'),
      star: q('.gem .star'), stanceL: q('.gem .stance.left'), stanceR: q('.gem .stance.right'), noise: q('.gem .noise'),
      magic: q('.orbs .magic'), cheer: q('.orbs .cheer'), s0: q('.slot.s0'), s1: q('.slot.s1'),
    });
    this.subs = q('.subtitles');
    this.toastsEl = q('.toasts');
    this.applySubSize();
  }

  applySubSize() {
    document.documentElement.style.setProperty('--sub-size', { small: '0.98rem', medium: '1.15rem', large: '1.4rem' }[settings.subtitleSize]);
  }

  setup(g: Game) {
    const d = g.def;
    this.els.sub.textContent = d.subtitle;
    this.els.name.textContent = d.title;
    this.els.pips.innerHTML = d.clues.map(() => '<i></i>').join('');
    g.loadout.forEach((id, i) => {
      const a = ABILITIES[id];
      const s = this.els[`s${i}`];
      s.style.setProperty('--c', a.color);
      (s.querySelector('.ic') as HTMLElement).textContent = a.icon;
      (s.querySelector('small') as HTMLElement).textContent = a.name;
    });
    this.els.magic.innerHTML = Array.from({ length: g.abilities.maxCharges }, () => '<i><span class="fill"></span></i>').join('');
    this.els.cheer.innerHTML = Array.from({ length: g.abilities.mistMax }, () => '<i class="cheer"><span class="fill"></span></i>').join('');
    this.root.classList.remove('hidden');
  }

  show(v: boolean) { this.root.classList.toggle('hidden', !v); }

  update(g: Game, _dt: number) {
    if (!g.player) return;
    this.root.classList.toggle('modal', g.ui.isModalOpen());
    const [hh, mm] = g.clock();
    const ampm = hh >= 12 && hh < 24 ? 'PM' : 'AM';
    const h12 = hh % 12 === 0 ? 12 : hh % 12;
    this.els.clockB.textContent = `${h12}:${String(mm).padStart(2, '0')}`;
    (this.els.clock.querySelector('span') as HTMLElement).textContent = `${ampm} · witching hour at midnight`;
    const left = g.def.minutes * 60 - g.time;
    this.els.clock.classList.toggle('late', left < 60);
    // clues
    const pips = this.els.pips.children;
    for (let i = 0; i < pips.length; i++) pips[i].classList.toggle('on', i < g.found.length);
    const need = g.def.minCluesForReport;
    const n = g.found.length;
    const total = g.def.clues.length;
    this.els.obj.innerHTML = `
      <div class="${n >= total ? 'done' : ''}">${n >= total ? '✔' : '🕸'} Gather evidence — ${n}/${total} clues</div>
      <div class="${n >= need ? '' : 'dim'}">${n >= need ? '👻 Report via the chimney when ready' + (n >= total ? ` · or press ${kbd('3')}` : '') : `🔒 Report unlocks at ${need} clues`}</div>`;

    // detection
    const det = g.detection;
    this.els.detBar.style.width = `${det}%`;
    const maxAware = Math.max(0, ...g.npcs.map((x) => x.awareness));
    let label = 'Unseen', cls = '';
    if (g.playerState.hiddenSpot || g.playerState.morphed) { label = 'Hidden'; cls = 'hidden'; }
    else if (g.playerState.invisible) { label = 'Shimmering'; cls = 'hidden'; }
    else if (g.playerState.inCloud) { label = 'Hidden in mist'; cls = 'hidden'; }
    if (maxAware >= 2 || g.npcs.some((x) => x.state === 'alert')) { label = 'Spotted!'; cls = 'alert'; }
    else if (g.npcs.some((x) => x.state === 'search')) { label = 'They’re searching…'; cls = 'sus'; }
    else if (maxAware > 0.25) { label = 'Suspicious…'; cls = 'sus'; }
    this.els.detLabel.textContent = label;
    this.els.detLabel.className = `label ${cls}`;

    // light gem
    const v = g.playerVis;
    const star = this.els.star;
    const col = v < 0.2 ? '#3d5a9a' : v < 0.5 ? '#c9a14a' : '#ffe7a3';
    star.style.setProperty('--gc', col);
    star.style.setProperty('--glow', `${4 + v * 26}px`);
    star.style.opacity = String(0.55 + v * 0.45);
    this.els.stanceL.textContent = g.playerState.inBox ? 'In a box' : g.hiding ? 'Hiding' : g.player.crouched ? 'Crouched' : g.player.sprinting ? 'Sprinting' : 'Standing';
    this.els.stanceR.textContent = g.playerState.invisible ? 'Invisible' : v < 0.15 ? 'Shadowed' : v < 0.45 ? 'Dim' : v < 0.75 ? 'Lit' : 'Bright';

    // noise meter: how far your last sound carried
    const age = g.time - g.lastNoise.t;
    const loud = age < 1.2 ? Math.min(1, g.lastNoise.r / 9) * (1 - age / 1.2) : 0;
    const bars = this.els.noise.querySelectorAll('i');
    bars.forEach((b, i) => b.classList.toggle('on', loud > i / 5 + 0.02));
    // slots / orbs
    const ab = g.abilities;
    const orbs = this.els.magic.children;
    for (let i = 0; i < orbs.length; i++) {
      const o = orbs[i] as HTMLElement;
      o.classList.toggle('on', i < ab.charges);
      (o.firstElementChild as HTMLElement).style.height = i === ab.charges ? `${(ab.regen / ab.regenTime) * 100}%` : '0';
    }
    const ch = this.els.cheer.children;
    for (let i = 0; i < ch.length; i++) {
      const o = ch[i] as HTMLElement;
      o.classList.toggle('on', i < ab.mist);
      (o.firstElementChild as HTMLElement).style.height = i === ab.mist ? `${(ab.mistRegen / ab.mistTime) * 100}%` : '0';
    }
    g.loadout.forEach((id, i) => {
      const s = this.els[`s${i}`];
      s.classList.toggle('active', ab.active === id);
      s.classList.toggle('dim', ab.charges <= 0 && ab.active !== id);
    });

    // focus prompt
    const f = g.focus;
    let promptHtml = '';
    if (g.carrying) promptHtml = `${kbd('LMB')} Throw &nbsp; ${kbd('RMB')} Drop`;
    if (f) {
      const p = f.prompt(g);
      if (g.focusBlocked) promptHtml = `<span class="dim">${esc(g.focusBlocked)}</span>`;
      else if (p) {
        const key = f.verb() === 'sight' ? (ab.keyFor('sight') ?? '') : 'E';
        promptHtml = `${kbd(key)} ${f.hold > 0 ? '<span class="dim">hold</span> ' : ''}${esc(p)}`;
      }
    }
    if (g.hiding) promptHtml = `${kbd('E')} Leave hiding spot`;
    if (g.playerState.inBox) promptHtml = `${kbd('E')} Climb out of the box`;
    if (ab.active === 'possess') promptHtml = `${kbd('W')}${kbd('A')}${kbd('S')}${kbd('D')} Pop out of the pumpkin`;
    if (ab.active === 'sight') promptHtml = `${kbd('F')} Tag person &nbsp; ${kbd('WASD')} Return to your body`;
    if (promptHtml !== this.lastPrompt) {
      this.lastPrompt = promptHtml;
      this.els.prompt.innerHTML = promptHtml;
      this.els.prompt.classList.toggle('hidden', !promptHtml);
      this.els.prompt.classList.toggle('blocked', !!g.focusBlocked && !g.carrying);
    }
    this.els.cross.classList.toggle('focus', !!f && !g.focusBlocked);
    const ring = this.els.ring as unknown as SVGCircleElement;
    ring.style.strokeDashoffset = String(119.4 * (1 - g.holdProgress));
    this.els.ringSvg.style.opacity = g.holdProgress > 0 ? '1' : '0';

    // hide vignette
    const hc = g.hiding ? g.hiding.def.kind : g.playerState.inBox ? 'box' : '';
    if (hc !== this.hideClass) {
      this.hideClass = hc;
      this.els.vignette.className = `vignette-hide ${hc} ${hc ? 'on' : ''}`;
      this.els.vlabel.textContent = hc ? (hc === 'box' ? 'Inside a cardboard box' : 'Hidden') : '';
    }
    this.els.cross.style.opacity = g.hiding || ab.active === 'possess' ? '0' : '1';

    this.updateMarkers(g);
  }

  private project(g: Game, p: THREE.Vector3) {
    const cam = g.player.camera;
    const v = p.clone().project(cam);
    const behind = v.z > 1;
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight, behind, on: !behind && Math.abs(v.x) < 1 && Math.abs(v.y) < 1 };
  }

  private updateMarkers(g: Game) {
    const sightMode = g.abilities.active === 'sight';
    const seen = new Set<string>();
    for (const n of g.npcs) {
      const id = n.def.id;
      const aw = n.awareness;
      const tagged = g.abilities.tagged.has(id);
      const showAw = aw > 0.05 || n.state === 'stunned' || n.state === 'woken';
      if (!showAw && !sightMode && !tagged) continue;
      const head = n.body.headWorld().add(new THREE.Vector3(0, 0.35, 0));
      const pr = this.project(g, head);
      let el = this.markers.get(id);
      if (!el) {
        el = h('div', { class: 'marker' });
        this.els.markers.append(el);
        this.markers.set(id, el);
      }
      seen.add(id);
      const dist = n.pos.distanceTo(g.player.pos);
      if (pr.on) {
        el.className = 'marker';
        el.style.left = `${pr.x}px`;
        el.style.top = `${pr.y}px`;
        let inner = '';
        if (n.state === 'stunned') inner = '<div class="zz">💤</div>';
        else if (n.state === 'alert') inner = '<div class="q alert">!</div>';
        else if (n.state === 'search' || n.state === 'investigate') inner = '<div class="q sus">?</div>';
        else if (aw > 0.05) inner = `<div class="q sus">?</div><div class="meter"><span style="width:${Math.min(100, aw * 100)}%"></span></div>`;
        if (sightMode || tagged) {
          el.classList.add('tag');
          inner += `<div class="dot"></div>${esc(n.name)} · ${dist.toFixed(0)}m`;
        }
        el.innerHTML = inner;
      } else if (n.state === 'alert' || aw > 0.25) {
        // off-screen arrow at the edge pointing toward them
        const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
        let dx = pr.x - cx, dy = pr.y - cy;
        if (pr.behind) { dx = -dx; dy = -dy; }
        const a = Math.atan2(dy, dx);
        el.className = 'marker';
        el.style.left = `${cx + Math.cos(a) * cx * 0.88}px`;
        el.style.top = `${cy + Math.sin(a) * cy * 0.8}px`;
        el.innerHTML = `<div class="edge ${n.state === 'alert' ? 'alert' : ''}" style="transform: rotate(${a + Math.PI / 2}rad)"></div>`;
      } else {
        el.innerHTML = '';
      }
    }
    for (const [id, el] of this.markers) if (!seen.has(id)) { el.remove(); this.markers.delete(id); }

    // green wisps over Spirit Sight decorations
    const hasSight = !!g.abilities.keyFor('sight');
    for (const i of g.interactables) {
      if (!(i instanceof SightToy)) continue;
      let el = this.toyMarkers.get(i);
      const show = hasSight && !sightMode && i.pos.distanceTo(g.player.pos) < 14;
      if (!show) { if (el) el.style.display = 'none'; continue; }
      const pr = this.project(g, i.pos.clone().add(new THREE.Vector3(0, 0.25, 0)));
      if (!el) {
        el = h('div', { class: 'marker diamond' }, '✦');
        this.els.markers.append(el);
        this.toyMarkers.set(i, el);
      }
      el.style.display = pr.on ? '' : 'none';
      el.style.left = `${pr.x}px`;
      el.style.top = `${pr.y}px`;
    }
  }

  toast(text: string, kind = '') {
    const el = h('div', { class: `toast glass ${kind}` }, text);
    this.toastsEl.append(el);
    while (this.toastsEl.children.length > 4) this.toastsEl.firstElementChild?.remove();
    window.setTimeout(() => el.classList.add('out'), 4200);
    window.setTimeout(() => el.remove(), 4700);
  }

  clueFound(c: ClueDef) {
    const el = h('div', { class: 'toast glass clue' });
    el.innerHTML = `<span class="ic">${CATEGORY_ICON[c.category]}</span><div><span class="eyebrow">New clue</span><b>${esc(c.title)}</b><span class="dim" style="font-size:.8rem">Press ${kbd('Tab')} to review your journal</span></div>`;
    this.toastsEl.append(el);
    window.setTimeout(() => el.classList.add('out'), 5200);
    window.setTimeout(() => el.remove(), 5700);
  }

  subtitle(speaker: string, text: string, seconds: number, color = '#ffd36e') {
    if (!settings.subtitles) return;
    const el = h('div', { class: 'line' });
    el.innerHTML = `<b style="color:${color}">${esc(speaker)}:</b>${esc(text)}`;
    this.subs.append(el);
    while (this.subs.children.length > 3) this.subs.firstElementChild?.remove();
    window.setTimeout(() => el.classList.add('out'), seconds * 1000);
    window.setTimeout(() => el.remove(), seconds * 1000 + 450);
  }

  flashSlot(i: number) {
    const s = this.els[`s${i}`];
    if (!s) return;
    s.classList.remove('flash');
    void s.offsetWidth;
    s.classList.add('flash');
  }

  hint(text: string | null) {
    const el = this.els.hint;
    if (!text) { el.classList.add('hidden'); return; }
    if (this.els.hintTxt.innerHTML !== text) {
      this.els.hintTxt.innerHTML = text;
      el.classList.remove('hidden');
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = '';
    }
  }

  clear() {
    this.subs.innerHTML = '';
    this.toastsEl.innerHTML = '';
    this.els.markers.innerHTML = '';
    this.markers.clear();
    this.toyMarkers.clear();
    this.lastPrompt = '';
  }
}

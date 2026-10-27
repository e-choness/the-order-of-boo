// Modal overlays during play: 3D object inspection and readable notes.

import * as THREE from 'three';
import type { GameUI } from '../game/game';
import type { Input } from '../core/input';
import { h, esc, kbd, CATEGORY_ICON } from './dom';
import { audio } from '../core/audio';

export class Overlays implements GameUI {
  private root: HTMLElement;
  private open: { close: () => void } | null = null;
  private inspR: THREE.WebGLRenderer | null = null;
  private inspScene = new THREE.Scene();
  private inspCam = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
  private inspObj: THREE.Object3D | null = null;
  private rot = { x: 0.3, y: 0 };
  private openedAt = 0;

  constructor(parent: HTMLElement, private input: Input) {
    this.root = h('div', { class: 'layer' });
    parent.append(this.root);
    const key = new THREE.DirectionalLight(0xfff1d8, 2.6);
    key.position.set(2, 3, 2);
    const rim = new THREE.DirectionalLight(0x9db8ff, 1.6);
    rim.position.set(-3, 1, -2);
    this.inspScene.add(key, rim, new THREE.AmbientLight(0xffffff, 0.6));
  }

  isModalOpen() { return !!this.open; }

  /** Called every frame by the app while a modal is open. */
  update(dt: number) {
    if (!this.open) return;
    const inp = this.input;
    if (this.inspObj && this.inspR) {
      this.rot.y += inp.mouseDX * 0.01 + dt * 0.4;
      this.rot.x = THREE.MathUtils.clamp(this.rot.x + inp.mouseDY * 0.01, -1.2, 1.2);
      this.inspObj.rotation.set(this.rot.x, this.rot.y, 0);
      this.inspR.render(this.inspScene, this.inspCam);
    }
    if (performance.now() - this.openedAt > 350 && (inp.wasPressed('KeyE') || inp.wasPressed('Space') || inp.wasPressed('Escape') || inp.wasPressed('Mouse0') || inp.wasPressed('Backspace') || inp.wasPressed('Tab'))) {
      this.open.close();
    }
  }

  forceClose() { this.open?.close(); }

  inspect(d: { title: string; text: string; object?: THREE.Object3D; category: string }, onClose: () => void) {
    this.openedAt = performance.now();
    const back = h('div', { class: 'modal-back' });
    const wrap = h('div', { class: 'inspect' });
    const canvasWrap = h('div');
    if (d.object) {
      if (!this.inspR) {
        this.inspR = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.inspR.setPixelRatio(Math.min(2, window.devicePixelRatio));
        this.inspR.setSize(420, 420, false);
        this.inspR.outputColorSpace = THREE.SRGBColorSpace;
        this.inspR.toneMapping = THREE.ACESFilmicToneMapping;
      }
      const obj = d.object.clone(true);
      obj.position.set(0, 0, 0);
      obj.rotation.set(0, 0, 0);
      const holder = new THREE.Group();
      holder.add(obj);
      const box = new THREE.Box3().setFromObject(obj);
      const size = box.getSize(new THREE.Vector3()).length();
      obj.position.sub(box.getCenter(new THREE.Vector3()));
      this.inspObj = holder;
      this.inspScene.add(holder);
      this.inspCam.position.set(0, 0, size * 2.1);
      this.inspCam.lookAt(0, 0, 0);
      this.inspR.domElement.style.cssText = '';
      canvasWrap.append(this.inspR.domElement);
      this.rot = { x: 0.35, y: 0.4 };
    }
    const card = h('div', { class: 'card glass' });
    card.innerHTML = `<span class="eyebrow">${CATEGORY_ICON[d.category] ?? ''} Evidence</span><h3>${esc(d.title)}</h3><p>${esc(d.text)}</p>
      <div class="close-hint">${kbd('E')} Pocket it &nbsp;·&nbsp; move the mouse to turn it over</div>`;
    if (d.object) wrap.append(canvasWrap);
    wrap.append(card);
    back.append(wrap);
    this.root.append(back);
    audio.play('sfx/book_open', { bus: 'ui', volume: 0.35 });
    this.open = {
      close: () => {
        back.remove();
        if (this.inspObj) this.inspScene.remove(this.inspObj);
        this.inspObj = null;
        this.open = null;
        audio.play('sfx/pickup', { bus: 'ui', volume: 0.4 });
        this.input.clear();
        onClose();
      },
    };
  }

  note(d: { title: string; body: string; paper: string }, onClose: () => void) {
    this.openedAt = performance.now();
    const back = h('div', { class: 'modal-back' });
    const wrap = h('div', { class: 'note-wrap' });
    const paper = h('div', { class: `note-paper ${d.paper}` });
    paper.innerHTML = `${d.paper === 'drawing' || d.paper === 'list' ? '<div class="tape"></div>' : ''}<h3>${esc(d.title)}</h3><div class="body">${esc(d.body)}</div>`;
    wrap.append(paper, h('div', { class: 'close-hint', html: `${kbd('E')} Put it back` }));
    back.append(wrap);
    this.root.append(back);
    this.open = {
      close: () => {
        back.remove();
        this.open = null;
        audio.play('sfx/page', { bus: 'ui', volume: 0.4 });
        this.input.clear();
        onClose();
      },
    };
  }
}

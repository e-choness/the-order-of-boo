// Persistent player settings (localStorage, wrapped so private windows still work).

export type Quality = 'low' | 'medium' | 'high' | 'ultra';

export interface Settings {
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  sensitivity: number;
  invertY: boolean;
  fov: number;
  quality: Quality;
  subtitles: boolean;
  subtitleSize: 'small' | 'medium' | 'large';
  reduceMotion: boolean;
  headBob: boolean;
  showVisionCones: boolean;
  crouchToggle: boolean;
}

const KEY = 'boo.settings.v1';

export const defaultSettings: Settings = {
  masterVolume: 0.8,
  musicVolume: 0.55,
  sfxVolume: 0.9,
  sensitivity: 1,
  invertY: false,
  fov: 78,
  quality: 'high',
  subtitles: true,
  subtitleSize: 'medium',
  reduceMotion: false,
  headBob: true,
  showVisionCones: true,
  crouchToggle: true,
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaultSettings, ...JSON.parse(raw) };
  } catch { /* storage unavailable */ }
  return { ...defaultSettings };
}

type Listener = (s: Settings) => void;
const listeners = new Set<Listener>();

export const settings: Settings = load();

export function updateSettings(patch: Partial<Settings>) {
  Object.assign(settings, patch);
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* ignore */ }
  listeners.forEach((l) => l(settings));
}

export function onSettings(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}

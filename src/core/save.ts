// Mission progress: which missions are unlocked and the best result for each.

export interface MissionRecord {
  completed: boolean;
  bestEnding?: 'promotion' | 'recognition' | 'demotion';
  bestRank?: number; // 0..5 stars
  bestTime?: number; // seconds
  ghost?: boolean;
}

interface SaveData {
  missions: Record<string, MissionRecord>;
  seenIntro: boolean;
  totalCandy: number;
}

const KEY = 'boo.save.v1';

function load(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { missions: {}, seenIntro: false, totalCandy: 0, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { missions: {}, seenIntro: false, totalCandy: 0 };
}

export const save: SaveData = load();

export function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(save)); } catch { /* ignore */ }
}

export function recordMission(id: string, rec: MissionRecord) {
  const prev = save.missions[id];
  const order = { promotion: 3, recognition: 2, demotion: 1 } as const;
  const better = (a?: MissionRecord['bestEnding'], b?: MissionRecord['bestEnding']) =>
    (a ? order[a] : 0) >= (b ? order[b] : 0) ? a : b;
  save.missions[id] = {
    completed: (prev?.completed ?? false) || rec.completed,
    bestEnding: better(rec.bestEnding, prev?.bestEnding),
    bestRank: Math.max(prev?.bestRank ?? 0, rec.bestRank ?? 0),
    bestTime: rec.completed
      ? Math.min(prev?.bestTime ?? Infinity, rec.bestTime ?? Infinity)
      : prev?.bestTime,
    ghost: (prev?.ghost ?? false) || (rec.ghost ?? false),
  };
  persist();
}

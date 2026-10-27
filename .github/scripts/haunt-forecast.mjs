// Daily README refresh: Halloween countdown, tonight's moon phase, a seeded
// "haunting forecast" and a Boo field tip. Rewrites the blocks between
// <!-- haunt:start --> / <!-- haunt:end --> and <!-- tip:start --> / <!-- tip:end -->.
import fs from 'node:fs';

const file = new URL('../../README.md', import.meta.url);
const now = new Date(process.env.HAUNT_DATE ?? Date.now());
const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

// ---- countdown to Halloween (31 Oct)
let hallow = Date.UTC(now.getUTCFullYear(), 9, 31);
if (today > hallow) hallow = Date.UTC(now.getUTCFullYear() + 1, 9, 31);
const days = Math.round((hallow - today) / 86400000);
let label, message, color;
if (days === 0) [label, message, color] = ['🎃 It’s', 'HALLOWEEN — Boos deployed!', 'E8631C'];
else if (days === 1) [label, message, color] = ['🕯️ Halloween is', 'TOMORROW', 'B8233A'];
else [label, message, color] = ['🎃 Halloween in', `${days} days`, 'E8631C'];

// ---- moon phase (synodic month from a known new moon)
const synodic = 29.530588853;
const knownNew = Date.UTC(2000, 0, 6, 18, 14);
const age = (((now.getTime() - knownNew) / 86400000) % synodic + synodic) % synodic;
const phases = [
  [1.84566, '🌑', 'New moon — perfect haunting darkness'],
  [5.53699, '🌒', 'Waxing crescent'],
  [9.22831, '🌓', 'First quarter'],
  [12.91963, '🌔', 'Waxing gibbous'],
  [16.61096, '🌕', 'FULL MOON — werewolves on duty, stick to the shadows'],
  [20.30228, '🌖', 'Waning gibbous'],
  [23.99361, '🌗', 'Last quarter'],
  [27.68493, '🌘', 'Waning crescent'],
  [synodic + 1, '🌑', 'New moon — perfect haunting darkness'],
];
const [, moonIcon, moonName] = phases.find(([lim]) => age < lim);
const lit = Math.round((1 - Math.cos((age / synodic) * 2 * Math.PI)) / 2 * 100);

// ---- seeded forecast (same all day, different every day)
let seed = Math.floor(today / 86400000);
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const weather = pick(['🌫️ Thick ground fog', '🍂 Gusty, leaves everywhere', '🌧️ Drizzle on the windowpanes', '🌙 Clear and cold', '⛈️ Distant thunder', '🦇 Bats on the move', '💨 Howling chimney drafts']);
const spirits = Math.round(40 + rnd() * 60);
const cats = pick(['very suspicious', 'mildly suspicious', 'asleep (for now)', 'staring at nothing', 'knocking things off shelves']);
const candy = pick(['plentiful', 'dangerously low', 'guarded by a toddler', 'all raisins (tragic)', 'hidden on top of the fridge']);

const TIPS = [
  'Rugs and carpets muffle your sheet-swishing. Kitchen tiles do not.',
  'Snuff a candle to make a pool of shadow — someone may notice and light it again.',
  'Dogs can smell you while you Fade. Cats can SEE you. Bring treats.',
  'Motion-sensor skeletons only see you while you move. Freeze!',
  'Old evidence can lie. Check the dates and the handwriting.',
  'Candy bowls restore ectoplasm. The sign says “take ONE”.',
  'A puff of Slumber Mist hides you as well as sending people to dreamland.',
  'Doors block sight. Close one behind you and you buy yourself a moment.',
  'Possess a jack-o’-lantern and stay perfectly still — nobody suspects a pumpkin.',
  'Thrown potions shatter loudly — a perfect distraction, and a mess someone must clean.',
];
const tip = TIPS[Math.floor(today / 86400000) % TIPS.length];

const enc = (s) => encodeURIComponent(s).replace(/-/g, '--').replace(/_/g, '__');
const badge = (l, m, c, alt) => `<img alt="${alt}" src="https://img.shields.io/badge/${enc(l)}-${enc(m)}-${c}?style=for-the-badge">`;
const dateStr = new Date(today).toISOString().slice(0, 10);
const haunt = `<p align="center">
  ${badge(label, message, color, 'Countdown to Halloween')}
  ${badge(`${moonIcon} Moon`, `${lit}% lit`, '5A3A7A', 'Moon phase')}
  ${badge('👻 Spirit activity', `${spirits}%`, '2F6A3A', 'Spirit activity')}
</p>

| 🔮 Haunting forecast for ${dateStr} | |
| --- | --- |
| Moon | ${moonIcon} ${moonName} |
| Weather | ${weather} |
| Household cats | ${cats} |
| Candy supply | ${candy} |`;

const src = fs.readFileSync(file, 'utf8');
let out = src.replace(/<!-- haunt:start -->[\s\S]*?<!-- haunt:end -->/, `<!-- haunt:start -->\n${haunt}\n<!-- haunt:end -->`);
out = out.replace(/<!-- tip:start -->[\s\S]*?<!-- tip:end -->/, `<!-- tip:start -->\n> 🕯️ **Boo field tip of the day:** ${tip}\n<!-- tip:end -->`);
if (out !== src) {
  fs.writeFileSync(file, out);
  console.log(`Updated: ${label} ${message} · ${moonName} · ${weather}`);
} else console.log('No change');

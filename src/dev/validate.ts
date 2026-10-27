// Developer validation of level data: reachability and placement sanity.
import * as THREE from 'three';
import { LEVELS } from '../levels';
import { Level } from '../world/level';
import { F } from '../world/physics';

export async function validateLevel(id: string) {
  const def = LEVELS.find((l) => l.id === id)!;
  const lv = new Level(def);
  await lv.load(0);
  const issues: string[] = [];
  const nav = lv.nav;
  const w = lv.world;
  const surfaceAt = (x: number, z: number, y: number) => w.groundHeight(x, z, 0.05, y, 0.12).y;
  const insideSolid = (x: number, y: number, z: number) =>
    w.query(x - 0.01, z - 0.01, x + 0.01, z + 0.01, F.MOVE).some((c) => y > c.min.y + 0.02 && y < c.max.y - 0.02 && x > c.min.x && x < c.max.x && z > c.min.z && z < c.max.z);

  // player
  const p = def.player;
  if (!nav.walkable(p.x, p.z)) issues.push(`player spawn not walkable (${p.x},${p.z})`);
  // NPCs
  for (const n of def.npcs) {
    const start = new THREE.Vector3(n.start[0], 0, n.start[1]);
    for (const a of n.activities) {
      const to = new THREE.Vector3(a.at[0], 0, a.at[1]);
      const path = nav.findPath(start, to);
      if (!path) issues.push(`${n.id}: no path to activity ${a.anim} @${a.at}`);
      else {
        const end = path[path.length - 1];
        const d = Math.hypot(end.x - to.x, end.z - to.z);
        if (d > 0.9 && !['sit', 'tv', 'read', 'sleep', 'lie', 'carve'].includes(a.anim)) issues.push(`${n.id}: activity ${a.anim} @${a.at} ends ${d.toFixed(2)}m away`);
        if (d > 1.6) issues.push(`${n.id}: activity ${a.anim} @${a.at} far from nav (${d.toFixed(2)}m)`);
      }
    }
  }
  // clue spots
  for (const c of def.clues) {
    const s = c.source;
    if (s.kind === 'item' || s.kind === 'note') {
      for (const [x, y, z] of s.spots) {
        const g = surfaceAt(x, z, y);
        if (Math.abs(g - y) > 0.08 && !(s.kind === 'note' && s.paper === 'screen')) issues.push(`clue ${c.id} spot (${x},${y},${z}) surface is ${g.toFixed(2)}`);
        if (!lv.roomAt(x, z)) issues.push(`clue ${c.id} spot (${x},${z}) outside rooms`);
      }
    }
    if (s.kind === 'container' && !lv.propById.get(s.propId)) issues.push(`clue ${c.id}: missing prop ${s.propId}`);
    if ((s.kind === 'talk' || s.kind === 'sleeptalk') && !def.npcs.some((n) => n.id === s.npc)) issues.push(`clue ${c.id}: missing npc ${s.npc}`);
    if (s.kind === 'conversation' && !def.conversations.some((cv) => cv.id === s.convo)) issues.push(`clue ${c.id}: missing convo ${s.convo}`);
  }
  for (const cv of def.conversations) {
    if (!nav.walkable(cv.where[0], cv.where[1])) issues.push(`convo ${cv.id} spot not walkable`);
  }
  for (const t of def.throwables) {
    const g = surfaceAt(t.x, t.z, t.y);
    if (Math.abs(g - t.y) > 0.08) issues.push(`throwable ${t.kind} (${t.x},${t.y},${t.z}) surface ${g.toFixed(2)}`);
  }
  for (const s of def.sightToys) {
    const g = surfaceAt(s.x, s.z, s.y);
    if (Math.abs(g - s.y) > 0.08) issues.push(`sight toy ${s.id} (${s.x},${s.y},${s.z}) surface ${g.toFixed(2)}`);
  }
  for (const ck of def.candy) {
    const g = surfaceAt(ck.x, ck.z, ck.y);
    if (Math.abs(g - ck.y) > 0.08) issues.push(`candy (${ck.x},${ck.y},${ck.z}) surface ${g.toFixed(2)}`);
  }
  for (const h of def.hides) {
    if (!h.propId && insideSolid(h.x, 0.3, h.z) && h.kind !== 'pumpkins') issues.push(`hide ${h.kind} (${h.x},${h.z}) inside solid`);
    if (h.propId && !lv.propById.get(h.propId)) issues.push(`hide ${h.kind}: missing prop ${h.propId}`);
  }
  // the answer must be one of the wishes, and conversations / talk clues must line up
  if (!def.wishes.some((w) => w.id === def.answer.wish)) issues.push(`answer wish ${def.answer.wish} is not a wish`);
  for (const cv of def.conversations) {
    if (cv.clue && !def.clues.some((c) => c.id === cv.clue)) issues.push(`convo ${cv.id}: missing clue ${cv.clue}`);
    for (const w of cv.who) if (!def.npcs.some((n) => n.id === w)) issues.push(`convo ${cv.id}: missing npc ${w}`);
  }
  for (const pr of def.props) {
    if (!pr.m.startsWith('special/') && !lv.roomAt(pr.x, pr.z)) issues.push(`prop ${pr.m} (${pr.x},${pr.z}) outside rooms`);
  }
  // doors must lie on a wall line between rooms, and not be blocked by furniture
  for (const d of def.doors) {
    const off = 0.45;
    const a = d.axis === 'x' ? [d.x, d.z - off] : [d.x - off, d.z];
    const b = d.axis === 'x' ? [d.x, d.z + off] : [d.x + off, d.z];
    if (!d.locked && (!nav.walkable(a[0], a[1]) || !nav.walkable(b[0], b[1]))) issues.push(`door (${d.x},${d.z}) blocked on one side`);
  }
  // wall decor must not sit on a door or window opening
  for (const d of def.decor ?? []) {
    if (!['frame', 'portrait', 'poster', 'calendar', 'clock', 'wreath'].includes(d.kind)) continue; // paper bats belong on windows
    for (const o of [...def.doors.map((x) => ({ ...x, door: true })), ...def.windows.map((x) => ({ ...x, door: false }))]) {
      const w = (o.width ?? 1) / 2 + 0.3;
      const onLine = o.axis === 'x' ? Math.abs(d.z - o.z) < 0.2 && Math.abs(d.x - o.x) < w : Math.abs(d.x - o.x) < 0.2 && Math.abs(d.z - o.z) < w;
      if (!onLine) continue;
      const top = o.door ? 2.1 : (o.sill ?? 0.8) + (o.height ?? 1.3);
      const bottom = o.door ? 0 : (o.sill ?? 0.8);
      if (d.y > bottom - 0.3 && d.y < top + 0.25 && !(o.door && o.locked && d.kind === 'wreath')) issues.push(`decor ${d.kind} (${d.x},${d.y},${d.z}) overlaps ${o.door ? 'door' : 'window'} (${o.x},${o.z})`);
    }
  }
  // chimney reachable
  const [cx, , cz] = def.chimney;
  if (!nav.findPath(new THREE.Vector3(p.x, 0, p.z), new THREE.Vector3(cx, 0, cz + 0.5))) issues.push('chimney unreachable');
  // ascii nav map (0.25 m cells): '#' blocked, '.' free, letters = NPC starts
  const rows: string[] = [];
  for (let j = 0; j < nav.h; j++) {
    let r = '';
    for (let i = 0; i < nav.w; i++) r += nav.isBlocked(i, j) ? '#' : '.';
    rows.push(r);
  }
  for (const n of def.npcs) {
    const [i, j] = nav.toCell(n.start[0], n.start[1]);
    if (rows[j]) rows[j] = rows[j].slice(0, i) + n.id[0].toUpperCase() + rows[j].slice(i + 1);
  }
  if (nav.pocketCells > 40) issues.push(`nav: ${nav.pocketCells} cells sealed off in pockets`);
  return { id, issues, colliders: w.colliders.length, map: rows.join('\n') };
}

export async function validateAll() {
  const out = [];
  for (const l of LEVELS) out.push(await validateLevel(l.id));
  return out;
}

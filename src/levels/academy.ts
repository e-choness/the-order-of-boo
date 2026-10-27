// Training — Ghost School: Midnight Drill. The Order of B.O.O.'s little
// training cottage in Hollow Hill Cemetery, patrolled by a creaky clockwork
// training skeleton, with step-by-step field instructions.

import type { LevelDef } from './types';

const K = (k: string) => `<span class="kbd">${k}</span>`;

export const academy: LevelDef = {
  id: 'academy',
  index: 0,
  title: 'Ghost School: Midnight Drill',
  subtitle: 'Training cottage · Hollow Hill Cemetery',
  family: 'The Order of B.O.O.',
  child: {
    name: 'Mabel Make-Believe',
    age: 8,
    pronoun: 'she',
    blurb: 'A pretend child invented by the Ghost School for drills. Loves bats, hates broccoli, has never once existed.',
  },
  briefing: [
    'Welcome, fledgling Boo. Before we send you down a real chimney on Halloween night, you’ll run the Midnight Drill in our training cottage on Hollow Hill.',
    'Sergeant Rattlebones plays the part of a parent. He is slow, squeaks at every joint, and will absolutely tell the Headghost if he spots so much as a hem of your sheet.',
    'Follow the field instructions in the corner of your eye. Find at least three clues about “Mabel”, then float back up the chimney to file your very first report.',
  ],
  minutes: 12,
  clockStart: [21, 0],
  clockEnd: [24, 0],
  bounds: [0, 0, 10, 8],
  exterior: { style: 'academy' },
  rooms: [
    { id: 'hall', name: 'Drill Parlour', x: 0, z: 0, w: 6, d: 5, floor: 'woodDark', wall: 'moons', wallColor: '#4a2f4f', accent: '#e8a33d', cobwebs: true },
    { id: 'bed', name: 'Pretend Bedroom', x: 6, z: 0, w: 4, d: 5, floor: 'carpet', wall: 'bats', wallColor: '#23304f', accent: '#f2b84b' },
    { id: 'corr', name: 'Creaky Corridor', x: 0, z: 5, w: 10, d: 3, floor: 'tile', wall: 'stripes', wallColor: '#d8ccb2', accent: '#4f6b3a', cobwebs: true },
  ],
  doors: [
    { x: 6, z: 2.5, axis: 'z', width: 1, leaf: true, open: false },
    { x: 1.5, z: 5, axis: 'x', width: 1.4 },
    { x: 8, z: 5, axis: 'x', width: 1, leaf: true, open: true },
    { x: 0, z: 6.5, axis: 'z', width: 1.1, leaf: true, locked: true },
  ],
  windows: [
    { x: 1.2, z: 0, axis: 'x', width: 1.2, curtains: '#3f5a33' },
    { x: 8, z: 0, axis: 'x', width: 1.2, curtains: '#d9792b' },
    { x: 10, z: 6.5, axis: 'z', width: 1.2 },
    { x: 5, z: 8, axis: 'x', width: 1.6 },
  ],
  props: [
    { m: 'special/fireplace', x: 3.4, z: 0.42, rot: 0 },
    { m: 'furniture/rugRound', x: 3.2, z: 2.8, tint: { carpet: '#5b2a5e', carpetWhite: '#5b2a5e' } },
    { m: 'furniture/loungeChair', x: 1.0, z: 2.8, rot: 90, tint: { carpet: '#3f5a33' } },
    { m: 'furniture/cardboardBoxClosed', x: 4.9, z: 3.8, rot: 10, s: 1.6, climb: true },
    { m: 'furniture/tableCoffee', x: 3.2, z: 2.8, rot: 0 },
    { m: 'furniture/bookcaseOpen', x: 5.6, z: 0.35, rot: 0 },
    { m: 'spooky/cauldron', x: 0.7, z: 4.3, rot: 0 },
    { m: 'spooky/gourds', x: 0.35, z: 3.7, rot: 30 },
    { m: 'spooky/broom', x: 5.75, z: 4.7, rot: 200 },
    { m: 'spooky/pumpkin', x: 2.1, z: 0.4, rot: 15 },
    // pretend bedroom
    { m: 'furniture/bedSingle', x: 9.4, z: 3.0, rot: 0, tint: { carpet: '#4a2f4f' }, id: 'mockBed' },
    { m: 'furniture/cabinetBedDrawerTable', x: 9.6, z: 4.6, rot: 270, id: 'mockNightstand' },
    { m: 'furniture/desk', x: 9.3, z: 1.0, rot: 270, id: 'mockDesk' },
    { m: 'furniture/chairDesk', x: 8.6, z: 1.0, rot: 90 },
    { m: 'furniture/bookcaseClosedDoors', x: 6.5, z: 0.3, rot: 0, id: 'mockCloset' },
    // corridor
    { m: 'furniture/rugRectangle', x: 5, z: 6.5, rot: 90, s: 1.1, tint: { carpet: '#c4621f', carpetWhite: '#c4621f' } },
    { m: 'furniture/coatRackStanding', x: 0.4, z: 7.6, rot: 0 },
    { m: 'furniture/sideTableDrawers', x: 3.0, z: 7.6, rot: 180, id: 'corrDrawers' },
    { m: 'spooky/gravestone', x: 9.6, z: 7.6, rot: 270 },
  ],
  lights: [
    { id: 'fire', kind: 'fire', x: 3.4, z: 0.75, y: 0.55, color: '#ff9a3c' },
    { id: 'jack', kind: 'lantern', x: 1.15, z: 3.95, y: 0 },
    { id: 'lamp', kind: 'floorLamp', x: 2.2, z: 4.4, switchable: true, watched: true },
    { id: 'bedNight', kind: 'nightlight', x: 9.6, z: 4.6, y: 0.62, color: '#c9a3ff' },
    { id: 'corrCeil', kind: 'ceiling', x: 5, z: 6.5, switchable: true, watched: true },
    { id: 'corrWall', kind: 'wallLamp', x: 8.5, z: 7.88, rot: 180 },
    { id: 'bedJack', kind: 'lantern', x: 7.2, z: 4.6, y: 0 },
  ],
  decor: [
    { kind: 'bunting', x: 3.4, y: 1.95, z: 0.12, rot: 0, color: '#e8a33d', label: 'BOO!' },
    { kind: 'poster', x: 0.09, y: 1.6, z: 2.0, rot: 90, label: 'SNEAK SOFTLY' },
    { kind: 'clock', x: 5, y: 1.95, z: 5.08, rot: 0 },
    { kind: 'garland', x: 3.4, y: 2.45, z: 0.1, rot: 0 },
    { kind: 'portrait', x: 9.3, y: 1.6, z: 0.08, rot: 0 },
    { kind: 'bat', x: 5, y: 1.9, z: 7.92, rot: 180 },
    { kind: 'cobweb', x: 0.1, y: 2.5, z: 0.1, rot: 0 },
    { kind: 'calendar', x: 5.92, y: 1.5, z: 4.0, rot: 270 },
  ],
  npcs: [
    {
      id: 'bones', name: 'Sergeant Rattlebones', kind: 'adult', voice: 0.65, sight: 0.8, speed: 0.75,
      skin: { base: 'robot', shirt: '#e9e1c8', pants: '#3a3340', pattern: 'stripes', patternColor: '#2a2430' },
      costume: 'skeleton',
      start: [8, 6.5],
      activities: [
        { at: [8.2, 6.5], face: 270, anim: 'look', min: 6, max: 9, weight: 2, say: 'Corridor inspected. Dust: acceptable. Ghosts: none. Tea: overdue.' },
        { at: [1.6, 6.6], face: 90, anim: 'stand', min: 4, max: 7, weight: 2, say: '*creeeak* Do mind the floorboards, sir. Or madam. Or sheet.' },
        { at: [8.0, 2.2], face: 180, anim: 'look', min: 5, max: 8, weight: 2, say: 'Looking in on the pretend child. Still pretend. Very good.' },
        { at: [3.2, 3.9], face: 180, anim: 'stand', min: 4, max: 7, weight: 1, say: 'Fire at regulation crackle. Carry on, fire.' },
      ],
      barks: {
        suspicious: ['*tick-tick* Was that a draught, or a recruit?', 'Hmm. My left kneecap senses a bedsheet.', 'Must be the wind… the wind does NOT wear a sheet.'],
        alert: ['BOO SIGHTED! Drop and give me twenty floats!', 'I SEE YOU, RECRUIT! (This is a drill. Do carry on panicking.)'],
        giveUp: ['Lost the little blighter. Splendid sneaking, I suppose.', 'Returning to patrol. Someone oil my hips.'],
        lamp: ['Who put the lamp out? Darkness is for graduates!', 'Lights back on, if you please. Regulations.'],
        broken: ['Was that a potion? On the GOOD rug?', 'Mess in the parlour! Fetching my dustpan, at a stately pace.'],
      },
    },
  ],
  clues: [
    {
      id: 'tLetter', title: 'Draft letter to Old Jack', category: 'wish', points: 'bat',
      text: '“Dear Old Jack, this Halloween I wish for a PLUSH BAT with velvet wings. I will call him Count Snuggles.”',
      source: { kind: 'note', paper: 'letter', spots: [[9.3, 0.765, 1.0]], body: 'Dear Old Jack o\' the Lantern,\n\nThis Halloween I wish for a PLUSH BAT\nwith soft velvet wings. I will call him\nCount Snuggles and he will sleep\nupside down on my bedpost.\n\nNot a broomstick. Broomsticks are splintery.\n\nLove, Mabel\n(Ghost School drill sheet #1)' },
    },
    {
      id: 'tBroom', title: 'Broomstick catalogue page', category: 'wish', points: 'broom',
      text: 'A page about the Nimbus-Not Junior Broomstick. Someone has written “for the Sergeant?” on it — not Mabel’s handwriting.',
      source: { kind: 'note', paper: 'list', spots: [[3.4, 0.465, 2.6]], body: 'NIMBUS-NOT JUNIOR BROOMSTICK\n“Hovers up to 4 inches!”\n\n…scribbled in the margin, very neat grown-up handwriting:\n“for the Sergeant? He keeps borrowing\nthe training broom to dust the rafters”' },
    },
    {
      id: 'tChores', title: 'Good-deed chart', category: 'deed', points: 'treat',
      text: 'A good-deed chart with a gold star for every day of October. “Fed the graveyard crows” appears a lot.',
      source: { kind: 'container', propId: 'mockNightstand', inspect: 'A folded good-deed chart: a gold star for every single day of October. “Fed the graveyard crows”, “Shared my candy corn”, “Said goodnight to the gravestones”. Exemplary — for a pretend child.' },
    },
    {
      id: 'tBatDraw', title: 'Bat drawing', category: 'wish', points: 'bat',
      text: 'A crayon drawing of a fuzzy purple bat, labelled “COUNT SNUGGLES — COMING SOON”.',
      source: { kind: 'item', model: 'special/photo', spots: [[3.0, 0.765, 7.6], [5.6, 1.76, 0.35]], inspect: 'A crayon drawing in a little frame: a round purple bat with enormous ears and a tiny cape. Labelled in wobbly letters: “COUNT SNUGGLES — COMING SOON”.' },
    },
    {
      id: 'tSarge', title: 'Overheard: Sergeant Rattlebones', category: 'rumor', points: 'bat',
      text: 'The Sergeant muttered that “Mabel” has wished for a plush bat in every drill since 1887.',
      source: { kind: 'conversation', convo: 'sarge' },
    },
  ],
  conversations: [
    {
      id: 'sarge', at: 60, where: [5.5, 6.5], who: ['bones'], clue: 'tSarge',
      lines: [
        ['bones', '*creak* Ahem. Reciting drill notes for the benefit of any lurking recruits.'],
        ['bones', 'Pretend child “Mabel” has wished for a plush bat in every drill since 1887. I was there. My knees remember.'],
        ['bones', 'Behaviour: impeccable. Handwriting: atrocious. Ledger: you work it out, recruit.'],
      ],
    },
  ],
  throwables: [
    { model: 'spooky/potion', x: 3.1, y: 0.46, z: 2.95, kind: 'potion' },
    { model: 'furniture/books', x: 5.6, y: 1.76, z: 0.35, kind: 'book' },
  ],
  hides: [
    { kind: 'closet', x: 6.5, z: 0.3, rot: 0, propId: 'mockCloset' },
    { kind: 'box', x: 2.4, z: 7.3, rot: 0 },
    { kind: 'underBed', x: 9.4, z: 3.0, rot: 270, propId: 'mockBed' },
  ],
  sightToys: [
    { id: 'skull1', name: 'Skull (mantel)', model: 'spooky/skull', x: 2.8, y: 1.29, z: 0.72 },
    { id: 'cat1', name: 'Cat statue (bedroom desk)', model: 'spooky/catStatue', x: 9.35, y: 0.765, z: 1.6, rot: 270 },
  ],
  candy: [{ x: 3.6, y: 0.465, z: 2.95 }],
  wishes: [
    { id: 'bat', name: 'Plush Bat “Count Snuggles”', icon: '🦇', blurb: 'Velvet wings. Sleeps upside down. Extremely huggable.' },
    { id: 'broom', name: 'Nimbus-Not Junior Broomstick', icon: '🧹', blurb: 'Hovers up to four whole inches.' },
    { id: 'cauldron', name: 'Bubbling Potion Kit', icon: '🧪', blurb: 'Fizzes green. Smells of lemonade.' },
    { id: 'hat', name: 'Starry Witch Hat', icon: '🎩', blurb: 'Pointy, purple and slightly too big.' },
    { id: 'ball', name: 'Crystal Ball', icon: '🔮', blurb: 'Mostly shows your own nose.' },
    { id: 'raisin', name: 'A Single Raisin', icon: '🍇', blurb: 'Traditional. Deeply disappointing.' },
  ],
  answer: { wish: 'bat', ledger: 'treat' },
  minCluesForReport: 3,
  player: { x: 3.4, z: 1.45, rot: 0 },
  chimney: [3.4, 0, 0.6],
  creaks: [[4.0, 6.6], [6.5, 6.2]],
  tutorial: [
    { id: 'move', until: 'move', text: `Welcome, fledgling Boo! Use ${K('W')}${K('A')}${K('S')}${K('D')} to drift about and the mouse to look around.` },
    { id: 'crouch', until: 'crouch', text: `Press ${K('Q')} or ${K('C')} to crouch. A low-floating Boo is smaller, quieter and harder to spot.` },
    { id: 'jump', until: 'jump', text: `Press ${K('Space')} beside furniture to clamber up — try the big cardboard box by the fire.` },
    { id: 'lamp', until: 'lamp', text: `The gem at the bottom shows how visible you are: brighter means easier to see. Look at the floor lamp and press ${K('E')} to switch it off.` },
    { id: 'clue', until: 'clue', text: `Evidence glints gold. Find a clue and press ${K('E')} to examine it. (Try the catalogue page on the coffee table.)` },
    { id: 'hide', until: 'hide', text: `Sergeant Rattlebones patrols the corridor. Hide in the wardrobe or the box with ${K('E')}. His floor cone shows where he’s looking.` },
    { id: 'misted', until: 'misted', text: `Slumber Mist (${K('Left click')}) sends people nodding off and leaves a dreamy violet cloud to hide in. Mist the Sergeant!` },
    { id: 'report', until: 'never', text: `Find 3 clues (${K('Tab')} opens your journal), then press ${K('E')} at the fireplace to float up the chimney and file your report. Spells are on ${K('1')} and ${K('2')}.` },
  ],
};

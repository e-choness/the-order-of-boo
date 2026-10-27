// Data format for missions. Coordinates are metres; x → east, z → south.

export type FloorKind = 'wood' | 'woodDark' | 'carpet' | 'carpetRed' | 'carpetGreen' | 'tile' | 'tileCheck' | 'stone';
export type WallKind = 'stripes' | 'damask' | 'plaid' | 'paint' | 'tileWall' | 'logs' | 'brick' | 'stars' | 'bats' | 'moons';

export interface RoomDef {
  id: string;
  name: string;
  x: number; z: number; w: number; d: number;
  floor: FloorKind;
  wall: WallKind;
  wallColor: string;
  accent?: string;
  /** ceiling height, default 2.6 */
  height?: number;
  /** drape cobwebs in the ceiling corners */
  cobwebs?: boolean;
}

export interface OpeningDef {
  x: number; z: number;
  /** wall direction: 'x' = wall runs along x (opening in a north/south wall) */
  axis: 'x' | 'z';
  width?: number;
  /** doors: have a hinged leaf that can be opened/closed */
  leaf?: boolean;
  open?: boolean;
  /** front door / locked */
  locked?: boolean;
  /** windows: sill + height */
  sill?: number;
  height?: number;
  /** curtains on windows */
  curtains?: string;
}

export interface PropDef {
  m: string;            // model path e.g. 'furniture/loungeSofa' or a procedural 'spooky/pumpkin'
  x: number; z: number;
  y?: number;
  rot?: number;         // degrees, 0 = model front faces +z (south)
  s?: number;           // uniform scale multiplier (on top of the kit scale)
  collide?: 'box' | 'none' | 'low';
  climb?: boolean;
  tint?: Record<string, string>; // material name → colour
  /** id used by clues / interactions */
  id?: string;
  /** hidden until something reveals it */
  hidden?: boolean;
}

/** 'lantern' = a carved jack-o'-lantern with a flickering candle (builds its own pumpkin) */
export type LightKind = 'floorLamp' | 'tableLamp' | 'ceiling' | 'wallLamp' | 'lantern' | 'fire' | 'candle' | 'tv' | 'nightlight' | 'fridge';

export interface LightDef {
  id: string;
  kind: LightKind;
  x: number; z: number;
  y?: number;
  rot?: number;
  color?: string;
  intensity?: number;
  range?: number;
  on?: boolean;
  /** can the player toggle it */
  switchable?: boolean;
  /** NPCs will notice if it is off and switch it back on */
  watched?: boolean;
  /** motion sensor light */
  motion?: boolean;
  /** place model? (lamps place their own models) */
  noModel?: boolean;
  shadow?: boolean;
}

export type ClueCategory = 'wish' | 'deed' | 'rumor';

export interface ClueDef {
  id: string;
  title: string;
  category: ClueCategory;
  /** text shown in the journal / inspection */
  text: string;
  /** which wish this clue points to (wishes) or which ledger (deeds) */
  points?: string;
  /** clue weight for the deduction helper; decoys still point somewhere */
  /** how the clue is obtained */
  source:
    | { kind: 'item'; model: string; spots: [number, number, number][]; scale?: number; inspect?: string }
    | { kind: 'note'; model?: string; spots: [number, number, number][]; paper: 'letter' | 'list' | 'report' | 'drawing' | 'receipt' | 'diary' | 'screen'; body: string; scale?: number }
    | { kind: 'container'; propId: string; inspect: string; model?: string }
    | { kind: 'talk'; npc: string; lines: string[] }
    | { kind: 'conversation'; convo: string }
    | { kind: 'sleeptalk'; npc: string; lines: string[] };
}

export interface WishDef {
  id: string;
  name: string;
  blurb: string;
  icon: string; // emoji glyph for the wish card
}

export type Ledger = 'treat' | 'trick';

/** 'animatronic' = a motion-sensor lawn skeleton: it never walks, only notices movement, and shrieks for the humans */
export type NPCKind = 'adult' | 'kid' | 'teen' | 'elder' | 'dog' | 'cat' | 'animatronic';

/** Halloween costume pieces layered on top of the blocky character */
export type Costume = 'witch' | 'vampire' | 'mummy' | 'pumpkin' | 'catEars' | 'devil' | 'wizard' | 'pirate' | 'skeleton' | 'sheetGhost' | 'none';

export interface ActivityDef {
  at: [number, number];
  face?: number;          // degrees
  anim: 'stand' | 'sit' | 'sleep' | 'cook' | 'tv' | 'read' | 'phone' | 'carve' | 'snack' | 'sniff' | 'lie' | 'clean' | 'look';
  min: number; max: number; // seconds
  weight?: number;
  /** optional line said when arriving */
  say?: string;
  /** sit height override */
  seatY?: number;
}

export interface NPCDef {
  id: string;
  name: string;
  kind: NPCKind;
  skin?: import('../core/assets').SkinRecipe;
  costume?: Costume;
  start: [number, number];
  activities: ActivityDef[];
  /** perception multipliers */
  sight?: number;
  hearing?: number;
  /** dog smell radius (smells you through Fade) */
  smell?: number;
  speed?: number;
  /** carries a torch */
  flashlight?: boolean;
  /** starts asleep (kids) */
  asleep?: boolean;
  voice?: number; // pitch
  /** barks/meows alert humans */
  raisesAlarm?: boolean;
  /** pets: can be befriended with this treat item id */
  treat?: string;
  /** pets: dialogue when talked to */
  talk?: string[];
  /** comments they make when suspicious / searching / giving up */
  barks?: { suspicious?: string[]; alert?: string[]; giveUp?: string[]; lamp?: string[]; broken?: string[] };
}

export interface ConversationDef {
  id: string;
  /** mission seconds at which it starts (if participants are calm) */
  at: number;
  where: [number, number];
  who: string[];
  lines: [string, string][]; // [npc id, text]
  clue?: string; // clue id unlocked when the player overhears
}

export interface ThrowableDef {
  model: string;
  x: number; y: number; z: number;
  /** potion bottles shatter, small pumpkins splat; both leave a mess people come to clean */
  kind: 'potion' | 'pumpkin' | 'toy' | 'book' | 'candy' | 'treat' | 'can';
  id?: string;
}

export interface HideDef {
  /** 'pumpkins' builds its own pile of pumpkins at x,z */
  kind: 'box' | 'curtain' | 'underBed' | 'closet' | 'pumpkins';
  x: number; z: number;
  rot?: number;
  /** for closets / under bed: prop id that hosts it */
  propId?: string;
}

export interface SightToyDef {
  id: string;
  model: string;
  x: number; y: number; z: number;
  rot?: number;
  name: string;
  scale?: number;
}

export interface TutorialStep {
  id: string;
  text: string;
  /** condition key evaluated by the game */
  until: string;
}

export interface LevelDef {
  id: string;
  index: number;
  title: string;
  subtitle: string;
  family: string;
  child: { name: string; age: number; blurb: string; pronoun: 'she' | 'he' | 'they' };
  briefing: string[];
  minutes: number;
  /** clock shown on the HUD */
  clockStart: [number, number];
  clockEnd: [number, number];
  bounds: [number, number, number, number]; // minX, minZ, maxX, maxZ of the interior
  rooms: RoomDef[];
  doors: OpeningDef[];
  windows: OpeningDef[];
  props: PropDef[];
  lights: LightDef[];
  npcs: NPCDef[];
  clues: ClueDef[];
  conversations: ConversationDef[];
  throwables: ThrowableDef[];
  hides: HideDef[];
  sightToys: SightToyDef[];
  /** trick-or-treat candy bowls (+1 ecto each candy); y = surface height */
  candy: { x: number; y: number; z: number }[];
  wishes: WishDef[];
  answer: { wish: string; ledger: Ledger };
  minCluesForReport: number;
  player: { x: number; z: number; rot: number };
  chimney: [number, number, number]; // entry + extraction point (the fireplace flue)
  exterior: { style: 'suburb' | 'farm' | 'manor' | 'academy' };
  tutorial?: TutorialStep[];
  /** squeaky floorboards */
  creaks?: [number, number][];
  /** decorative wall pictures etc */
  /**
   * frame = painting · portrait = creepy portrait whose eyes follow you · wreath = twig wreath with an orange bow ·
   * bunting = pennant string spelling `label` (e.g. 'BOO') · garland = bat garland with orange bulbs (2.2 m) ·
   * bat = paper bat cut-outs · cobweb = corner web · clock · poster · calendar (October, 31st circled)
   */
  decor?: { kind: 'frame' | 'portrait' | 'wreath' | 'bunting' | 'garland' | 'clock' | 'poster' | 'calendar' | 'bat' | 'cobweb'; x: number; y: number; z: number; rot: number; color?: string; label?: string }[];
}

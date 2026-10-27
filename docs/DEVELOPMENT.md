<p align="center"><img src="../media-kit/art/banner-1920x480.png" alt="The Order of B.O.O." width="100%"></p>

# The Order of B.O.O. — Development guide

[![Play on itch.io](https://img.shields.io/badge/%E2%96%B6%20Play-itch.io-FA5C5C?style=flat-square&logo=itchdotio&logoColor=white)](https://echoness.itch.io/the-order-of-boo)
[![Play on GitHub Pages](https://img.shields.io/badge/%E2%96%B6%20Play-GitHub%20Pages-222?style=flat-square&logo=github)](https://e-choness.github.io/the-order-of-boo/)
![three.js](https://img.shields.io/github/package-json/dependency-version/e-choness/the-order-of-boo/three?filename=package.json&style=flat-square&logo=threedotjs&label=three.js&color=000000)
![postprocessing](https://img.shields.io/github/package-json/dependency-version/e-choness/the-order-of-boo/postprocessing?filename=package.json&style=flat-square&label=postprocessing)
![Vite](https://img.shields.io/github/package-json/dependency-version/e-choness/the-order-of-boo/dev/vite?filename=package.json&style=flat-square&logo=vite&logoColor=white&label=vite)
![TypeScript](https://img.shields.io/github/package-json/dependency-version/e-choness/the-order-of-boo/dev/typescript?filename=package.json&style=flat-square&logo=typescript&logoColor=white&label=typescript)

A first-person stealth **immersive sim** for Halloween night, built with three.js. You are a small,
polite bedsheet ghost of the Order of B.O.O. Drift down a chimney, gather evidence about one child —
their secret **Midnight Wish** and how they really behaved — then float back up and decide:
**Treat** (Old Jack o' the Lantern) or **Trick** (the Bogeyman)?

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + static build in dist/ (relative paths — works on itch.io and GitHub Pages)
npm run preview
```

Node **24+** (Node **26** recommended — see `.nvmrc`). Play with keyboard and mouse in a desktop browser.

## Design pillars

| Pillar | How it shows up |
| --- | --- |
| **Every system talks to every other system** | Light feeds the glow gauge *and* the AI; sound travels through walls; NPCs notice candles you snuffed and potions you smashed, then walk over to fix them — which you can exploit. |
| **Many ways through** | Sneak in the dark, Fade past, Possess a pumpkin, lure with a knocking wisp, mist people to sleep, befriend the pet, hide in a box. No single "correct" route. |
| **Reading is playing** | Clues are written in-world (diaries, receipts, phone screens, sleep-talk, gossiping cats). Decoys only fall apart under careful reading — dates, handwriting, who signed it. |
| **Cosy-spooky, never cruel** | Non-lethal toolkit, funny barks, kind twists. Failure is "the family now believes in ghosts". |

## What's in the game

**Missions** — Ghost School: Midnight Drill (guided tutorial), The Hollowell House, Thornbury Farmhouse
and Ravensworth Manor. Each has its own family in costume, routines, conversations, 5–15 clues with decoys
and a six-wish shortlist (always including the dreaded *Single Raisin* 🍇).

**Stealth systems**
- Glow gauge: real light sampling with line of sight to every lamp, candle, jack-o'-lantern, the fire,
  NPC torches and moonbeams through windows.
- Vision cones with peripheral vision, distance and stance falloff, shown as floor decals.
- Sound: surface-aware footsteps (carpet/wood/tile/leaves), squeaky floorboards, doors, thrown objects,
  smashing potions and splatting pumpkins — muffled by walls and closed doors.
- NPC states: routine → suspicious → investigate → alert/chase → search, plus dozing, woken, fixing
  things, conversations and befriended pets.
- **Cats see spirits** (Fade doesn't fool them), **dogs smell** you, **motion-sensor lawn skeletons**
  only see movement and shriek for the humans, grandparents patrol with torches, kids sleep-talk.

**Boo toolkit** — Fade (invisibility), Possess (become a jack-o'-lantern), Spirit Sight (see through a
decoration's eyes, tag people through walls), Bump in the Night (a thrown will-o'-wisp that knocks),
**Snuff** (blow out any light you can see, from 12 m) and Slumber Mist (non-lethal doze + hiding cloud).
Hide in closets, under beds, behind curtains, in pumpkin piles or a cardboard box. Throw books, potions
and pumpkins. Climb furniture. Sneak sweets from candy bowls to restore ectoplasm.

**Presentation** — pmndrs postprocessing (N8AO ambient occlusion, mip bloom, SMAA, AgX tone mapping) and a
custom grading pass for spell states (spectral green Spirit Sight, flickering pumpkin-vision, cold Fade),
fright pulses and violet mist vignettes. Outside: a harvest moon with craters and drifting clouds,
spectral ribbons, falling autumn leaves, layered ground fog, circling bats, will-o'-wisps, dead trees and a
yard dressed per mission. Inside: guttering jack-o'-lanterns, cobwebs, bunting, bat garlands and
portraits whose eyes follow you. Music is public-domain classics arranged live with Web Audio — Chopin's
*Marche funèbre* on a music box, Grieg's *Hall of the Mountain King* (it speeds up when you're spotted)
and Bach's *Toccata in D minor*.

## Code tour

```
src/core     renderer + post FX, input, audio & music engine, assets & skins, settings, save
src/world    house builder, props, procedural Halloween props (spooky.ts), lights, decor,
             environment (sky, leaves, fog, bats), physics, navigation
src/game     game loop, player, NPC bodies (costumes, animatronics) & AI, abilities, interactables
src/ui       HUD, overlays, menus, spook book (journal), report and results screens
src/levels   mission data (rooms, props, NPC routines, clues, conversations…)
src/dev      level validator and viewer (open /#validate or /#viewer?level=hollowell)
public       Kenney CC0 models, textures and audio + licence files
media-kit    press kit and the tools that render it
```

Levels are plain data (`src/levels/*.ts`, contract in `src/levels/types.ts`): rooms are integer
rectangles, walls and openings are generated automatically, and `/#validate` checks reachability,
prop/clue placement, conversation references and that the answer is on the wish list.

### Adding a Halloween prop

Add a case to `spookyModel()` in `src/world/spooky.ts` and its name to `SPOOKY_MODELS`, then reference
it from level data as `'spooky/<name>'`. Props are built in metres, flat-shaded to match the Kenney kits,
created on first use and cloned after that.

## Deploying

| Workflow | When it runs | What it does |
| --- | --- | --- |
| [`ci.yml`](../.github/workflows/ci.yml) | every push & pull request | `npm ci`, typecheck, build, upload the build as an artifact |
| [`deploy-pages.yml`](../.github/workflows/deploy-pages.yml) | pushes to `main` touching the game, manual | builds and publishes to **GitHub Pages** |
| [`deploy-itch.yml`](../.github/workflows/deploy-itch.yml) | pushes to `main` touching the game, `v*` tags, manual | builds and `butler push`es to **echoness/the-order-of-boo:html5** |
| [`release.yml`](../.github/workflows/release.yml) | `v*` tags | creates a GitHub Release with a zipped build |
| [`haunt-forecast.yml`](../.github/workflows/haunt-forecast.yml) | daily | refreshes the README's countdown, moon phase, forecast and tip |

All workflows read the Node version from `.nvmrc` (Node 26).

**GitHub Pages setup (once)** — Settings → Pages → *Build and deployment* → Source: **GitHub Actions**.

**itch.io setup (once)**
1. Create the project page at <https://itch.io/game/new> with the URL slug `the-order-of-boo`, kind **HTML**.
2. Create an API key at <https://itch.io/user/settings/api-keys>.
3. Add it to the repo as the Actions secret **`BUTLER_API_KEY`** (Settings → Secrets and variables → Actions).
4. After the first upload, tick *"This file will be played in the browser"* for the `html5` upload, with a
   viewport such as 1280×720 and the fullscreen button enabled.

Without the secret, the itch.io job still builds and simply skips the upload (with a warning).

**Shipping a version**

```bash
npm version minor            # bumps package.json, commits, tags v1.1.0
git push --follow-tags       # → itch.io deploy + GitHub Release (+ Pages on main)
```

You can also deploy by hand with `npm run deploy:itch` (needs [butler](https://itch.io/docs/butler/) logged in), or
trigger *Deploy to itch.io* from the Actions tab (it has a dry-run option).

## Media kit

```bash
npm run dev &                                   # the tools drive the running game
npm i --no-save playwright                      # if Playwright isn't installed globally
node media-kit/tools/capture-screenshots.mjs    # or a subset: title,living,ui
node media-kit/tools/capture-gif-frames.mjs sneak 60
python3 media-kit/tools/compose-art.py          # covers, banners, icons, og-image (needs Pillow)
```

## Licences

Code and original content: **PolyForm Noncommercial 1.0.0** (see [LICENSE](../LICENSE)) — free for any
noncommercial use; no selling. 3D models, particles, sound effects and jingles are by
[Kenney](https://kenney.nl) under CC0 — licence files are in `public/assets/licenses`. Fonts are under the
SIL Open Font License. The music arrangements are of public-domain compositions.

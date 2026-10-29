# BONSAI: The Studio

An iPhone-first creative game about hands-on bonsai pruning, branch shaping, composition, collection and exhibition.

> Every tree is a living sculpture. Every cut changes its character.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (Vitest)
npm run e2e        # end-to-end journeys (Playwright, mobile emulation)
npm run lint && npm run typecheck && npm run build
```

## Architecture

Static, local-first web app: **Vite + React + TypeScript (strict) + three.js**. No backend, no database, no environment variables.

```
src/tree/     Pure tree core – no renderer, no DOM. Fully unit-tested.
  types.ts      Branch graph data model (stable ids, parent/child, shape, rest shape, wire, buds, wounds)
  layout.ts     Branch graph → world-space quadratic Béziers with parallel-transported frames
  generate.ts   Deterministic sapling generation per species and preset
  ops.ts        Prune / shorten / shape (with physical bounds) / wire – pure functions
  growth.ts     Seasons, light, apical dominance, bud break, pipe-model thickening, healing, wire setting
  history.ts    Snapshot undo/redo
  validate.ts   Structural validation of loaded trees
src/game/     Records, pots, scoring, challenges, unlocks
src/persist/  Versioned localStorage saves (with backups/quarantine) + IndexedDB portraits
src/render/   three.js stage: bark mesher, instanced foliage, pots, picking, capture
src/audio/    Synthesised sound effects (Web Audio) – no audio files
src/app/      State store and actions (the bridge between core, persistence, sound and renderer)
src/ui/       React screens: Studio, Challenges, Collection, Gallery, Portrait mode
```

Key design decisions:

- **Real geometry.** Each branch is a curve defined relative to its parent's frame, so bending a branch carries its subtree. Pruning removes the actual subtree; shortening cuts the curve.
- **Physics you can learn.** Thick wood bends less than thin wood. Bare wood keeps only part of a bend. Wired wood holds the whole bend and slowly *sets*. Wire left on too long bites.
- **Deterministic.** Generation and growth are seeded (`seed + day + branch id`), so the same save always regenerates the same tree.
- **Forgiving.** Health has a floor. Trees never die, and time only moves when the player advances it.
- **Transparent scoring.** Challenges score the silhouette, negative space, balance, trunk, structure, wind direction, pot harmony and finish. Each score comes with a plain-language note. Many shapes score well.

## Save data

Saves live on this device only (localStorage + IndexedDB):

- Each tree has its own key and keeps a backup copy.
- A corrupted tree is restored from its backup, or quarantined (never silently deleted).
- Saves from a newer schema are left untouched.
- Another open tab's edits are picked up rather than overwritten. Unlocks and best scores are merged across tabs, so neither tab can erase the other's progress.
- **Settings → Back up collection** downloads a JSON backup, and **Restore backup** merges it back in. A tree whose id clashes is imported as a copy, never overwritten.
- Installed Home Screen apps ask the browser for persistent storage. Clearing website data still removes saves, so keep a backup.

## Performance notes

- Growth simulation runs in a Web Worker, so advancing a year never freezes the UI. If workers are unavailable it falls back to the main thread.
- The bark mesher writes into typed arrays. Edits are coalesced to one rebuild per frame, and bark uses coarser tessellation while a handle is being dragged.
- Pixel ratio is capped at 2 and drops automatically on devices that can't keep up.

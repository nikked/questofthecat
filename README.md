# A Cat's Year

A small arcade platformer: one run through five seasonal bands — spring, summer,
autumn, a winter summit, and a spring thaw that ends at the sea.

Vanilla TypeScript on Canvas 2D. No runtime dependencies, no asset files: every
sprite and every sound is generated in code.

```sh
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # vitest
pnpm build      # tsc --noEmit && vite build
```

## Playing

| | |
|---|---|
| Arrows / WASD | move |
| Space | jump — hold longer to jump higher |
| Shift | run |
| Esc | pause (the controls are listed there too) |
| R | restart |

In mid-air, **hold toward a wall to cling to it, then press Space to kick off**.
Chain kicks to climb the winter chimney before the snow fills it. You need a
fresh press for each kick — holding Space gives you one jump and nothing after.

Flowers and monstera leaves decide the ending: gather too few and the cat waves
from the shore, gather plenty and it sails out on a garlanded ship. Score comes
from stumps, stomps and what you pick up, plus a bonus that shrinks the longer
you take.

## Layout

The simulation is kept free of I/O so it can be tested without a browser.

| | |
|---|---|
| `src/core/` | pure logic — tile collision, movement, game state |
| `src/render/` | canvas drawing, sprites baked from character grids |
| `src/audio.ts` | WebAudio synthesis — meows, blips and a seasonal score |
| `src/main.ts` | loop, input and browser storage, at the edges |

Physics runs on a fixed 120 Hz timestep with render interpolation, so behaviour
is identical on 60 Hz and 120 Hz displays. The world is drawn into a 320×180
buffer and integer-scaled with nearest-neighbour.

## Authoring

Levels and sprites are both plain text, so they diff readably.

A level is an ASCII grid — `#` ground, `=` sand, `b` log, `?` stump, `C` the cat,
`d` a terrier, `D` a retriever, `f` flower, `M` monstera, `x` cactus, `P`
checkpoint, `G` the flag. Seasons are column ranges declared alongside it.

A sprite is a character grid mapped through a shared palette in
`src/render/sprites.ts`:

```
"..........kk.k..",     k  outline
".........kbnbbk.",     b  dark fur
".........kbnnnbk",     n  light fur
```

## Generated files

`src/ghost.ts` and `src/levels.ts` look like ordinary source but are emitted, not
hand-written.

`ghost.ts` is a recording of the scripted bot's run, replayed in-game as the ghost
you race. `src/tools/bot.test.ts` plays the level start to finish and asserts both
that it can be finished without dying — level geometry has no types to check it
against — and that the shipped ghost still matches the level. Change the level and
that second test fails until the ghost is re-recorded.

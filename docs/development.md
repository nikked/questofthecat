# Development

[Back to README](../README.md)

## Checks

```sh
pnpm test       # vitest
pnpm typecheck  # tsc --noEmit
pnpm build      # typecheck and production build
```

## Layout

The simulation is kept free of I/O so it can be tested without a browser.

| | |
|---|---|
| `src/core/` | pure logic — tile collision, movement, verbs, crates, game state |
| `src/render/` | canvas drawing, sprites baked from character grids |
| `src/audio.ts` | WebAudio synthesis — meows, blips and a seasonal score |
| `src/main.ts` | loop, input and browser storage, at the edges |

Physics runs on a fixed 120 Hz timestep with render interpolation, so behaviour
is identical on 60 Hz and 120 Hz displays. The world is drawn into a 640×360
buffer and scaled to fit the browser viewport at 16:9 with pixelated rendering.
Dark purple bars fill the remaining space. Distant scenery is drawn at half that
resolution and scaled up: it is hazed anyway, and the softer pixels read as depth.

Tiles are 32px and the cat is 34 tall — deliberately taller than one tile, so
that a one-tile gap is something only a slide fits through.

## Authoring

Levels and sprites are both plain text, so they diff readably.

A level is an ASCII grid — `#` ground, `=` sand, `b` log, `C` the cat, `d` a
terrier, `D` a retriever, `h` a hedgehog, `w` a wasp, `B` the big dog, `f`
flower, `M` monstera, `x` cactus, `G` the flag. Crates are tiles too: `c` plain,
`t` TNT, `n` nitro, `^` bounce, `p` checkpoint. Seasons are column ranges
declared alongside it.

`p` is both a crate and a landmark: the renderer keeps the positions the
checkpoint crates started at, so the flag stays standing after its crate is
broken and turns from grey at half mast to green at the top.

Crates are tiles rather than entities on purpose. The sweeps already resolve
against the grid and every crate in the genre is grid-aligned and static, so the
whole system costs no new collision code — only a side map of fuses and bounce
counts for the few crates that are doing something.

A sprite is a character grid mapped through a shared palette in
`src/render/sprites.ts`:

```
"..........kk.k..",     k  outline
".........kbnbbk.",     b  dark fur
".........kbnnnbk",     n  light fur
```

Grids stay at their authored size and the bake doubles them, so the art keeps
diffing as text. On the way through, two passes do the lighting: `k` is retinted
toward whatever material it borders — a flat black outline is the loudest
sprite-era tell there is — and edges facing the light pick up a rim. A caller
that retints a material (the seasonal ground) retints its edges with it.

## Generated files

`src/ghost.ts` and `src/levels.ts` look like ordinary source but are emitted, not
hand-written.

`ghost.ts` is a recording of the scripted bot's run, replayed in-game as the ghost
you race. `src/tools/bot.test.ts` plays the level start to finish and asserts both
that it can be finished without dying — level geometry has no types to check it
against — and that the shipped ghost still matches the level. Change the level and
that second test fails until the ghost is re-recorded.

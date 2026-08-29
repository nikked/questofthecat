# A Cat's Year

A small arcade platformer: one run through five seasonal bands — spring, summer,
autumn, a winter summit, and a spring thaw that ends at the sea, by way of a
crate-smashing moveset and a big dog on the shore.

Vanilla TypeScript on Canvas 2D. No runtime dependencies, no asset files: every
sprite and every sound is generated in code.

```sh
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # vitest
pnpm build      # tsc --noEmit && vite build
```

## Playing

**Play it on a pad.** A DualSense is the intended controller; the keyboard is
the fallback. Nothing is written on the page — press Options (or Esc) and the
pause screen carries the whole scheme.

| | PS5 | Keyboard |
|---|---|---|
| Move | Left stick / D-pad | Arrows / WASD |
| Run | R2 / Circle | Shift |
| Jump | Cross — hold longer to jump higher | Space |
| Spin | Square — a tail whip that reaches past the cat | X or K |
| Slide | L1, R1 or L2, while running | Down, while running |
| Body slam | L1, R1 or L2, in mid-air | Down, in mid-air |
| Pause | Options — resume or restart | Esc |
| Restart | | R, without pausing first |

In mid-air, **hold toward a wall to cling to it, then press jump to kick off**.
Chain kicks to climb the winter chimney before the snow fills it. You need a
fresh press for each kick — holding jump gives you one and nothing after.

A spin can be cancelled into a jump, so it is never a commitment. A slide needs
momentum to start and ends itself, except under a roof too low to stand up in.

Each season flies a **checkpoint flag**. Break the crate at its foot and the
flag runs up the pole green — that is where the cat comes back to, and winter's
is the one worth going out of your way for.

**Which crates you break decides the ending**: clear under 40% and the cat waves
from the shore, clear 90% and it sails out on a garlanded ship. Score comes from
crates, stomps and what you pick up, plus a bonus that shrinks the longer you
take. Every hundredth flower buys a life back, and running out of lives restarts
the level rather than ending the run.

The shore is guarded. The flag does not work until the big dog is down. It
charges at wherever you are standing, so jump the charge and let it bury itself
in one of the arena posts — the two seconds it spends stunned are the only
window a spin lands in. Three hits. It is harmless while it reels from one, but
lethal again the moment it recovers, so back off between them.

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
buffer and integer-scaled with nearest-neighbour. Distant scenery is drawn at
half that and scaled up: it is hazed anyway, and the softer pixels read as depth.

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

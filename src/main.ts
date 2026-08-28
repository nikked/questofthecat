import { createState, resetLevel, step, type GameState } from "./core/state";
import { seasonAt } from "./core/level";
import { createAudio } from "./audio";
import { listenKeyboard } from "./input";
import { LEVEL_1 } from "./levels";
import { PAR_GHOST, PAR_SCORE } from "./ghost";
import { VIEW_H, VIEW_W, buildScenery, createRenderer, drawPause, render } from "./render/draw";

/** Simulation rate. Fixed so physics is identical on 60Hz and 120Hz displays. */
const STEP = 1 / 120;
/** A tab returning from the background must not fast-forward the whole level. */
const MAX_FRAME = 0.25;

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (!canvas) throw new Error("missing #game canvas");

const renderer = createRenderer(canvas);
const keyboard = listenKeyboard(window);
const audio = createAudio();

function newGame(): GameState {
  const state = createState(LEVEL_1);
  resetLevel(state);
  const scenery = buildScenery(state.level, grown);
  renderer.decorations = scenery.decorations;
  renderer.forest = scenery.forest;
  renderer.waterfalls = scenery.waterfalls;
  renderer.ghost = loadGhost();
  target = best;
  recorded = false;
  return state;
}

const BEST_KEY = "catquest.bestScore";
const GHOST_KEY = "catquest.ghost";
const GROWN_KEY = "catquest.grown";

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Nothing to do: the run still counts, it just will not be remembered.
  }
}

/** Falls back to the shipped par run, so there is always something to race. */
function loadGhost(): readonly number[] {
  const raw = readStored(GHOST_KEY);
  if (!raw) return PAR_GHOST;
  try {
    const parsed: unknown = JSON.parse(raw);
    const ok =
      Array.isArray(parsed) && parsed.length >= 4 && parsed.every((n) => typeof n === "number");
    return ok ? (parsed as number[]) : PAR_GHOST;
  } catch {
    return PAR_GHOST;
  }
}

/** Storage is unavailable in some privacy modes; a missing best is not an error. */
function loadBest(): number {
  // With no run of your own yet, par is the bar.
  return Number(readStored(BEST_KEY)) || PAR_SCORE;
}

function isBetter(score: number, best: number): boolean {
  return score > best;
}

let best = loadBest();
let grown = Number(readStored(GROWN_KEY)) || 0;
/** The bar this run has to clear; frozen at the start so the banner is honest. */
let target = best;
let paused = false;
/** One write per run, however many frames the ending sits on screen. */
let recorded = false;
let state = newGame();

function fitCanvas(): void {
  const scale = Math.max(
    1,
    Math.floor(Math.min(window.innerWidth / VIEW_W, window.innerHeight / VIEW_H)),
  );
  canvas!.style.width = `${VIEW_W * scale}px`;
  canvas!.style.height = `${VIEW_H * scale}px`;
}

fitCanvas();
window.addEventListener("resize", fitCanvas);

let accumulator = 0;
let previous = performance.now() / 1000;

function frame(now: number): void {
  // Queued first: a thrown frame must not silently end the game for good.
  requestAnimationFrame(frame);

  const seconds = now / 1000;
  accumulator += Math.min(seconds - previous, MAX_FRAME);
  previous = seconds;

  if (keyboard.takePause()) paused = !paused;

  if (keyboard.takeRestart()) {
    state = newGame();
    accumulator = 0;
    paused = false;
  }

  const over = state.phase === "won";
  // The win keeps stepping so the outro clock runs; only Esc freezes.
  const frozen = paused;

  while (accumulator >= STEP) {
    if (!frozen) {
      step(state, keyboard.input, STEP);
      for (const sound of state.sounds) audio.play(sound);
    }
    accumulator -= STEP;
  }

  // Music follows the ground under the cat, and stops with the game.
  if (state.started && !paused) audio.music(seasonAt(state.level, state.player.x));

  render(renderer, state, frozen ? 1 : accumulator / STEP, {
    best,
    beat: isBetter(state.score, target),
  });
  if (paused) drawPause(renderer, best);

  if (over && !recorded) {
    recorded = true;
    grown += state.monstera.filter((m) => m.taken).length;
    writeStored(GROWN_KEY, String(grown));
    if (isBetter(state.score, best)) {
      best = state.score;
      writeStored(BEST_KEY, String(best));
      writeStored(GHOST_KEY, JSON.stringify(state.trace));
    }
  }
}

requestAnimationFrame(frame);

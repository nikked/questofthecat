import "./menu.css";
import { createState, resetLevel, step, type GameState } from "./core/state";
import { seasonAt } from "./core/level";
import { createAudio } from "./audio";
import { listenControls } from "./input";
import { LEVEL_1 } from "./levels";
import { PAR_GHOST, PAR_SCORE } from "./ghost";
import {
  PAUSE_MENU,
  VIEW_H,
  VIEW_W,
  buildScenery,
  createRenderer,
  drawPause,
  drawMainMenu,
  render,
} from "./render/draw";

/** Simulation rate. Fixed so physics is identical on 60Hz and 120Hz displays. */
const STEP = 1 / 120;
/** A tab returning from the background must not fast-forward the whole level. */
const MAX_FRAME = 0.25;

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (!canvas) throw new Error("missing #game canvas");

const renderer = createRenderer(canvas);
const controls = listenControls(window);
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

const BEST_KEY = "questofthecat.bestScore";
const GHOST_KEY = "questofthecat.ghost";
const NAME_KEY = "questofthecat.bestName";
const GROWN_KEY = "questofthecat.grown";

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
let bestName = readStored(NAME_KEY) || (readStored(BEST_KEY) ? "PLAYER" : "PAR");
let grown = Number(readStored(GROWN_KEY)) || 0;
/** The bar this run has to clear; frozen at the start so the banner is honest. */
let target = best;
let paused = false;
/** Which pause entry is highlighted; always back to the top on a fresh pause. */
let pauseIndex = 0;
/** One write per run, however many frames the ending sits on screen. */
let recorded = false;
let state = newGame();
let inMenu = true;
let menuIndex = 0;
const frontMenu = document.querySelector<HTMLElement>("#front-menu")!;
const menuHome = document.querySelector<HTMLElement>("#menu-home")!;
const menuControls = document.querySelector<HTMLElement>("#menu-controls")!;
const menuButtons = [
  document.querySelector<HTMLButtonElement>("#start-game")!,
  document.querySelector<HTMLButtonElement>("#show-controls")!,
];
const backButton = document.querySelector<HTMLButtonElement>("#back-menu")!;
const scoreDialog = document.querySelector<HTMLDialogElement>("#score-dialog")!;
const scoreForm = document.querySelector<HTMLFormElement>("#score-form")!;
const scorerName = document.querySelector<HTMLInputElement>("#scorer-name")!;

function showMenu(): void {
  inMenu = true;
  paused = false;
  frontMenu.hidden = false;
  menuHome.hidden = false;
  menuControls.hidden = true;
  menuIndex = 0;
  menuButtons.forEach((button, i) => button.dataset.selected = String(i === menuIndex));
  document.querySelector("#top-scorer")!.textContent = bestName;
  document.querySelector("#top-score")!.textContent = best.toLocaleString();
  menuButtons[0]!.focus();
}

menuButtons[0]!.addEventListener("click", () => {
  if (!inMenu) return;
  state = newGame();
  state.player.jumpHeld = controls.input.jump;
  accumulator = 0;
  inMenu = false;
  frontMenu.hidden = true;
  menuButtons[0]!.blur();
});
menuButtons[1]!.addEventListener("click", () => {
  menuHome.hidden = true;
  menuControls.hidden = false;
  backButton.focus();
});
menuButtons.forEach((button, index) => button.addEventListener("focus", () => {
  menuIndex = index;
  menuButtons.forEach((item, i) => item.dataset.selected = String(i === index));
}));
backButton.addEventListener("click", showMenu);
scoreDialog.addEventListener("cancel", (event) => event.preventDefault());
scorerName.addEventListener("input", () => scorerName.setCustomValidity(""));
scoreForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = scorerName.value.trim();
  if (!name) {
    scorerName.setCustomValidity("Please enter your name.");
    scorerName.reportValidity();
    return;
  }
  bestName = name;
  writeStored(NAME_KEY, bestName);
  scoreDialog.close();
  state.player.jumpHeld = true;
});
showMenu();

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

  controls.poll();

  // Drained every frame so a menu never opens holding a stale press.
  const menuMove = controls.takeMenu();
  const menuConfirm = controls.takeConfirm();

  const pausePressed = controls.takePause();
  const restartPressed = controls.takeRestart();
  if (scoreDialog.open) {
    accumulator = 0;
    return;
  }
  if (inMenu) {
    accumulator = 0;
    if (menuControls.hidden) {
      if (menuMove !== 0) {
        menuIndex = (menuIndex + menuMove + menuButtons.length) % menuButtons.length;
        menuButtons[menuIndex]!.focus();
      }
      if (menuConfirm) menuButtons[menuIndex]!.click();
    } else if (menuConfirm || pausePressed) {
      showMenu();
    }
    if (inMenu) drawMainMenu(renderer, seconds);
    return;
  }

  if (pausePressed) {
    paused = !paused;
    pauseIndex = 0;
  }

  if (paused) {
    if (menuMove !== 0) {
      pauseIndex = (pauseIndex + menuMove + PAUSE_MENU.length) % PAUSE_MENU.length;
    }
    if (menuConfirm) {
      if (PAUSE_MENU[pauseIndex] === "MAIN MENU") {
        showMenu();
        accumulator = 0;
        drawMainMenu(renderer, seconds);
        return;
      }
      if (PAUSE_MENU[pauseIndex] === "RESTART") {
        state = newGame();
        accumulator = 0;
      }
      paused = false;
      // The key that confirmed is still down. Without this the cat reads it as
      // a fresh jump on the very frame the game resumes.
      state.player.jumpHeld = true;
    }
  }

  if (restartPressed) {
    state = newGame();
    accumulator = 0;
    paused = false;
  }

  const over = state.phase === "won";
  // The win keeps stepping so the outro clock runs; only Esc freezes.
  const frozen = paused;

  while (accumulator >= STEP) {
    if (!frozen) {
      step(state, controls.input, STEP);
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
  if (paused) drawPause(renderer, best, pauseIndex);

  if (over && !recorded) {
    recorded = true;
    grown += state.monstera.filter((m) => m.taken).length;
    writeStored(GROWN_KEY, String(grown));
    if (isBetter(state.score, best)) {
      best = state.score;
      writeStored(BEST_KEY, String(best));
      writeStored(GHOST_KEY, JSON.stringify(state.trace));
      bestName = "PLAYER";
      writeStored(NAME_KEY, bestName);
      document.querySelector("#new-score")!.textContent = `${best.toLocaleString()} POINTS`;
      scorerName.value = "";
      scoreDialog.showModal();
      scorerName.focus();
    }
  }
}

requestAnimationFrame(frame);

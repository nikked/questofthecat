import "./menu.css";
import {
  createState,
  endingFor,
  resetLevel,
  scoreBreakdown,
  step,
  type GameState,
} from "./core/state";
import { seasonAt } from "./core/level";
import { createAudio } from "./audio";
import { listenControls } from "./input";
import { LEVEL_1 } from "./levels";
import { PAR_GHOST } from "./ghost";
import {
  PAUSE_MENU,
  OUTRO_COMPLETE,
  buildScenery,
  createRenderer,
  drawPause,
  drawMainMenu,
  formatTime,
  render,
} from "./render/draw";
import { cleanName, fetchLeaderboard, submitRun, type ScoreEntry } from "./scores";

/** Simulation rate. Fixed so physics is identical on 60Hz and 120Hz displays. */
const STEP = 1 / 120;
/** A tab returning from the background must not fast-forward the whole level. */
const MAX_FRAME = 0.25;

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (!canvas) throw new Error("missing #game canvas");

const renderer = createRenderer(canvas);
const controls = listenControls(window, document.querySelector<HTMLElement>("#touch-controls")!);
const audio = createAudio();

function newGame(): GameState {
  const state = createState(LEVEL_1);
  resetLevel(state);
  const scenery = buildScenery(state.level, grown);
  renderer.decorations = scenery.decorations;
  renderer.forest = scenery.forest;
  renderer.waterfalls = scenery.waterfalls;
  renderer.ghost = loadGhost();
  target = board?.[0]?.score ?? null;
  recorded = false;
  scorePrompted = false;
  return state;
}

const BEST_KEY = "questofthecat.bestScore";
const GHOST_KEY = "questofthecat.ghost";
/** The last name entered, so a returning cat only has to press Enter. */
const NAME_KEY = "questofthecat.name";
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
  return Number(readStored(BEST_KEY)) || 0;
}

function isBetter(score: number, best: number): boolean {
  return score > best;
}

let best = loadBest();
let board: readonly ScoreEntry[] | null = null;
let grown = Number(readStored(GROWN_KEY)) || 0;
/** Use the first shared score available for this run, then keep it fixed. */
let target: number | null = null;
let paused = false;
/** Which pause entry is highlighted; always back to the top on a fresh pause. */
let pauseIndex = 0;
/** One write per run, however many frames the ending sits on screen. */
let recorded = false;
let scorePrompted = false;
let state = newGame();
let inMenu = true;
let menuIndex = 0;
const frontMenu = document.querySelector<HTMLElement>("#front-menu")!;
const menuHome = document.querySelector<HTMLElement>("#menu-home")!;
const menuControls = document.querySelector<HTMLElement>("#menu-controls")!;
const menuBoard = document.querySelector<HTMLElement>("#menu-board")!;
const boardStatus = document.querySelector<HTMLElement>("#board-status")!;
const boardTable = document.querySelector<HTMLTableElement>("#board-table")!;
const menuButtons = [
  document.querySelector<HTMLButtonElement>("#start-game")!,
  document.querySelector<HTMLButtonElement>("#show-board")!,
  document.querySelector<HTMLButtonElement>("#show-controls")!,
];
const backButtons = document.querySelectorAll<HTMLButtonElement>("#front-menu .back");
const scoreTitle = document.querySelector<HTMLElement>("#score-title")!;
const breakdownTable = document.querySelector<HTMLTableElement>("#score-breakdown")!;
const scoreDialog = document.querySelector<HTMLDialogElement>("#score-dialog")!;
const scoreForm = document.querySelector<HTMLFormElement>("#score-form")!;
const scorerName = document.querySelector<HTMLInputElement>("#scorer-name")!;
const skipButton = document.querySelector<HTMLButtonElement>("#skip-score")!;

/** Absent in dev and tests, so the leaderboard is simply not there. */
const SCORES_URL = import.meta.env.VITE_SCORES_URL;
let boardError = false;
let unsavedRun = false;

function showMenu(): void {
  inMenu = true;
  paused = false;
  frontMenu.hidden = false;
  menuHome.hidden = false;
  menuControls.hidden = true;
  menuBoard.hidden = true;
  menuIndex = 0;
  menuButtons.forEach((button, i) => button.dataset.selected = String(i === menuIndex));
  const top = board?.[0];
  document.querySelector<HTMLElement>(".menu-record")!.hidden = !top;
  document.querySelector("#top-scorer")!.textContent = top?.name ?? "";
  document.querySelector("#top-score")!.textContent = top?.score.toLocaleString() ?? "";
  menuButtons[0]!.focus();
}

function openPanel(panel: HTMLElement): void {
  menuHome.hidden = true;
  panel.hidden = false;
  panel.querySelector<HTMLButtonElement>(".back")!.focus();
}

function boardMessage(): string {
  if (!SCORES_URL) return "NO LEADERBOARD CONFIGURED";
  if (boardError) return "COULD NOT REACH THE LEADERBOARD";
  if (unsavedRun) return "YOUR LAST RUN WAS NOT SAVED";
  if (board === null) return "LOADING";
  if (board.length === 0) return "NO RUNS YET. BE THE FIRST CAT.";
  return "";
}

function renderBoard(): void {
  boardStatus.textContent = boardMessage();
  boardTable.replaceChildren(
    ...(board ?? []).map((entry, i) => {
      const row = document.createElement("tr");
      for (const [text, cls] of [
        [String(i + 1), "rank"],
        [entry.name, "name"],
        [entry.score.toLocaleString(), "score"],
        [formatTime(entry.time), "time"],
      ] as const) {
        const cell = row.insertCell();
        cell.textContent = text;
        cell.className = cls;
      }
      return row;
    }),
  );
}

/** Every part of the score and what earned it, with the score itself last. */
function renderBreakdown(finished: GameState): void {
  const parts = scoreBreakdown(finished);
  const rows: readonly (readonly [label: string, detail: string, points: number])[] = [
    ["FLOWERS", String(finished.flowerCount), parts.flowers],
    ["MONSTERA", String(finished.monstera.filter((m) => m.taken).length), parts.monstera],
    ["ENEMIES", String(finished.defeated), parts.enemies],
    ["BIG DOG", String(finished.bossHitsScored), parts.bigDog],
    ["FLAG", "", parts.flag],
    ["TIME BONUS", formatTime(finished.runTime), parts.time],
    ["LIVES BONUS", String(finished.lives), parts.lives],
    ["SCORE", "", finished.score],
  ];
  breakdownTable.replaceChildren(
    ...rows.map(([label, detail, points]) => {
      const row = document.createElement("tr");
      for (const text of [label, detail, points.toLocaleString()]) {
        row.insertCell().textContent = text;
      }
      return row;
    }),
  );
}

function loadBoard(): void {
  if (!SCORES_URL) return;
  fetchLeaderboard(SCORES_URL).then(
    (entries) => {
      board = entries;
      if (target === null) target = entries[0]?.score ?? null;
      boardError = false;
      renderBoard();
      if (inMenu && !menuHome.hidden) showMenu();
    },
    () => {
      boardError = true;
      renderBoard();
    },
  );
}

menuButtons[0]!.addEventListener("click", () => {
  if (!inMenu) return;
  state = newGame();
  // The note is about the last run; a new one makes it stale.
  unsavedRun = false;
  state.player.jumpHeld = controls.input.jump;
  accumulator = 0;
  inMenu = false;
  frontMenu.hidden = true;
  menuButtons[0]!.blur();
});
menuButtons[1]!.addEventListener("click", () => {
  renderBoard();
  openPanel(menuBoard);
});
menuButtons[2]!.addEventListener("click", () => openPanel(menuControls));
menuButtons.forEach((button, index) => button.addEventListener("focus", () => {
  menuIndex = index;
  menuButtons.forEach((item, i) => item.dataset.selected = String(i === index));
}));
backButtons.forEach((button) => button.addEventListener("click", showMenu));
scoreDialog.addEventListener("cancel", (event) => event.preventDefault());
skipButton.addEventListener("click", () => {
  scoreDialog.close();
  state.player.jumpHeld = true;
});
scorerName.addEventListener("input", () => scorerName.setCustomValidity(""));
scoreForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = cleanName(scorerName.value);
  if (!name) {
    scorerName.setCustomValidity("Please enter your name.");
    scorerName.reportValidity();
    return;
  }
  writeStored(NAME_KEY, name);
  if (SCORES_URL) {
    const run = { name, score: state.score, time: state.runTime, ending: endingFor(state.score) };
    submitRun(SCORES_URL, run).then(
      () => {
        unsavedRun = false;
        loadBoard();
      },
      () => {
        unsavedRun = true;
        renderBoard();
      },
    );
  }
  scoreDialog.close();
  state.player.jumpHeld = true;
});
showMenu();
loadBoard();

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
    // Keyboard presses inside the dialog never reach the controls, so these are the pad's.
    if (menuConfirm) scoreForm.requestSubmit();
    else if (pausePressed) skipButton.click();
    return;
  }
  if (inMenu) {
    accumulator = 0;
    if (!menuHome.hidden) {
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
    best: target,
    beat: target !== null && isBetter(state.score, target),
  });
  if (paused) drawPause(renderer, target, pauseIndex);

  if (over && !recorded) {
    recorded = true;
    grown += state.monstera.filter((m) => m.taken).length;
    writeStored(GROWN_KEY, String(grown));
    const personalBest = isBetter(state.score, best);
    if (personalBest) {
      best = state.score;
      writeStored(BEST_KEY, String(best));
      writeStored(GHOST_KEY, JSON.stringify(state.trace));
    }
    scoreTitle.textContent = personalBest ? "NEW PERSONAL BEST!" : "RUN COMPLETE";
    renderBreakdown(state);
    scorerName.value = readStored(NAME_KEY) ?? "";
  }
  if (over && !paused && !scorePrompted && state.time - state.wonAt > OUTRO_COMPLETE) {
    scorePrompted = true;
    scoreDialog.showModal();
    scorerName.focus();
    scorerName.select();
  }
}

requestAnimationFrame(frame);

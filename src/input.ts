import type { Input } from "./core/physics";

const BINDINGS: Readonly<Record<string, keyof Input>> = {
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  ArrowUp: "jump",
  KeyW: "jump",
  Space: "jump",
  KeyZ: "jump",
  ArrowDown: "down",
  KeyS: "down",
  KeyX: "spin",
  KeyK: "spin",
  ShiftLeft: "run",
  ShiftRight: "run",
};

/**
 * Standard-layout indices, which on a DualSense are: 0 cross, 1 circle,
 * 2 square, 3 triangle, 4 L1, 5 R1, 6 L2, 7 R2, 9 options.
 *
 * Run and slide each take a trigger as well as a face button: a trigger is
 * what a hand on a DualSense reaches for to sprint, and holding circle to run
 * while pressing square to spin is an awkward grip.
 */
const PAD_JUMP = 0;
const PAD_SPIN = 2;
const PAD_RUN = 1;
const PAD_RUN_TRIGGER = 7;
const PAD_DOWN_A = 4;
const PAD_DOWN_B = 5;
const PAD_DOWN_TRIGGER = 6;
const PAD_DPAD_UP = 12;
const PAD_DPAD_DOWN = 13;
const PAD_DPAD_LEFT = 14;
const PAD_DPAD_RIGHT = 15;
const PAD_START = 9;
/** Sticks rest slightly off centre, so anything under this is not a press. */
const STICK_DEADZONE = 0.45;

/**
 * Menu navigation reads the same keys as the game — up is also jump — so it is
 * tracked as its own set of edges rather than through the held-input map. A
 * menu wants presses, and the game wants holds.
 */
const MENU_UP = new Set(["ArrowUp", "KeyW"]);
const MENU_DOWN = new Set(["ArrowDown", "KeyS"]);
const MENU_CONFIRM = new Set(["Space", "Enter", "NumpadEnter", "KeyZ"]);

export type Controls = {
  readonly input: Input;
  /** Merges pad state into the keyboard's; call once per frame before reading. */
  poll: () => void;
  /** True on the frame a restart was requested, then cleared by the caller. */
  takeRestart: () => boolean;
  /** True once per Esc or Start press, so the caller can toggle pause. */
  takePause: () => boolean;
  /** -1 up, 1 down, 0 for nothing; one step per press. Cleared by the caller. */
  takeMenu: () => number;
  /** True once per confirm press, for whatever menu is open. */
  takeConfirm: () => boolean;
};

type Flags = { -readonly [K in keyof Input]: boolean };

const noFlags = (): Flags => ({
  left: false,
  right: false,
  jump: false,
  run: false,
  down: false,
  spin: false,
});

/**
 * Reading key state straight from the event handlers (rather than polling) keeps
 * input latency down to the browser's own event dispatch. The pad has to be
 * polled — the Gamepad API offers nothing else — so it is merged in per frame.
 */
export function listenControls(target: Window): Controls {
  const keys = noFlags();
  const input = noFlags();
  let restart = false;
  let pause = false;
  let menu = 0;
  let confirm = false;
  let padPauseHeld = false;
  let padUpHeld = false;
  let padDownHeld = false;
  let padConfirmHeld = false;

  const set = (code: string, down: boolean): boolean => {
    const action = BINDINGS[code];
    if (!action) return false;
    keys[action] = down;
    return true;
  };

  target.addEventListener("keydown", (event) => {
    if (event.repeat) return;
    if (event.code === "KeyR") restart = true;
    if (event.code === "Escape") pause = true;
    if (MENU_UP.has(event.code)) menu = -1;
    else if (MENU_DOWN.has(event.code)) menu = 1;
    if (MENU_CONFIRM.has(event.code)) confirm = true;
    if (set(event.code, true)) event.preventDefault();
  });

  target.addEventListener("keyup", (event) => {
    if (set(event.code, false)) event.preventDefault();
  });

  // A window that loses focus never delivers the matching keyup.
  target.addEventListener("blur", () => {
    for (const key of Object.keys(keys) as (keyof Input)[]) keys[key] = false;
  });

  const firstPad = (): Gamepad | null => {
    const pads = target.navigator.getGamepads?.() ?? [];
    for (const pad of pads) if (pad?.connected) return pad;
    return null;
  };

  const poll = (): void => {
    Object.assign(input, keys);
    const pad = firstPad();
    if (!pad) {
      padPauseHeld = false;
      return;
    }

    const held = (i: number): boolean => pad.buttons[i]?.pressed === true;
    const axis = pad.axes[0] ?? 0;
    const vertical = pad.axes[1] ?? 0;

    input.left ||= held(PAD_DPAD_LEFT) || axis < -STICK_DEADZONE;
    input.right ||= held(PAD_DPAD_RIGHT) || axis > STICK_DEADZONE;
    input.jump ||= held(PAD_JUMP);
    input.spin ||= held(PAD_SPIN);
    input.run ||= held(PAD_RUN) || held(PAD_RUN_TRIGGER);
    input.down ||=
      held(PAD_DOWN_A) ||
      held(PAD_DOWN_B) ||
      held(PAD_DOWN_TRIGGER) ||
      held(PAD_DPAD_DOWN) ||
      vertical > STICK_DEADZONE;

    // Edge-detected here rather than in the caller, to match the keyboard's Esc.
    const start = held(PAD_START);
    if (start && !padPauseHeld) pause = true;
    padPauseHeld = start;

    const padUp = held(PAD_DPAD_UP) || vertical < -STICK_DEADZONE;
    const padDown = held(PAD_DPAD_DOWN) || vertical > STICK_DEADZONE;
    if (padUp && !padUpHeld) menu = -1;
    else if (padDown && !padDownHeld) menu = 1;
    padUpHeld = padUp;
    padDownHeld = padDown;

    const cross = held(PAD_JUMP);
    if (cross && !padConfirmHeld) confirm = true;
    padConfirmHeld = cross;
  };

  return {
    input,
    poll,
    takeRestart: () => (restart ? ((restart = false), true) : false),
    takePause: () => (pause ? ((pause = false), true) : false),
    takeMenu: () => {
      const move = menu;
      menu = 0;
      return move;
    },
    takeConfirm: () => (confirm ? ((confirm = false), true) : false),
  };
}

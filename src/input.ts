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
 */
const PAD_JUMP = 0;
const PAD_SPIN = 2;
const PAD_SLIDE = 1;
const PAD_RUN_TRIGGER = 7;
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
  /** Merges keyboard, touch and pad state; call once per frame before reading. */
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
  slide: false,
  spin: false,
});

/**
 * Reading key state straight from the event handlers (rather than polling) keeps
 * input latency down to the browser's own event dispatch. The pad has to be
 * polled — the Gamepad API offers nothing else — so it is merged in per frame.
 */
export function listenControls(target: Window, touchRoot?: HTMLElement): Controls {
  const keys = noFlags();
  const input = noFlags();
  const touch = noFlags();
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
    // Keyboard Down keeps its ground-slide / airborne-slam shortcut.
    if (action === "down") keys.slide = down;
    return true;
  };

  target.addEventListener("keydown", (event) => {
    if (event.repeat || event.target instanceof HTMLInputElement ||
      (event.target instanceof HTMLElement && event.target.closest("dialog"))) return;
    if (event.code === "KeyR") restart = true;
    if (event.code === "Escape") pause = true;
    if (MENU_UP.has(event.code)) menu = -1;
    else if (MENU_DOWN.has(event.code)) menu = 1;
    if (MENU_CONFIRM.has(event.code)) {
      confirm = true;
      event.preventDefault();
    }
    if (set(event.code, true)) event.preventDefault();
  });

  target.addEventListener("keyup", (event) => {
    if (set(event.code, false)) event.preventDefault();
  });

  // A window that loses focus never delivers the matching keyup.
  target.addEventListener("blur", () => {
    for (const key of Object.keys(keys) as (keyof Input)[]) keys[key] = false;
  });

  if (touchRoot) {
    const portraitTouch = target.matchMedia("(pointer: coarse) and (orientation: portrait)");
    const pointers = new Map<number, HTMLButtonElement>();
    let running = false;
    const actions: Readonly<Record<string, keyof Input>> = {
      left: "left", right: "right", up: "jump", down: "down", jump: "jump", spin: "spin", slide: "slide",
    };
    const updateTouch = (): void => {
      Object.assign(touch, noFlags());
      touch.run = running;
      for (const button of pointers.values()) {
        const action = actions[button.dataset.touch ?? ""];
        if (action) touch[action] = true;
      }
      touchRoot.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
        const held = [...pointers.values()].includes(button) || (button.dataset.touch === "run" && running);
        button.dataset.held = String(held);
        if (button.dataset.touch === "run") button.setAttribute("aria-pressed", String(running));
      });
    };
    const press = (button: HTMLButtonElement): void => {
      const action = button.dataset.touch;
      if (action === "up") menu = -1;
      if (action === "down") menu = 1;
      if (action === "jump") confirm = true;
      if (action === "pause") pause = true;
      if (action === "run") running = !running;
    };
    touchRoot.addEventListener("pointerdown", (event) => {
      if (!portraitTouch.matches || event.button !== 0) return;
      const button = (event.target as Element).closest<HTMLButtonElement>("button[data-touch]");
      if (!button) return;
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, button);
      press(button);
      updateTouch();
    });
    touchRoot.addEventListener("pointermove", (event) => {
      const previous = pointers.get(event.pointerId);
      if (!previous?.closest(".touch-dpad")) return;
      const button = target.document.elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLButtonElement>(".touch-dpad button");
      if (button && button !== previous) {
        pointers.set(event.pointerId, button);
        press(button);
        updateTouch();
      }
    });
    const release = (event: PointerEvent): void => {
      pointers.delete(event.pointerId);
      updateTouch();
    };
    touchRoot.addEventListener("pointerup", release);
    touchRoot.addEventListener("pointercancel", release);
    touchRoot.addEventListener("lostpointercapture", release);
    const clearTouch = (): void => {
      pointers.clear();
      running = false;
      updateTouch();
    };
    target.addEventListener("blur", clearTouch);
    target.document.addEventListener("visibilitychange", () => {
      if (target.document.hidden) clearTouch();
    });
    portraitTouch.addEventListener("change", clearTouch);
  }

  const firstPad = (): Gamepad | null => {
    const pads = target.navigator.getGamepads?.() ?? [];
    for (const pad of pads) if (pad?.connected) return pad;
    return null;
  };

  const poll = (): void => {
    Object.assign(input, keys);
    for (const action of Object.keys(touch) as (keyof Input)[]) input[action] ||= touch[action];
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
    input.run ||= held(PAD_RUN_TRIGGER);
    input.slide ||= held(PAD_SLIDE);
    input.down ||=
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

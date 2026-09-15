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
    /** The button under each finger, keyed by touch identifier. */
    const fingers = new Map<number, HTMLButtonElement>();
    /** The handheld runs by default; this switch latches walking on instead. */
    let walking = false;
    const actions: Readonly<Record<string, keyof Input>> = {
      left: "left", right: "right", up: "jump", down: "down", jump: "jump", spin: "spin", slide: "slide",
    };
    const updateTouch = (): void => {
      Object.assign(touch, noFlags());
      // Only while the handheld is on screen, or a keyboard would never walk.
      touch.run = portraitTouch.matches && !walking;
      for (const button of fingers.values()) {
        const action = actions[button.dataset.touch ?? ""];
        if (action) touch[action] = true;
      }
      touchRoot.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
        const held = [...fingers.values()].includes(button) || (button.dataset.touch === "walk" && walking);
        button.dataset.held = String(held);
        if (button.dataset.touch === "walk") button.setAttribute("aria-pressed", String(walking));
      });
    };
    const press = (button: HTMLButtonElement): void => {
      const action = button.dataset.touch;
      if (action === "up") menu = -1;
      if (action === "down") menu = 1;
      if (action === "jump") confirm = true;
      if (action === "pause") pause = true;
      if (action === "walk") walking = !walking;
    };
    /**
     * `touches` is every finger still on the glass, so anything missing from it
     * has lifted even if its end event never reached us. Pairing start and end
     * events alone can leave a direction held with no finger on it.
     */
    const forgetLifted = (touches: TouchList): void => {
      const down = new Set(Array.from(touches, (t) => t.identifier));
      for (const id of fingers.keys()) if (!down.has(id)) fingers.delete(id);
    };
    touchRoot.addEventListener("touchstart", (event) => {
      if (!portraitTouch.matches) return;
      // Keeps a long hold from turning into a text selection or callout.
      event.preventDefault();
      for (const t of Array.from(event.changedTouches)) {
        const button = (t.target as Element).closest<HTMLButtonElement>("button[data-touch]");
        if (!button) continue;
        fingers.set(t.identifier, button);
        press(button);
      }
      forgetLifted(event.touches);
      updateTouch();
    }, { passive: false });
    touchRoot.addEventListener("touchmove", (event) => {
      for (const t of Array.from(event.changedTouches)) {
        const previous = fingers.get(t.identifier);
        if (!previous?.closest(".touch-dpad")) continue;
        const button = target.document.elementFromPoint(t.clientX, t.clientY)
          ?.closest<HTMLButtonElement>(".touch-dpad button");
        if (button && button !== previous) {
          fingers.set(t.identifier, button);
          press(button);
        }
      }
      forgetLifted(event.touches);
      updateTouch();
    });
    const release = (event: TouchEvent): void => {
      forgetLifted(event.touches);
      updateTouch();
    };
    touchRoot.addEventListener("touchend", release);
    touchRoot.addEventListener("touchcancel", release);
    const clearTouch = (): void => {
      fingers.clear();
      walking = false;
      updateTouch();
    };
    target.addEventListener("blur", clearTouch);
    target.document.addEventListener("visibilitychange", () => {
      if (target.document.hidden) clearTouch();
    });
    portraitTouch.addEventListener("change", clearTouch);
    updateTouch();
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

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
  ShiftLeft: "run",
  ShiftRight: "run",
  KeyX: "run",
};

export type Keyboard = {
  readonly input: Input;
  /** True on the frame a restart was requested, then cleared by the caller. */
  takeRestart: () => boolean;
  /** True once per Esc press, so the caller can toggle pause. */
  takePause: () => boolean;
};

/**
 * Reading key state straight from the event handlers (rather than polling) keeps
 * input latency down to the browser's own event dispatch.
 */
export function listenKeyboard(target: Window): Keyboard {
  const input = { left: false, right: false, jump: false, run: false };
  let restart = false;
  let pause = false;

  const set = (code: string, down: boolean): boolean => {
    const action = BINDINGS[code];
    if (!action) return false;
    input[action] = down;
    return true;
  };

  target.addEventListener("keydown", (event) => {
    if (event.repeat) return;
    if (event.code === "KeyR") restart = true;
    if (event.code === "Escape") pause = true;
    if (set(event.code, true)) event.preventDefault();
  });

  target.addEventListener("keyup", (event) => {
    if (set(event.code, false)) event.preventDefault();
  });

  // A window that loses focus never delivers the matching keyup.
  target.addEventListener("blur", () => {
    input.left = input.right = input.jump = input.run = false;
  });

  return {
    input,
    takeRestart: () => (restart ? ((restart = false), true) : false),
    takePause: () => (pause ? ((pause = false), true) : false),
  };
}

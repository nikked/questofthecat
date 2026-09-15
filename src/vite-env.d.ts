interface Navigator {
  /** Safari's Audio Session API, which no other browser has. */
  readonly audioSession?: {
    type: "auto" | "playback" | "transient" | "transient-solo" | "ambient" | "play-and-record";
  };
}

interface ImportMetaEnv {
  /** Apps Script web app URL. Absent in dev and tests: scores then stay local. */
  readonly VITE_SCORES_URL?: string;
}

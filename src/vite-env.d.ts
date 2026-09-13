interface ImportMetaEnv {
  /** Apps Script web app URL. Absent in dev and tests: scores then stay local. */
  readonly VITE_SCORES_URL?: string;
}

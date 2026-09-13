import type { Ending } from "./core/state";

/** One finished run as the sheet stores it. */
export type Run = {
  readonly name: string;
  readonly score: number;
  readonly time: number;
  readonly ending: Ending;
};

export type ScoreEntry = Run & {
  /** ISO timestamp written by the sheet. */
  readonly at: string;
};

export const NAME_MAX = 16;

const ENDINGS: readonly Ending[] = ["shore", "raft", "sailboat", "ship"];

/** Same rule as the sheet, so the name shown is the name stored. */
export function cleanName(raw: string): string {
  return raw.replace(/^[\s=+]+/, "").trim().slice(0, NAME_MAX);
}

function isEnding(value: unknown): value is Ending {
  return typeof value === "string" && (ENDINGS as readonly string[]).includes(value);
}

function parseEntry(value: unknown): ScoreEntry | null {
  if (!value || typeof value !== "object") return null;
  const { at, name, score, time, ending } = value as Record<string, unknown>;
  const ok =
    typeof at === "string" &&
    typeof name === "string" && name.length > 0 &&
    typeof score === "number" && Number.isFinite(score) &&
    typeof time === "number" && Number.isFinite(time) &&
    isEnding(ending);
  return ok ? { at, name, score, time, ending } : null;
}

/** Rows come from a sheet people can edit by hand, so a broken one is dropped, not fatal. */
export function parseLeaderboard(data: unknown): readonly ScoreEntry[] | null {
  if (!data || typeof data !== "object") return null;
  const { top } = data as Record<string, unknown>;
  if (!Array.isArray(top)) return null;
  return top.map(parseEntry).filter((e): e is ScoreEntry => e !== null);
}

export async function fetchLeaderboard(url: string): Promise<readonly ScoreEntry[]> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`leaderboard fetch failed: ${response.status}`);
  const board = parseLeaderboard(await response.json());
  if (!board) throw new Error("leaderboard response is malformed");
  return board;
}

/** A string body goes as text/plain, which needs no preflight. */
export async function submitRun(url: string, run: Run): Promise<void> {
  const response = await fetch(url, { method: "POST", body: JSON.stringify(run) });
  if (!response.ok) throw new Error(`run submit failed: ${response.status}`);
  const result: unknown = await response.json();
  const ok = !!result && typeof result === "object" && (result as { ok?: unknown }).ok === true;
  if (!ok) throw new Error("run was rejected by the sheet");
}

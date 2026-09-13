import { describe, expect, it } from "vitest";
import { cleanName, parseLeaderboard } from "./scores";
import script from "../apps-script/Code.gs?raw";

const parseRun = new Function(`${script}; return parseRun;`)() as (
  text: string,
) => { name: string } | null;

const entry = { at: "2026-09-13T18:00:00.000Z", name: "MISU", score: 21000, time: 41.2, ending: "raft" };

it("writes submission timestamps as explicit UTC text in the sheet", () => {
  const rows: unknown[][] = [];
  const sheet = { appendRow: (row: unknown[]) => rows.push(row) };
  const doPost = new Function("SpreadsheetApp", "LockService", "ContentService", `${script}; return doPost;`)(
    { getActiveSpreadsheet: () => ({ getSheetByName: () => sheet }) },
    { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    { createTextOutput: (body: string) => ({ setMimeType: () => body }), MimeType: { JSON: "application/json" } },
  ) as (event: { postData: { contents: string } }) => string;
  const before = Date.now();
  expect(JSON.parse(doPost({ postData: { contents: JSON.stringify(entry) } }))).toEqual({ ok: true });
  expect(rows).toHaveLength(1);
  const timestamp = rows[0]?.[0];
  if (typeof timestamp !== "string") throw new Error("Expected a UTC timestamp string");
  expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  expect(Date.parse(timestamp)).toBeGreaterThanOrEqual(before);
  expect(Date.parse(timestamp)).toBeLessThanOrEqual(Date.now());
});

describe("parseLeaderboard", () => {
  it("accepts a board of well-formed entries", () => {
    expect(parseLeaderboard({ top: [entry] })).toEqual([entry]);
    expect(parseLeaderboard({ top: [] })).toEqual([]);
  });

  it("rejects anything that is not a board", () => {
    expect(parseLeaderboard(null)).toBeNull();
    expect(parseLeaderboard("nope")).toBeNull();
    expect(parseLeaderboard({ top: "nope" })).toBeNull();
    expect(parseLeaderboard({})).toBeNull();
  });

  it("drops broken rows and keeps the rest", () => {
    const broken = [
      { ...entry, score: "21000" },
      { ...entry, ending: "yacht" },
      { ...entry, name: "" },
      { ...entry, at: 5 },
      null,
    ];
    expect(parseLeaderboard({ top: [broken[0], entry, ...broken.slice(1)] })).toEqual([entry]);
  });
});

describe("cleanName", () => {
  it("trims and clamps to the sheet's limit", () => {
    expect(cleanName("  misu ")).toBe("misu");
    expect(cleanName("a".repeat(30))).toHaveLength(16);
  });

  it("drops a leading formula marker so the sheet stores text", () => {
    expect(cleanName("=SUM(A:A)")).toBe("SUM(A:A)");
    expect(cleanName("+=misu")).toBe("misu");
    expect(cleanName("=")).toBe("");
  });

  it.each([" =\"\"", "= =\"\"", "\t+ =SUM(A:A)", "\n=+ misu"])(
    "removes whitespace-separated formula markers in both client and server: %s",
    (name) => {
      const cleaned = cleanName(name);
      expect(cleaned).not.toMatch(/^[=+\s]/);
      expect(parseRun(JSON.stringify({ ...entry, name }))?.name).toBe(cleaned);
    },
  );

  it("rejects names made only of whitespace and formula markers", () => {
    const name = " = + \t=";
    expect(cleanName(name)).toBe("");
    expect(parseRun(JSON.stringify({ ...entry, name }))).toBeNull();
  });
});

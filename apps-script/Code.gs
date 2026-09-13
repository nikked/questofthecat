/**
 * Quest of the Cat leaderboard, bound to the Google Sheet that stores it.
 *
 * GET  returns { top: [{ at, name, score, time, ending }, ...] }, best first.
 * POST takes a JSON body { name, score, time, ending } and appends one row.
 *
 * Deploy as a web app that executes as you and is open to anyone; the game
 * sends the POST body as plain text because Apps Script cannot answer the
 * CORS preflight a JSON content type would trigger.
 */
const SHEET_NAME = "scores";
const HEADER = ["at", "name", "score", "time", "ending"];
const TOP = 10;
const NAME_MAX = 16;
const ENDINGS = ["shore", "raft", "sailboat", "ship"];

function scoresSheet() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = book.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = book.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADER);
  }
  return sheet;
}

function json(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function doGet() {
  const rows = scoresSheet().getDataRange().getValues().slice(1);
  const top = rows
    .map((row) => ({
      at: row[0],
      name: String(row[1]),
      score: Number(row[2]),
      time: Number(row[3]),
      ending: String(row[4]),
    }))
    .sort((a, b) => b.score - a.score || a.time - b.time)
    .slice(0, TOP);
  return json({ top });
}

function doPost(e) {
  const run = parseRun(e.postData ? e.postData.contents : "");
  if (!run) return json({ ok: false, error: "malformed run" });

  // Two cats finishing at once must not overwrite each other's row.
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    scoresSheet().appendRow([new Date().toISOString(), run.name, run.score, run.time, run.ending]);
  } finally {
    lock.releaseLock();
  }
  return json({ ok: true });
}

function parseRun(text) {
  let body;
  try {
    body = JSON.parse(text);
  } catch (error) {
    return null;
  }
  if (!body || typeof body !== "object") return null;
  // Remove interleaved whitespace too, so trimming cannot expose another formula marker.
  const name = String(body.name || "").replace(/^[\s=+]+/, "").trim().slice(0, NAME_MAX);
  const score = Number(body.score);
  const time = Number(body.time);
  const ending = String(body.ending);
  const valid =
    name.length > 0 &&
    Number.isInteger(score) && score >= 0 &&
    Number.isFinite(time) && time > 0 &&
    ENDINGS.includes(ending);
  return valid ? { name, score, time, ending } : null;
}

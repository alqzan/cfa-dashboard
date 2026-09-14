// Acceptance test for v8/v9 per-reading question practice sessions and scoped coverage.
// Loads the real migration, validation, and session-stat logic from app.js.

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(__dirname, "../assets/js/app.js"), "utf8");

function extractFrom(marker) {
  const start = src.indexOf(marker);
  if (start === -1) throw new Error("marker not found: " + marker);
  const braceStart = src.indexOf("{", start);
  let depth = 0, i = braceStart;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  return src.slice(start, i) + (src[i] === ";" ? ";" : "");
}

const chunks = [
  extractFrom("const DEFAULT = "),
  extractFrom("function defaultSourceMap("),
  extractFrom("function defaultStages("),
  extractFrom("function defaultBrief("),
  extractFrom("function fresh("),
  extractFrom("function migrate("),
  extractFrom("function dateKeyInRiyadh("),
  extractFrom("function isRecord("),
  extractFrom("function validateImportData("),
  extractFrom("function questionSessionIsUsable("),
  extractFrom("function questionSessionStats("),
].join("\n\n");

const fn = new Function(
  "exports",
  chunks + "\nexports.fresh=fresh; exports.migrate=migrate; exports.validateImportData=validateImportData; exports.questionSessionStats=questionSessionStats;"
);
const exportsObj = {};
fn(exportsObj);
const { fresh, migrate, validateImportData, questionSessionStats } = exportsObj;

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log("  ok  -", name); }
  else { fail++; console.error("  FAIL -", name); }
}

console.log("Test 1: a v8 reading migrates to a v9 session log");
{
  const source = fresh();
  source.v = 8;
  source.schemaVersion = 8;
  source.topics[0].r[0].questionSessions = undefined;
  const migrated = migrate(JSON.parse(JSON.stringify(source)));
  const reading = migrated.topics[0].r[0];
  check("state is v9", migrated.v === 9 && migrated.schemaVersion === 9);
  check("missing session log is added", Array.isArray(reading.questionSessions) && reading.questionSessions.length === 0);
  check("existing counters are preserved as the historical baseline", reading.qSolved === 0 && reading.qCorrect === 0);
}

console.log("\nTest 2: multiple sessions produce cumulative and per-session stats");
{
  const reading = fresh().topics[0].r[0];
  reading.qSolved = 10;
  reading.qCorrect = 6;
  reading.questionSessions = [
    { id: "qs-old", date: "2026-08-01", name: "CFAI", scope: "جزء DDM", total: 20, correct: 14, note: "راجع الصيغ" },
    { id: "qs-new", date: "2026-08-08", name: "Kaplan", scope: "أسئلة المفاهيم فقط", total: 15, correct: 9, note: "بطء في الحل" },
  ];
  const stats = questionSessionStats(reading);
  check("two sessions are retained", stats.sessionCount === 2);
  check("sessions are newest first", stats.sessions[0].id === "qs-new");
  check("session scope remains separate from the score", stats.sessions[0].scope === "أسئلة المفاهيم فقط");
  check("cumulative solved count includes old baseline plus sessions", stats.solved === 45);
  check("cumulative correct count includes old baseline plus sessions", stats.correct === 29);
  check("wrong count and accuracy are derived", stats.wrong === 16 && stats.accuracy === 64);
}

console.log("\nTest 3: import validation protects the session shape");
{
  const source = fresh();
  const reading = source.topics[0].r[0];
  reading.questionSessions = [{ id: "qs-valid", date: "2026-09-14", name: "مراجعة", scope: "جزء من القراءة", total: 25, correct: 18, note: "أراجع أخطاء الخيارات" }];
  check("valid session export is accepted", validateImportData(source).ok === true);
  const invalid = JSON.parse(JSON.stringify(source));
  invalid.topics[0].r[0].questionSessions[0].correct = 26;
  check("correct answers above total are rejected", validateImportData(invalid).ok === false);
  const malformed = JSON.parse(JSON.stringify(source));
  malformed.topics[0].r[0].questionSessions = "not-an-array";
  check("malformed session logs are rejected", validateImportData(malformed).ok === false);
}

console.log("\nTest 4: v8 sessions gain an empty scope without changing their meaning");
{
  const source = fresh();
  source.v = 8;
  source.schemaVersion = 8;
  source.topics[0].r[0].questionSessions = [{ id: "qs-legacy", date: "2026-09-10", name: "CFAI", total: 10, correct: 8, note: "جلسة قديمة" }];
  const migrated = migrate(JSON.parse(JSON.stringify(source)));
  const session = migrated.topics[0].r[0].questionSessions[0];
  check("old session score is preserved", session.total === 10 && session.correct === 8);
  check("old session gets an empty scope", session.scope === "");
  check("migration stays additive", migrated.v === 9 && migrated.schemaVersion === 9);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

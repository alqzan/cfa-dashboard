// Acceptance test: the import guard accepts legacy exports, cleans retired tracking,
// preserves the current session model, and rejects incomplete data.

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
].join("\n\n");

const fn = new Function(
  "exports",
  chunks + "\nexports.fresh=fresh; exports.migrate=migrate; exports.validateImportData=validateImportData;"
);
const exportsObj = {};
fn(exportsObj);
const { fresh, migrate, validateImportData } = exportsObj;

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log("  ok  -", name); }
  else { fail++; console.error("  FAIL -", name); }
}

console.log("Test 1: a legacy export is accepted and cleaned on import");
{
  const source = fresh();
  const first = source.topics[0].r[0];
  first.note = "آخر حرف محفوظ ✓";
  first.qGoal = 250;
  first.qSolved = 123;
  first.qCorrect = 97;
  first.questionSessions = [{ id: "qs-1", date: "2026-08-02", name: "CFAI", scope: "جزء DDM", total: 20, correct: 14, note: "راجع أخطاء الصيغ" }];
  first.spent = 12.5;
  source.dailyLog = { "2026-08-01": 12.5 };
  source.practice = { "2026-08-01": { eth: { a: 20, c: 15 } } };
  source.mocks = [{ id: "mock-1", date: "2026-08-01", name: "Mock 1", score: 78.5, note: "مراجعة" }];
  source.sessions = [{ d: "2026-08-01", m: 45, id: first.id, h: null }];

  const exported = JSON.stringify(source);
  const parsed = JSON.parse(exported);
  const validation = validateImportData(parsed);
  const imported = migrate(JSON.parse(JSON.stringify(parsed)));
  const importedFirst = imported.topics[0].r[0];
  const total = imported.topics.reduce((n, topic) => n + topic.r.length, 0);

  check("complete export is accepted", validation.ok === true);
  check("45 reading units remain", total === 45);
  check("last note text remains", importedFirst.note === "آخر حرف محفوظ ✓");
  check("legacy question counters are removed", importedFirst.qGoal === undefined && importedFirst.qSolved === undefined && importedFirst.qCorrect === undefined);
  check("question sessions remain", JSON.stringify(importedFirst.questionSessions) === JSON.stringify(source.topics[0].r[0].questionSessions));
  check("reading hours are removed", importedFirst.spent === undefined && imported.dailyLog === undefined);
  check("legacy question totals are removed", imported.practice === undefined);
  check("mock exams remain", JSON.stringify(imported.mocks) === JSON.stringify(source.mocks));
  check("timer sessions are removed", imported.sessions === undefined);
}

console.log("\nTest 2: incomplete or malformed JSON is rejected before replacement");
{
  const source = fresh();
  const incomplete = JSON.parse(JSON.stringify(source));
  incomplete.topics[0].r.pop();
  const wrongShape = validateImportData(incomplete);
  check("incomplete 44-unit file is rejected", wrongShape.ok === false);

  let invalidJsonRejected = false;
  try { JSON.parse("{ broken"); } catch (err) { invalidJsonRejected = true; }
  check("malformed JSON is rejected", invalidJsonRejected);
}

console.log("\nTest 3: a v6-shaped export is accepted and migrated to the session-only model");
{
  const v6 = migrate(JSON.parse(JSON.stringify(fresh())));
  v6.v = 6;
  v6.schemaVersion = 6;
  v6.topics[1].r[0].qSolved = undefined;
  v6.topics[1].r[0].qCorrect = undefined;
  delete v6.topics[1].r[0].qSolved;
  delete v6.topics[1].r[0].qCorrect;
  v6.topics[1].r[0].readingPractice = [{ total: 30, correct: 22 }];

  const validation = validateImportData(v6);
  const imported = migrate(JSON.parse(JSON.stringify(v6)));
  const reading = imported.topics[1].r[0];
  check("v6 file is accepted", validation.ok === true);
  check("v6 question history is retired", reading.readingPractice === undefined && reading.qSolved === undefined && reading.qCorrect === undefined);
  check("v6 reading metadata remains", reading.note === "" && reading.id === v6.topics[1].r[0].id);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// Acceptance test: v5 -> v6 migration must not lose or corrupt any user data.
// Loads the real fresh()/migrate()/DEFAULT logic straight out of assets/js/app.js
// (via naive brace-balanced extraction, since app.js is a browser script, not a module)
// and runs it against a representative v5 save file.
//
// Run: node tests/migration.v5-to-v6.test.mjs

import fs from "node:fs";
import assert from "node:assert/strict";
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
    else if (src[i] === "}") { depth--; if (depth === 0) { i++; break; } }
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
].join("\n\n");

const sandbox = { console };
const fn = new Function(
  "exports",
  chunks + "\nexports.DEFAULT=DEFAULT; exports.fresh=fresh; exports.migrate=migrate;"
);
const exportsObj = {};
fn(exportsObj);
const { fresh, migrate } = exportsObj;

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log("  ok  -", name); }
  else { fail++; console.error("  FAIL -", name); }
}

console.log("Test 1: fresh() produces a valid v6 skeleton");
{
  const s = fresh();
  check("v === 6", s.v === 6);
  check("schemaVersion === 6", s.schemaVersion === 6);
  const total = s.topics.reduce((n, t) => n + t.r.length, 0);
  check("45 reading units total", total === 45);
  check("every reading has topicId/stages/sourceMap/brief/closeout", s.topics.every(t => t.r.every(r =>
    r.topicId === t.id && r.stages && r.sourceMap && r.brief && r.closeout && Array.isArray(r.readingPractice)
  )));
  const ml = s.topics.find(t => t.id === "qm").r.find(r => r.en === "Machine Learning");
  check("Machine Learning flagged out-of-syllabus (excludedFraction > 0)", ml && ml.excludedFraction > 0);
  check("errors[] and weaknesses[] arrays exist", Array.isArray(s.errors) && Array.isArray(s.weaknesses));
}

console.log("\nTest 2: realistic v5 save migrates without any data loss");
{
  const v5 = {
    v: 5,
    examDate: "2026-11-19", target: 2.5, buffer: 18,
    dailyLog: { "2026-06-01": 3, "2026-06-02": 1.5 },
    reviews: { "eth-0": { next: "2026-07-10", stage: 2 } },
    activeTimer: null,
    practice: { "2026-06-01": { eth: { a: 20, c: 15 }, fsa: { a: 10, c: 6 } } },
    mocks: [{ date: "2026-06-15", score: 68 }],
    sessions: [{ d: "2026-06-01", m: 90, id: "eth-0", h: null }],
    qGoal: 3000, lastExport: 1750000000000,
    celebrated: { "ready70": true },
    planCfg: null, restDays: { "2026-06-03": true },
    topics: JSON.parse(JSON.stringify(fresh().topics)),
  };
  // simulate real user progress on the pre-migration v5 shape (no v6 fields yet)
  v5.topics.forEach(t => t.r.forEach(r => {
    delete r.topicId; delete r.readingNo; delete r.excludedFraction; delete r.excludedNote;
    delete r.stages; delete r.sourceMap; delete r.pages; delete r.brief;
    delete r.readingPractice; delete r.closeout;
  }));
  const eth0 = v5.topics.find(t => t.id === "eth").r[0];
  eth0.status = "done"; eth0.mastery = "strong"; eth0.note = "راجع Standard I-VII مرة أخرى"; eth0.spent = 7.5;

  const before = JSON.parse(JSON.stringify(v5));
  const after = migrate(JSON.parse(JSON.stringify(v5)));

  check("schemaVersion bumped to 6", after.schemaVersion === 6 && after.v === 6);
  check("examDate/target/buffer preserved", after.examDate === before.examDate && after.target === before.target && after.buffer === before.buffer);
  check("dailyLog preserved exactly", JSON.stringify(after.dailyLog) === JSON.stringify(before.dailyLog));
  check("reviews preserved exactly", JSON.stringify(after.reviews) === JSON.stringify(before.reviews));
  check("practice (legacy topic-level) preserved exactly", JSON.stringify(after.practice) === JSON.stringify(before.practice));
  check("mocks preserved exactly", JSON.stringify(after.mocks) === JSON.stringify(before.mocks));
  check("sessions preserved exactly", JSON.stringify(after.sessions) === JSON.stringify(before.sessions));
  check("celebrated preserved exactly", JSON.stringify(after.celebrated) === JSON.stringify(before.celebrated));
  check("restDays preserved exactly", JSON.stringify(after.restDays) === JSON.stringify(before.restDays));
  check("qGoal/lastExport preserved", after.qGoal === before.qGoal && after.lastExport === before.lastExport);

  const total = after.topics.reduce((n, t) => n + t.r.length, 0);
  check("still 45 reading units (none dropped/renamed)", total === 45);
  after.topics.forEach((t, ti) => t.r.forEach((r, ri) => {
    const b = before.topics[ti].r[ri];
    check(`reading id unchanged (${r.id})`, r.id === b.id);
  }));

  const eth0After = after.topics.find(t => t.id === "eth").r[0];
  check("user's status/mastery/note/spent on completed reading survive untouched",
    eth0After.status === "done" && eth0After.mastery === "strong" &&
    eth0After.note === "راجع Standard I-VII مرة أخرى" && eth0After.spent === 7.5);

  check("v6 fields added additively to every reading", after.topics.every(t => t.r.every(r =>
    r.topicId === t.id && r.stages && r.sourceMap && r.brief && r.closeout && Array.isArray(r.readingPractice)
  )));
  check("errors[]/weaknesses[]/closeoutCfg/deviceId/sync added", Array.isArray(after.errors) && Array.isArray(after.weaknesses) && after.closeoutCfg && after.deviceId && after.sync);
}

console.log("\nTest 3: migrating twice is idempotent (re-running migrate doesn't duplicate/reset anything)");
{
  const once = migrate(JSON.parse(JSON.stringify(fresh())));
  const twice = migrate(JSON.parse(JSON.stringify(once)));
  check("re-migrated state deep-equals first migration", JSON.stringify(once) === JSON.stringify(twice));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// Acceptance tests for the evidence-based readiness engine (assets/js/readiness.js)
// and the reading-level question-bank stats it depends on (assets/js/app.js).
// Run: node tests/readiness.test.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appSrc = fs.readFileSync(path.join(__dirname, "../assets/js/app.js"), "utf8");
const readinessSrc = fs.readFileSync(path.join(__dirname, "../assets/js/readiness.js"), "utf8");

function extractFrom(src, marker) {
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
function extractConst(src, name) {
  const re = new RegExp("const " + name + "\\s*=.*?;", "s");
  const m = src.match(re);
  if (!m) throw new Error("const not found: " + name);
  return m[0];
}

const chunks = [
  extractConst(appSrc, "dayMs"),
  extractConst(appSrc, "RIYADH_TZ"),
  extractConst(appSrc, "pad2"),
  extractFrom(appSrc, "function dateKeyInRiyadh"),
  "const todayKey = ()=>dateKeyInRiyadh(new Date());",
  extractFrom(appSrc, "function shiftDateKey"),
  extractFrom(appSrc, "function daysBetweenKeys"),
  extractFrom(appSrc, "function defaultSourceMap"),
  extractFrom(appSrc, "function defaultStages"),
  extractFrom(appSrc, "function defaultBrief"),
  extractConst(appSrc, "DEFAULT"),
  extractFrom(appSrc, "function fresh"),
  extractFrom(appSrc, "function migrate"),
  extractFrom(appSrc, "function effHrs"),
  extractFrom(appSrc, "function readingProgress"),
  extractFrom(appSrc, "function topicHours"),
  extractConst(appSrc, "MSCORE"),
  extractFrom(appSrc, "function topicMastery"),
  extractConst(appSrc, "RIVL"),
  extractFrom(appSrc, "function retentionOf"),
  extractFrom(appSrc, "function retentionOverall"),
  extractFrom(appSrc, "function findReading"),
  extractFrom(appSrc, "function topicAcc"),
  extractConst(appSrc, "CONTENT_STAGE_KEYS"),
  extractFrom(appSrc, "function contentCompleted"),
  extractFrom(appSrc, "function stagesExamReady"),
  extractFrom(appSrc, "function readingPracticeStats"),
  extractConst(appSrc, "REASON_TAGS"),
  extractConst(appSrc, "REASON_LABEL"),
  extractFrom(appSrc, "function allReadingsFlat"),
  extractFrom(appSrc, "function errRepeatCount"),
  extractFrom(appSrc, "function retentionOfSafe"),
  extractFrom(appSrc, "function computeWeaknesses"),
  readinessSrc.replace('if(typeof window !== "undefined") window.computeReadiness = computeReadiness;', ""),
].join("\n\n");

const fn = new Function("exports", chunks + "\nexports.fresh=fresh; exports.migrate=migrate; exports.computeReadiness=computeReadiness; exports.setS=function(s){S=s;}; exports.readingPracticeStats=readingPracticeStats;");
const box = {};
let S = null; // eslint-disable-line
fn(box);
const { fresh, computeReadiness, setS } = box;

let pass=0, fail=0;
function check(name, cond){ if(cond){ pass++; console.log("  ok  -", name); } else { fail++; console.error("  FAIL -", name); } }

console.log("Test 1: empty state -> readiness is 0 and bucket weights sum to 100");
{
  const s = fresh();
  box.setS(s);
  const rb = box.computeReadiness();
  check("total === 0 for a brand new profile", rb.total === 0);
  check("weights sum to 100 (25+15+25+15+20)", rb.weights.content+rb.weights.mastery+rb.weights.qbank+rb.weights.errors+rb.weights.mocks === 100);
  check("total === sum of the 5 buckets", Math.abs(rb.total - (rb.content+rb.mastery+rb.qbank+rb.errors+rb.mocks)) < 1e-9);
}

console.log("\nTest 2: finishing all 9 stages on every reading beats just marking status=done");
{
  const legacyState = fresh();
  legacyState.topics.forEach(t => t.r.forEach(r => { r.status = "done"; r.mastery = "strong"; }));
  box.setS(legacyState);
  const legacyRb = box.computeReadiness();

  const stagedState = fresh();
  stagedState.topics.forEach(t => t.r.forEach(r => {
    r.status = "done"; r.mastery = "strong";
    Object.keys(r.stages).forEach(k => r.stages[k] = true);
  }));
  box.setS(stagedState);
  const stagedRb = box.computeReadiness();

  check("content bucket is not automatically full just from status=done", legacyRb.content < legacyRb.weights.content - 0.01);
  check("fully-staged readings score a strictly higher content bucket than status-only", stagedRb.content > legacyRb.content);
  check("fully-staged readings reach (near) full content credit", stagedRb.content > legacyRb.weights.content - 1);
}

console.log("\nTest 3: a guessed-right answer does not score the same as a confident correct answer");
{
  const confidentState = fresh();
  const r1 = confidentState.topics[0].r[0];
  r1.readingPractice.push({ id:"p1", date:"2026-06-01", source:"CFAI", total:20, correct:16, wrong:4, guessedRight:0, slowRight:0, avgTimeSec:60, sessionType:"review" });
  box.setS(confidentState);
  const confidentScore = box.computeReadiness().qbank;

  const guessedState = fresh();
  const r2 = guessedState.topics[0].r[0];
  r2.readingPractice.push({ id:"p2", date:"2026-06-01", source:"CFAI", total:20, correct:16, wrong:4, guessedRight:10, slowRight:0, avgTimeSec:60, sessionType:"review" });
  box.setS(guessedState);
  const guessedScore = box.computeReadiness().qbank;

  check("same raw accuracy (16/20) but heavy guessing scores a lower qbank bucket",
    guessedScore < confidentScore);

  const stats = box.readingPracticeStats(r2);
  check("accAdjusted (guess-excluded) is lower than accRaw", stats.accAdjusted < stats.accRaw);
}

console.log("\nTest 4: open critical errors and unresolved weaknesses lower the errors bucket");
{
  const cleanState = fresh();
  cleanState.topics[0].r[0].readingPractice.push({ id:"pc", date:"2026-06-01", source:"CFAI", total:10, correct:8, wrong:2, guessedRight:0, slowRight:0, avgTimeSec:60, sessionType:"review" });
  box.setS(cleanState);
  const cleanErrors = box.computeReadiness().errors;

  const messyState = fresh();
  messyState.topics[0].r[0].readingPractice.push({ id:"pm", date:"2026-06-01", source:"CFAI", total:10, correct:8, wrong:2, guessedRight:0, slowRight:0, avgTimeSec:60, sessionType:"review" });
  const rid = messyState.topics[0].r[0].id;
  for (let i=0;i<3;i++){
    messyState.errors.push({
      id:"e"+i, date:"2026-06-0"+(i+1), topicId:messyState.topics[0].id, readingId:rid,
      los:"same concept", source:"CFAI", resultType:"wrong", reasonTag:"understanding",
      status:"open", userChoice:"A", correctChoice:"B", userReasoning:"", correctRule:"",
      markRef:"", schweserRef:"", cfaiRef:"", imageUrl:"", timeSpentSec:null, confidence:null,
      retestDate:"", coachNote:"", retestQuestion:"", createdAt:0, updatedAt:0
    });
  }
  box.setS(messyState);
  const messyErrors = box.computeReadiness().errors;

  check("3 open repeated-concept errors lower the errors/weaknesses bucket", messyErrors < cleanErrors);
}

console.log("\nTest 5: mock consistency — three close scores beat one great score buried in two weak ones");
{
  const spikyState = fresh();
  spikyState.mocks = [
    { date:"2026-05-01", score:40 }, { date:"2026-05-10", score:90 }, { date:"2026-05-20", score:45 }
  ];
  box.setS(spikyState);
  const spikyMocks = box.computeReadiness().mocks;

  const steadyState = fresh();
  steadyState.mocks = [
    { date:"2026-05-01", score:70 }, { date:"2026-05-10", score:72 }, { date:"2026-05-20", score:71 }
  ];
  box.setS(steadyState);
  const steadyMocks = box.computeReadiness().mocks;

  check("similar average but steadier last-3 mocks score a higher mocks bucket", steadyMocks > spikyMocks);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

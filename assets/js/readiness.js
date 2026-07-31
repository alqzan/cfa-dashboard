"use strict";
/* ================= Evidence-based readiness formula (CFA Personal Coach v6) =================
   Kept in its own file on purpose so the weighting/curve can be tuned without touching the
   rest of app.js. This file is a plain script (not a module) loaded before app.js, and reads
   the same globals app.js defines (S, effHrs, readingProgress, topicMastery, retentionOverall,
   readingPracticeStats, computeWeaknesses, CONTENT_STAGE_KEYS) at call time — by the time
   computeReadiness() is actually invoked (from renderReadiness(), after boot), all of app.js
   has already run, so load order between the two files only needs readiness.js to appear
   first in index.html, not to be self-contained.

   Breakdown (must sum to 100):
     1. Content & stage coverage ......... 25
     2. Mastery & retention .............. 15
     3. Question bank (per reading) ...... 25
     4. Error closure & weaknesses ....... 15
     5. Mock exams ........................ 20
*/
const READINESS_WEIGHTS = { content:25, mastery:15, qbank:25, errors:15, mocks:20 };

function clampUnit_(n){ return Math.max(0, Math.min(1, n)); }

/* A reading is never "full credit" just for being marked done — real stage completion
   (source watched, Mark notes, Schweser Exam Focus, formulas, Pre-Question Brief) counts
   more. Readings marked done before v6 (no stages checked yet) get a capped legacy credit
   so historical progress is never treated as zero, per "don't punish old data". */
function readingContentScore(r){
  const stageDone = CONTENT_STAGE_KEYS.filter(k => r.stages && r.stages[k]).length;
  const stageFrac = stageDone / CONTENT_STAGE_KEYS.length;
  const legacyFrac = r.status==="done" ? 0.7 : (r.status==="doing" ? 0.4*readingProgress(r) : 0);
  return Math.max(stageFrac, legacyFrac);
}
function readinessContentBucket(){
  let num=0, den=0;
  S.topics.forEach(t=>{
    let h=0, s=0;
    t.r.forEach(r=>{ const eh=effHrs(r); h+=eh; s+=eh*readingContentScore(r); });
    num += (t.weight/100) * (h ? s/h : 0);
    den += (t.weight/100);
  });
  return den ? clampUnit_(num/den) : 0;
}

/* Mastery (self-rated, hours-weighted) blended with actual retention decay —
   forgetting a finished reading pulls this bucket down; reviewing it pulls it back up. */
function readinessMasteryBucket(){
  let num=0, den=0;
  S.topics.forEach(t=>{ num += (t.weight/100)*(topicMastery(t)/3); den += (t.weight/100); });
  const masteryNorm = den ? clampUnit_(num/den) : 0;
  /* retentionOverall() defaults to "100% intact" when nothing is finished yet (a reasonable
     display choice for the متانة card), but that must not hand a brand-new profile free
     readiness points — so retention only counts here once at least one reading is done. */
  const hasCompleted = S.topics.some(t=>t.r.some(r=>r.status==="done"));
  let retention = 0;
  if(hasCompleted){ try{ retention = retentionOverall(); }catch(e){ retention = 0; } }
  return clampUnit_(0.5*masteryNorm + 0.5*retention);
}

/* Reading-level question bank: accuracy is computed after excluding guessed-right answers
   (a guess is not a mastered answer), volume is compared against an expected count scaled
   by the topic's exam weight, and both a high guess-rate and a high slow-answer rate pull
   the score down — being slow-but-right is a smaller penalty than guessing. */
function readingQbankScore(t, r){
  const st = readingPracticeStats(r);
  if(!st.total) return 0;
  const accNorm = clampUnit_(((st.accAdjusted||0)-50)/25);
  const expected = Math.max(
    (S.closeoutCfg && S.closeoutCfg.minQuestions) || 20,
    (S.qGoal||2000) * (t.weight/100) / Math.max(1, t.r.length)
  );
  const volumeNorm = Math.sqrt(clampUnit_(st.total/expected));
  const guessPenalty = 1 - clampUnit_(st.guessRate/100)*0.3;
  const slowFrac = st.total ? st.slowRight/st.total : 0;
  const slowPenalty = 1 - clampUnit_(slowFrac)*0.15;
  return clampUnit_(accNorm*volumeNorm*guessPenalty*slowPenalty);
}
function readinessQbankBucket(){
  let num=0, den=0;
  S.topics.forEach(t=>{
    let h=0, s=0;
    t.r.forEach(r=>{ const eh=effHrs(r); h+=eh; s+=eh*readingQbankScore(t,r); });
    num += (t.weight/100) * (h ? s/h : 0);
    den += (t.weight/100);
  });
  return den ? clampUnit_(num/den) : 0;
}

/* Open/reopened errors and unresolved weaknesses both cap this bucket — closing an error
   (or a weakness clearing on its own once the underlying accuracy improves) raises it back. */
function readinessErrorsBucket(){
  /* "no open errors" only means something once there is actual study activity to have
     produced errors from — a completely untouched profile gets no free credit here. */
  const hasActivity = (S.errors && S.errors.length>0) ||
    S.topics.some(t=>t.r.some(r=>(r.readingPractice&&r.readingPractice.length>0) || r.status!=="todo"));
  if(!hasActivity) return 0;
  const openCount = (S.errors||[]).filter(e=>e.status==="open"||e.status==="reopened").length;
  const openPenalty = clampUnit_(openCount/10);
  let weaknesses=[];
  try{ weaknesses = computeWeaknesses(); }catch(e){ weaknesses=[]; }
  const sevSum = weaknesses.slice(0,10).reduce((s,w)=>s+w.severity,0);
  const weaknessPenalty = clampUnit_(sevSum/40);
  return clampUnit_(1 - 0.6*openPenalty - 0.4*weaknessPenalty);
}

/* Recent mocks matter more than old ones (recency-weighted average of the last 5), and
   three-mock consistency matters more than any single best score (a low spread across the
   last 3 boosts the bucket; a single great mock surrounded by weak ones does not). */
function readinessMocksBucket(){
  const mocks=(S.mocks||[]).slice().sort((a,b)=> a.date<b.date?1:-1).slice(0,5);
  if(!mocks.length) return 0;
  const weights=[1,0.7,0.5,0.35,0.25];
  let wsum=0, wtot=0;
  mocks.forEach((m,i)=>{ const w=weights[i]||0.15; wsum+=m.score*w; wtot+=w; });
  const weightedAvg = wtot ? wsum/wtot : 0;
  const accuracy = clampUnit_((weightedAvg-50)/25);
  const confidence = 0.5 + 0.5*Math.min(1, mocks.length/3);
  let consistencyFactor = 0.7; /* neutral until there are 3 data points to judge consistency from */
  if(mocks.length>=3){
    const last3=mocks.slice(0,3).map(m=>m.score);
    const mean=last3.reduce((a,b)=>a+b,0)/3;
    const variance=last3.reduce((s,x)=>s+(x-mean)*(x-mean),0)/3;
    consistencyFactor = clampUnit_(1 - Math.sqrt(variance)/20);
  }
  return clampUnit_(accuracy*confidence*(0.7+0.3*consistencyFactor));
}

function computeReadiness(){
  const content = readinessContentBucket()*READINESS_WEIGHTS.content;
  const mastery = readinessMasteryBucket()*READINESS_WEIGHTS.mastery;
  const qbank   = readinessQbankBucket()*READINESS_WEIGHTS.qbank;
  const errors  = readinessErrorsBucket()*READINESS_WEIGHTS.errors;
  const mocks   = readinessMocksBucket()*READINESS_WEIGHTS.mocks;
  return { content, mastery, qbank, errors, mocks, total: content+mastery+qbank+errors+mocks, weights: READINESS_WEIGHTS };
}
if(typeof window !== "undefined") window.computeReadiness = computeReadiness;

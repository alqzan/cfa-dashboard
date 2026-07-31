"use strict";
/* ================= CFA Personal Coach v6 — Firebase sync (optional layer) =================
   This is a plain ES module, loaded with <script type="module">. It only ever runs if
   assets/js/firebase-config.js exists (see firebase-config.example.js) — without that file
   the app stays fully local, exactly as before, and the whole "مزامنة السحابة" section stays
   hidden (see app.js's initCloudPanel()).

   Bridge to app.js (a classic, non-module script): module scripts do not share the classic
   top-level `let`/`const` scope, so app.js explicitly exposes window.getCoachState /
   window.setCoachState / window.coachSave / window.coachRenderAll right next to its `let S`
   declaration — that's the only coupling between the two files in either direction.

   Firestore layout (per spec):
     users/{uid}/profile/settings   — one doc: exam settings, goals, config
     users/{uid}/readings/{id}      — one doc per reading (status, mastery, notes, stages, ...)
     users/{uid}/errors/{id}        — دفتر الأخطاء
     users/{uid}/practice/{id}      — legacy topic-level question bank entries
     users/{uid}/mocks/{id}         — mock exam results
     users/{uid}/sessions/{id}      — timer sessions
     users/{uid}/dailyLogs/{date}   — daily hours log
     users/{uid}/reviews/{id}       — spaced-review schedule (id = readingId)

   Conflict model (documented, not hidden): this app does not track a separate updatedAt per
   field — it tracks one lastLocalChangeAt for the whole local state (stamped in app.js's
   save()). On every sync: records that exist on only one side always survive (pure union,
   nothing is ever dropped just because the other side doesn't have it yet). Records that
   exist on both sides and differ are resolved by comparing each side's change time against
   the timestamp of the last successful sync: if only one side changed since then, that side
   wins outright; if both changed since the last sync, that is a genuine conflict — for
   long-text fields (reading notes/brief, error reasoning) both versions are kept (the losing
   text is appended, clearly marked, rather than silently discarded) and the conflict is
   recorded in S.syncConflicts so the UI can surface it; for small scalar logs (mocks,
   sessions, daily hours, reviews) the local version wins but the event is still logged as a
   conflict for visibility. Deletes are tombstones (deletedAt) and only "stick" once every
   linked device has synced past that point — a delete cannot be silently resurrected by an
   older, not-yet-synced device pushing its stale copy back up, because tombstones always
   beat a plain update unless the update's timestamp is strictly newer than the deletion. */

const SDK_VERSION = "10.13.2";
const LINKED_UID_KEY = "cfa_l2_linked_uid";
const LAST_SYNC_KEY = "cfa_l2_last_sync_at";

let fs = null, authMod = null, appMod = null;
let app = null, auth = null, db = null;
let currentUser = null;
let currentStatus = "local"; /* local | syncing | synced | conflict | offline | error */
let lastSyncAt = null;
let firstLinkPending = false;
let pendingCloudSnapshot = null;
const listeners = new Set();

function getStatus(){
  return {
    available: !!db,
    user: currentUser ? { email: currentUser.email, uid: currentUser.uid } : null,
    status: currentStatus,
    lastSyncAt,
    firstLinkPending,
    conflicts: (window.getCoachState && window.getCoachState() && window.getCoachState().syncConflicts) || []
  };
}
function notify(){ listeners.forEach(fn => { try{ fn(getStatus()); }catch(e){} }); }
function onChange(fn){ listeners.add(fn); return () => listeners.delete(fn); }

/* ---------- pure merge helpers (exported for tests, no Firestore/browser dependency) ---------- */
function unionMergeById(localArr, cloudArr, lastSyncAt, opts){
  opts = opts || {};
  const textFields = opts.textFields || [];
  const conflicts = [];
  const byId = new Map();
  (localArr||[]).forEach(r => byId.set(r.id, { local:r, cloud:null }));
  (cloudArr||[]).forEach(r => { const e = byId.get(r.id); if(e) e.cloud = r; else byId.set(r.id, { local:null, cloud:r }); });

  const out = [];
  byId.forEach((pair, id) => {
    const { local, cloud } = pair;
    if(local && !cloud){ if(!local.deletedAt) out.push(local); return; }
    if(cloud && !local){ if(!cloud.deletedAt) out.push(cloud); return; }
    /* present on both sides */
    const lt = local.updatedAt||0, ct = cloud.updatedAt||0;
    if(local.deletedAt && (!cloud.updatedAt || cloud.updatedAt <= local.deletedAt)){ return; } /* tombstone wins */
    if(cloud.deletedAt && (!local.updatedAt || local.updatedAt <= cloud.deletedAt)){ return; }
    const localChanged = lt > (lastSyncAt||0);
    const cloudChanged = ct > (lastSyncAt||0);
    if(localChanged && !cloudChanged){ out.push(local); return; }
    if(cloudChanged && !localChanged){ out.push(cloud); return; }
    if(!localChanged && !cloudChanged){ out.push(ct >= lt ? cloud : local); return; }
    /* both changed since last sync -> real conflict */
    const merged = Object.assign({}, ct >= lt ? cloud : local);
    const loser = ct >= lt ? local : cloud;
    let textDiverged = false;
    textFields.forEach(path => {
      const a = getPath(merged, path), b = getPath(loser, path);
      if(a && b && a !== b && b.indexOf(a) === -1){
        setPath(merged, path, a + "\n\n--- نسخة أخرى من جهاز آخر ---\n" + b);
        textDiverged = true;
      }
    });
    conflicts.push({ id, kind: opts.kind||"record", textDiverged, at: Date.now() });
    out.push(merged);
  });
  return { merged: out, conflicts };
}
function getPath(obj, path){ return path.split(".").reduce((o,k)=> (o&&o[k]!=null)?o[k]:null, obj); }
function setPath(obj, path, val){ const ks=path.split("."); let o=obj; for(let i=0;i<ks.length-1;i++){ o[ks[i]]=o[ks[i]]||{}; o=o[ks[i]]; } o[ks[ks.length-1]]=val; }

/* ---------- Firestore boot ---------- */
async function boot(){
  let cfgMod;
  try{ cfgMod = await import("./firebase-config.js"); }
  catch(e){ currentStatus="local"; notify(); return; } /* no config file -> stay local-only */
  try{
    appMod = await import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`);
    authMod = await import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-auth.js`);
    fs = await import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-firestore.js`);
    app = appMod.initializeApp(cfgMod.firebaseConfig);
    auth = authMod.getAuth(app);
    db = fs.initializeFirestore(app, {
      localCache: fs.persistentLocalCache({ tabManager: fs.persistentSingleTabManager({}) })
    });
  }catch(e){
    console.error("Firebase init failed", e);
    currentStatus="error"; notify(); return;
  }
  try{ lastSyncAt = Number(localStorage.getItem(LAST_SYNC_KEY)) || null; }catch(e){}
  authMod.onAuthStateChanged(auth, async (u) => {
    currentUser = u;
    if(u) await handleSignedIn();
    else currentStatus = "local";
    notify();
  });
  notify();
}

async function signUp(email, pw){
  if(!auth) throw new Error("Firebase غير مهيّأ");
  await authMod.createUserWithEmailAndPassword(auth, email, pw);
}
async function signIn(email, pw){
  if(!auth) throw new Error("Firebase غير مهيّأ");
  await authMod.signInWithEmailAndPassword(auth, email, pw);
}
async function signOutUser(){
  if(!auth) return;
  await authMod.signOut(auth);
  currentStatus = "local"; notify();
}

function cloudHasData(cloud){
  return cloud.readings.length>0 || cloud.errors.length>0 || cloud.mocks.length>0 || cloud.sessions.length>0;
}

async function handleSignedIn(){
  currentStatus="syncing"; notify();
  try{
    const cloud = await pullAll();
    let linkedUid=null; try{ linkedUid = localStorage.getItem(LINKED_UID_KEY); }catch(e){}
    if(linkedUid !== currentUser.uid && cloudHasData(cloud)){
      pendingCloudSnapshot = cloud; firstLinkPending = true; currentStatus = "local"; notify(); return;
    }
    try{ localStorage.setItem(LINKED_UID_KEY, currentUser.uid); }catch(e){}
    await mergeAndApply(cloud);
    await pushAll();
    markSynced();
  }catch(e){
    console.error("sync failed", e);
    currentStatus = navigator.onLine ? "error" : "offline"; notify();
  }
}
function markSynced(){
  lastSyncAt = Date.now();
  try{ localStorage.setItem(LAST_SYNC_KEY, String(lastSyncAt)); }catch(e){}
  const s = window.getCoachState && window.getCoachState();
  currentStatus = (s && s.syncConflicts && s.syncConflicts.length) ? "conflict" : "synced";
  notify();
}

async function useLocalData(){
  firstLinkPending=false; pendingCloudSnapshot=null;
  try{ localStorage.setItem(LINKED_UID_KEY, currentUser.uid); }catch(e){}
  await pushAll(); markSynced();
}
async function useCloudData(){
  if(!pendingCloudSnapshot) return;
  applyCloudWholesale(pendingCloudSnapshot);
  try{ localStorage.setItem(LINKED_UID_KEY, currentUser.uid); }catch(e){}
  firstLinkPending=false; pendingCloudSnapshot=null;
  markSynced();
}
async function mergeBothData(){
  if(!pendingCloudSnapshot) return;
  await mergeAndApply(pendingCloudSnapshot);
  await pushAll();
  try{ localStorage.setItem(LINKED_UID_KEY, currentUser.uid); }catch(e){}
  firstLinkPending=false; pendingCloudSnapshot=null;
  markSynced();
}
async function syncNow(){
  if(!currentUser){ notify(); return; }
  currentStatus="syncing"; notify();
  try{
    const cloud = await pullAll();
    await mergeAndApply(cloud);
    await pushAll();
    markSynced();
  }catch(e){
    console.error("sync failed", e);
    currentStatus = navigator.onLine ? "error" : "offline"; notify();
  }
}

/* ---------- pull ---------- */
async function pullAll(){
  const uid = currentUser.uid;
  const col = (name) => fs.collection(db, "users", uid, name);
  const [profileSnap, readingsSnap, errorsSnap, practiceSnap, mocksSnap, sessionsSnap, dailySnap, reviewsSnap] = await Promise.all([
    fs.getDoc(fs.doc(db, "users", uid, "profile", "settings")),
    fs.getDocs(col("readings")),
    fs.getDocs(col("errors")),
    fs.getDocs(col("practice")),
    fs.getDocs(col("mocks")),
    fs.getDocs(col("sessions")),
    fs.getDocs(col("dailyLogs")),
    fs.getDocs(col("reviews")),
  ]);
  const toArr = (snap) => snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
  return {
    profile: profileSnap.exists() ? profileSnap.data() : null,
    readings: toArr(readingsSnap), errors: toArr(errorsSnap), practice: toArr(practiceSnap),
    mocks: toArr(mocksSnap), sessions: toArr(sessionsSnap), dailyLogs: toArr(dailySnap), reviews: toArr(reviewsSnap)
  };
}

/* ---------- local <-> Firestore-shaped conversion ---------- */
function ensureId(obj, prefix){ if(!obj.id) obj.id = prefix+"-"+Date.now()+"-"+Math.random().toString(36).slice(2,7); return obj.id; }
function localToDocs(S){
  const now = Date.now();
  const readings = [];
  S.topics.forEach(t => t.r.forEach(r => {
    readings.push({
      id:r.id, topicId:t.id, status:r.status, mastery:r.mastery, note:r.note, spent:r.spent, hrs:r.hrs,
      readingNo:r.readingNo, excludedFraction:r.excludedFraction, excludedNote:r.excludedNote,
      stages:r.stages, sourceMap:r.sourceMap, pages:r.pages, brief:r.brief,
      readingPractice:r.readingPractice, closeout:r.closeout, updatedAt: r.updatedAt||now
    });
  }));
  const errors = (S.errors||[]).map(e => Object.assign({}, e, { updatedAt: e.updatedAt||now }));
  const practice = [];
  for(const day in (S.practice||{})){ for(const topicId in S.practice[day]){
    const e=S.practice[day][topicId];
    practice.push({ id: day+"_"+topicId, date:day, topicId, a:e.a, c:e.c, updatedAt: e.updatedAt||now });
  } }
  const mocks = (S.mocks||[]).map(m => { ensureId(m,"mock"); return Object.assign({}, m, { updatedAt: m.updatedAt||now }); });
  const sessions = (S.sessions||[]).map(s => { ensureId(s,"sess"); return Object.assign({}, s, { updatedAt: s.updatedAt||now }); });
  const dailyLogs = Object.keys(S.dailyLog||{}).map(date => ({ id:date, date, hours:S.dailyLog[date], updatedAt: now }));
  const reviews = Object.keys(S.reviews||{}).map(id => Object.assign({ id }, S.reviews[id], { updatedAt: now }));
  const profile = {
    examDate:S.examDate, target:S.target, buffer:S.buffer, qGoal:S.qGoal, celebrated:S.celebrated,
    restDays:S.restDays, planCfg:S.planCfg, closeoutCfg:S.closeoutCfg, readinessCfg:S.readinessCfg,
    schemaVersion:S.schemaVersion, deviceId:S.deviceId, updatedAt: now
  };
  return { profile, readings, errors, practice, mocks, sessions, dailyLogs, reviews };
}

async function pushAll(){
  const S = window.getCoachState();
  const docs = localToDocs(S);
  const uid = currentUser.uid;
  const batch = fs.writeBatch(db);
  batch.set(fs.doc(db, "users", uid, "profile", "settings"), docs.profile, { merge:true });
  const setAll = (name, arr) => arr.forEach(d => batch.set(fs.doc(db, "users", uid, name, String(d.id)), d, { merge:false }));
  setAll("readings", docs.readings);
  setAll("errors", docs.errors);
  setAll("practice", docs.practice);
  setAll("mocks", docs.mocks);
  setAll("sessions", docs.sessions);
  setAll("dailyLogs", docs.dailyLogs);
  setAll("reviews", docs.reviews);
  await batch.commit();
  window.coachSave();
}

function applyCloudWholesale(cloud){
  const S = window.getCoachState();
  if(cloud.profile){
    ["examDate","target","buffer","qGoal","celebrated","restDays","planCfg","closeoutCfg","readinessCfg"].forEach(k=>{
      if(cloud.profile[k]!==undefined) S[k]=cloud.profile[k];
    });
  }
  const readingById={}; cloud.readings.forEach(r=>readingById[r.id]=r);
  S.topics.forEach(t=>t.r.forEach(r=>{
    const c=readingById[r.id]; if(!c) return;
    ["status","mastery","note","spent","hrs","readingNo","excludedFraction","excludedNote","stages","sourceMap","pages","brief","readingPractice","closeout"].forEach(k=>{
      if(c[k]!==undefined) r[k]=c[k];
    });
  }));
  S.errors = cloud.errors.map(e=>{ const {id,...rest}=e; return Object.assign({id}, rest); });
  const practice={};
  cloud.practice.forEach(p=>{ practice[p.date]=practice[p.date]||{}; practice[p.date][p.topicId]={a:p.a,c:p.c}; });
  S.practice = practice;
  S.mocks = cloud.mocks.map(m=>({...m}));
  S.sessions = cloud.sessions.map(s=>({...s}));
  const dailyLog={}; cloud.dailyLogs.forEach(d=>{ dailyLog[d.date]=d.hours; }); S.dailyLog=dailyLog;
  const reviews={}; cloud.reviews.forEach(r=>{ const {id,updatedAt,...rest}=r; reviews[id]=rest; }); S.reviews=reviews;
  window.setCoachState(S); window.coachSave(); window.coachRenderAll();
}

async function mergeAndApply(cloud){
  const S = window.getCoachState();
  const local = localToDocs(S);
  const conflicts = [];

  const readingsMerge = unionMergeById(local.readings, cloud.readings, lastSyncAt, { kind:"reading", textFields:["note","brief.checklist"] });
  const errorsMerge = unionMergeById(local.errors, cloud.errors, lastSyncAt, { kind:"error", textFields:["userReasoning","coachNote"] });
  const practiceMerge = unionMergeById(local.practice, cloud.practice, lastSyncAt, { kind:"practice" });
  const mocksMerge = unionMergeById(local.mocks, cloud.mocks, lastSyncAt, { kind:"mock" });
  const sessionsMerge = unionMergeById(local.sessions, cloud.sessions, lastSyncAt, { kind:"session" });
  const dailyMerge = unionMergeById(local.dailyLogs, cloud.dailyLogs, lastSyncAt, { kind:"dailyLog" });
  const reviewsMerge = unionMergeById(local.reviews, cloud.reviews, lastSyncAt, { kind:"review" });
  [readingsMerge,errorsMerge,practiceMerge,mocksMerge,sessionsMerge,dailyMerge,reviewsMerge].forEach(m=>conflicts.push(...m.conflicts));

  const readingById={}; readingsMerge.merged.forEach(r=>readingById[r.id]=r);
  S.topics.forEach(t=>t.r.forEach(r=>{
    const m=readingById[r.id]; if(!m) return;
    ["status","mastery","note","spent","hrs","readingNo","excludedFraction","excludedNote","stages","sourceMap","pages","brief","readingPractice","closeout"].forEach(k=>{
      if(m[k]!==undefined) r[k]=m[k];
    });
  }));
  S.errors = errorsMerge.merged;
  const practice={};
  practiceMerge.merged.forEach(p=>{ practice[p.date]=practice[p.date]||{}; practice[p.date][p.topicId]={a:p.a,c:p.c}; });
  S.practice = practice;
  S.mocks = mocksMerge.merged.map(m=>({...m}));
  S.sessions = sessionsMerge.merged.map(s=>({...s}));
  const dailyLog={}; dailyMerge.merged.forEach(d=>{ dailyLog[d.date]=d.hours; }); S.dailyLog=dailyLog;
  const reviews={}; reviewsMerge.merged.forEach(r=>{ const {id,updatedAt,...rest}=r; reviews[id]=rest; }); S.reviews=reviews;

  if(cloud.profile){
    const localMeta = window.getCoachState().lastLocalChangeAt||0;
    const cloudMeta = cloud.profile.updatedAt||0;
    if(cloudMeta > (lastSyncAt||0) && cloudMeta >= localMeta){
      ["examDate","target","buffer","qGoal","celebrated","restDays","planCfg","closeoutCfg","readinessCfg"].forEach(k=>{
        if(cloud.profile[k]!==undefined) S[k]=cloud.profile[k];
      });
    }
  }
  S.syncConflicts = conflicts;
  window.setCoachState(S); window.coachSave(); window.coachRenderAll();
}

window.CoachSync = { onChange, getStatus, signUp, signIn, signOut: signOutUser, syncNow, useLocalData, useCloudData, mergeBothData };
window.__coachSyncMergeTest = { unionMergeById }; /* exposed only for the headless unit test harness */

boot();

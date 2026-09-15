"use strict";
/* ---------- cross-device sync (optional, off until the user turns it on) ----------
   Loaded after app.js as a second classic script, so it reads app.js's top-level
   bindings (S, migrate, validateImportData, persistState, renderAll, toast…) directly.

   Backend: a Firebase Realtime Database, talked to over plain REST — no SDK, no CDN,
   no build step, nothing committed to the repo. The user pastes their own database URL
   and a secret sync code once per device; both live in localStorage on that device only,
   never in the exported JSON and never in git.

   Model: the whole state document is the sync unit, last-write-wins, EXCEPT when both
   sides changed since this device's last successful sync — that is a real conflict and
   the user picks a side instead of one silently winning. A local snapshot is always
   written before remote data replaces local data, so nothing is unrecoverable. */

const SYNC_CFG_KEY = "cfa_l2_sync_cfg_v1";
const SYNC_BACKUP_KEY = "cfa_l2_pre_sync_backup";
const SYNC_PATH = "cfa-sync";
/* The project's Firebase Realtime Database is public configuration; the per-user
   sync code remains local and is still required before any data can be read/written. */
const SYNC_DEFAULT_URL = "https://cfa-study-tracker-cba60-default-rtdb.europe-west1.firebasedatabase.app";
const SYNC_PUSH_DEBOUNCE = 4000;
const SYNC_POLL_MS = 120000;

let syncCfg = { enabled:false, url:SYNC_DEFAULT_URL, code:"", deviceId:"", lastSyncAt:0, remoteStamp:null };
let syncPushT = null;
let syncPollT = null;
let syncBusy = false;
let syncQueued = false;
let syncPending = null; /* the remote envelope waiting on a conflict decision */

function syncReadCfg(){
  try{
    const raw = localStorage.getItem(SYNC_CFG_KEY);
    if(raw) syncCfg = Object.assign(syncCfg, JSON.parse(raw) || {});
  }catch(e){}
  if(!syncCfg.url) syncCfg.url = SYNC_DEFAULT_URL;
  if(!syncCfg.deviceId) syncCfg.deviceId = syncRandom(8);
  return syncCfg;
}
function syncWriteCfg(){
  try{ localStorage.setItem(SYNC_CFG_KEY, JSON.stringify(syncCfg)); }catch(e){}
}
function syncRandom(n){
  const alphabet = "abcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  const buf = new Uint8Array(n);
  if(window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(buf);
  else for(let i=0;i<n;i++) buf[i] = Math.floor(Math.random()*256);
  for(let i=0;i<n;i++) out += alphabet[buf[i] % alphabet.length];
  return out;
}

/* accepts what the Firebase console shows, with or without a trailing slash or .json */
function syncNormalizeUrl(raw){
  let u = String(raw||"").trim();
  if(!u) return "";
  if(!/^https?:\/\//i.test(u)) u = "https://" + u;
  u = u.replace(/\.json(\?.*)?$/i, "").replace(/\/+$/, "");
  try{ new URL(u); }catch(e){ return ""; }
  return u;
}
/* named before the first request rather than after a confusing 404 */
function syncUrlComplaint(u){
  if(/console\.firebase\.google\.com/i.test(u))
    return "هذا رابط لوحة تحكم Firebase وليس رابط قاعدة البيانات. افتح Realtime Database وانسخ الرابط الظاهر أعلى الجدول.";
  if(/firestore|\.firebaseapp\.com|\.web\.app/i.test(u))
    return "هذا رابط مشروع/Firestore وليس Realtime Database. المطلوب رابط ينتهي بـ firebaseio.com أو firebasedatabase.app.";
  if(!/(firebaseio\.com|firebasedatabase\.app)$/i.test(u))
    return "الرابط لا يبدو رابط Realtime Database. المفروض ينتهي بـ firebaseio.com أو firebasedatabase.app.";
  return "";
}
function syncCodeValid(code){ return /^[a-z0-9]{16,64}$/.test(String(code||"").trim()); }
function syncEndpoint(){ return syncCfg.url + "/" + SYNC_PATH + "/" + syncCfg.code + ".json"; }
function syncConfigured(){ return !!(syncCfg.enabled && syncCfg.url && syncCodeValid(syncCfg.code)); }

/* ---------- remote I/O ---------- */
function syncHttpError(method, res){
  const e = new Error(method + " " + res.status);
  e.status = res.status;
  e.method = method;
  return e;
}
async function syncRemoteGet(){
  let res;
  try{
    res = await fetch(syncEndpoint() + "?t=" + Date.now(), { method:"GET", cache:"no-store" });
  }catch(e){ const err = new Error("network"); err.network = true; throw err; }
  if(!res.ok) throw syncHttpError("GET", res);
  const body = await res.json();
  return body && typeof body === "object" ? body : null;
}
async function syncRemotePut(envelope){
  let res;
  try{
    res = await fetch(syncEndpoint(), {
      method:"PUT",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify(envelope)
    });
  }catch(e){ const err = new Error("network"); err.network = true; throw err; }
  if(!res.ok) throw syncHttpError("PUT", res);
  return true;
}

/* Turn a failure into the one sentence that names the actual step to fix. The generic
   "check your link and code" is useless: every one of these has a different remedy. */
function syncExplain(err){
  if(!navigator.onLine) return "لا يوجد اتصال بالإنترنت. تُستأنف المزامنة تلقائياً عند رجوع الاتصال.";
  if(err && err.network)
    return "تعذّر الوصول إلى الرابط. تأكد أنك نسخته كاملاً من أعلى صفحة Realtime Database في Firebase، "+
           "وأن قاعدة البيانات لم تُحذف.";
  const st = err && err.status;
  if(st === 401 || st === 403)
    return "قاعدة البيانات ترفض الوصول — قواعد الوصول لم تُنشر بعد (ما زالت على الوضع المقفل). "+
           "افتح Realtime Database ← تبويب Rules، والصق القواعد الموجودة في SYNC_SETUP.md ثم اضغط Publish.";
  if(st === 404)
    return "الرابط لا يشير إلى قاعدة بيانات موجودة. انسخه من أعلى صفحة Realtime Database تحديداً "+
           "(وليس رابط Firestore ولا رابط لوحة تحكم المشروع).";
  if(st === 400)
    return "الرابط غير صالح. المفروض ينتهي بـ firebaseio.com أو firebasedatabase.app بدون أي مسار بعده.";
  if(st) return "استجابة غير متوقعة من Firebase (" + err.method + " " + st + ").";
  return "تعذّرت المزامنة لسبب غير معروف. جرّب «مزامنة الآن» مرة ثانية.";
}
function syncShowError(msg){
  const el = document.querySelector("#syncError");
  if(!el) return;
  el.textContent = msg || "";
  el.hidden = !msg;
}

/* ---------- status line ---------- */
function syncTimeText(ts){
  if(!ts) return "";
  try{
    return new Date(ts).toLocaleTimeString("ar-SA-u-nu-latn", {hour:"2-digit", minute:"2-digit"});
  }catch(e){ return ""; }
}
function syncSetStatus(kind, extra){
  const el = document.querySelector("#syncStatus");
  if(!el) return;
  const map = {
    off:"غير مفعّلة",
    syncing:"جاري المزامنة…",
    ok:"تمت المزامنة" + (syncCfg.lastSyncAt ? (" " + syncTimeText(syncCfg.lastSyncAt)) : ""),
    conflict:"يوجد تعارض — اختر نسخة",
    offline:"لا يوجد اتصال — سيُعاد المحاولة",
    error:"تعذّرت المزامنة" + (extra ? (" (" + extra + ")") : "")
  };
  el.textContent = map[kind] || map.off;
  el.dataset.kind = kind;
}

/* ---------- adopting remote data ---------- */
function syncSaveLocalBackup(){
  try{
    localStorage.setItem(SYNC_BACKUP_KEY, JSON.stringify({
      ts: Date.now(), appVersion: APP_VERSION, data: JSON.parse(JSON.stringify(S))
    }));
    return true;
  }catch(e){ return false; }
}
async function syncAdoptRemote(env){
  if(!env || !env.data) return false;
  const shape = validateImportData(env.data);
  if(!shape.ok){ toast("بيانات السحابة غير صالحة؛ لم تتغيّر بياناتك", true); return false; }
  let candidate;
  try{
    candidate = migrate(JSON.parse(JSON.stringify(env.data)));
    const after = validateImportData(candidate);
    if(!after.ok) throw new Error(after.message);
  }catch(e){
    toast("تعذّرت ترقية بيانات السحابة؛ لم تتغيّر بياناتك", true);
    return false;
  }
  if(!syncSaveLocalBackup()){
    toast("تعذّر حفظ نسخة احتياطية قبل السحب؛ لم تتغيّر بياناتك", true);
    return false;
  }
  candidate.lastLocalChangeAt = env.updatedAt || Date.now();
  const persisted = await persistState(candidate, false);
  if(!persisted){ toast("تعذّر حفظ بيانات السحابة؛ لم تتغيّر بياناتك", true); return false; }
  S = candidate;
  syncCfg.remoteStamp = env.updatedAt || null;
  /* the adopted stamp comes from the other device's clock; if that clock runs ahead of
     this one, a plain Date.now() here would read as "changed locally" and push the same
     data straight back — two devices could then trade pointless writes forever */
  syncCfg.lastSyncAt = Math.max(Date.now(), candidate.lastLocalChangeAt || 0);
  syncWriteCfg();
  renderAll();
  return true;
}
async function syncPushLocal(){
  await flushSave();
  const stamp = Date.now();
  /* Read the change stamp of the exact snapshot being sent, and mark that as what is
     synced. Using Date.now() after the round trip instead would swallow any edit typed
     while the PUT was in flight: its lastLocalChangeAt would fall before lastSyncAt, so
     the next pass would see nothing to push and the edit would sit on this device only. */
  const payload = JSON.parse(JSON.stringify(S));
  const syncedUpTo = payload.lastLocalChangeAt || stamp;
  await syncRemotePut({
    updatedAt: stamp,
    device: syncCfg.deviceId,
    appVersion: APP_VERSION,
    data: payload
  });
  syncCfg.remoteStamp = stamp;
  syncCfg.lastSyncAt = syncedUpTo;
  syncWriteCfg();
  return true;
}

/* Does this device hold progress of its own, or is it a blank install?
   migrate() stamps lastLocalChangeAt on every fresh state, so on a device that has
   never synced against this code "the local copy changed" is true even when nothing
   was ever typed here — that timestamp alone would turn every newly paired phone into
   a false conflict. On a first link we ask this instead. */
function syncHasLocalProgress(){
  if(!S || !Array.isArray(S.topics)) return false;
  if((S.mocks||[]).length) return true;
  if(S.examDate && DEFAULT.examDate && S.examDate !== DEFAULT.examDate) return true;
  if(S.topics.length !== DEFAULT.topics.length) return true;
  for(let i=0;i<S.topics.length;i++){
    const rs = S.topics[i].r || [];
    const def = DEFAULT.topics[i];
    if(!def || rs.length !== def.r.length) return true;
    for(const r of rs){
      if(r.status && r.status !== "todo") return true;
      if(r.mastery && r.mastery !== "none") return true;
      if(r.qMastery && r.qMastery !== "none") return true;
      /* excludedNote is a syllabus note migrate() writes on every install — not my progress */
      if((r.note||"").trim() || (r.qNote||"").trim()) return true;
      if(Array.isArray(r.questionSessions) && r.questionSessions.length) return true;
    }
  }
  return false;
}

/* ---------- the one sync pass ---------- */
async function syncRun(opts){
  opts = opts || {};
  if(!syncConfigured()){ syncSetStatus("off"); return; }
  /* Don't drop it: a push landing mid-pass would otherwise wait for the two-minute
     poll before the edit that triggered it ever leaves this device. */
  if(syncBusy){ syncQueued = true; return; }
  if(!navigator.onLine){ syncSetStatus("offline"); return; }
  syncBusy = true;
  syncSetStatus("syncing");
  syncShowError("");
  try{
    const env = await syncRemoteGet();
    const localChanged = (S && S.lastLocalChangeAt ? S.lastLocalChangeAt : 0) > (syncCfg.lastSyncAt || 0);

    if(!env){                       /* first device to write this code */
      await syncPushLocal();
      syncShowConflict(false);
      syncSetStatus("ok");
      if(opts.loud) toast("تم رفع بياناتك إلى السحابة");
      return;
    }

    /* identity, not ordering: immune to clocks being out of step between devices */
    const remoteChanged = env.updatedAt !== syncCfg.remoteStamp;
    /* no baseline yet on this device, so timestamps can't tell us anything — a blank
       install just pulls; one that already has progress is a real first-link conflict */
    const firstLink = syncCfg.remoteStamp === null || syncCfg.remoteStamp === undefined;
    const conflicted = remoteChanged && (firstLink ? syncHasLocalProgress() : localChanged);

    if(conflicted){
      syncPending = env;
      syncShowConflict(true);
      syncSetStatus("conflict");
      if(opts.loud) toast("يوجد تعارض بين هذا الجهاز والسحابة", true);
      return;
    }
    syncShowConflict(false);
    if(remoteChanged){
      const ok = await syncAdoptRemote(env);
      syncSetStatus(ok ? "ok" : "error");
      if(ok && opts.loud) toast("تم تحديث بياناتك من السحابة");
      return;
    }
    if(localChanged && !firstLink){
      await syncPushLocal();
      syncSetStatus("ok");
      if(opts.loud) toast("تم رفع تقدّمك إلى السحابة");
      return;
    }
    syncCfg.lastSyncAt = Date.now();
    syncWriteCfg();
    syncSetStatus("ok");
    if(opts.loud) toast("بياناتك محدّثة على كل الأجهزة");
  }catch(err){
    console.warn("sync failed", err);
    syncSetStatus(navigator.onLine && !err.network ? "error" : "offline", String(err && err.message || "").slice(0,24));
    syncShowError(syncExplain(err));
    if(opts.loud) toast("تعذّرت المزامنة — اقرأ سبب الخطأ تحت الحالة", true);
  }finally{
    syncBusy = false;
    if(syncQueued){ syncQueued = false; setTimeout(()=>syncRun(), 300); }
  }
}

/* ---------- conflict resolution ---------- */
function syncShowConflict(show){
  const box = document.querySelector("#syncConflict");
  if(box) box.hidden = !show;
  if(!show) syncPending = null;
}
async function syncResolve(keep){
  if(!syncPending && keep === "remote") return;
  try{
    if(keep === "remote"){
      const env = syncPending;
      syncShowConflict(false);
      const ok = await syncAdoptRemote(env);
      syncSetStatus(ok ? "ok" : "error");
      if(ok) toast("تم اعتماد بيانات السحابة");
    }else{
      /* local wins: overwrite the cloud, but only after the cloud copy is stashed locally */
      const env = syncPending;
      if(env){
        try{ localStorage.setItem(SYNC_BACKUP_KEY, JSON.stringify({ts:Date.now(), from:"cloud", data:env.data})); }catch(e){}
      }
      syncShowConflict(false);
      await syncPushLocal();
      syncSetStatus("ok");
      toast("تم اعتماد بيانات هذا الجهاز ورفعها");
    }
  }catch(err){
    syncSetStatus("error");
    toast("تعذّرت المزامنة — حاول مرة ثانية", true);
  }
}

/* ---------- triggers ---------- */
function syncOnLocalChange(){
  if(!syncConfigured()) return;
  clearTimeout(syncPushT);
  syncPushT = setTimeout(()=>{ syncPushT = null; syncRun(); }, SYNC_PUSH_DEBOUNCE);
}
function syncStartPolling(){
  clearInterval(syncPollT);
  if(!syncConfigured()) return;
  syncPollT = setInterval(()=>{ if(!document.hidden) syncRun(); }, SYNC_POLL_MS);
}

/* ---------- pairing link: open it on the second device and it configures itself ---------- */
function syncPairLink(){
  const payload = btoa(unescape(encodeURIComponent(JSON.stringify({u:syncCfg.url, c:syncCfg.code}))));
  return location.origin + location.pathname + "#sync=" + payload;
}
function syncReadPairHash(){
  const m = /#sync=([A-Za-z0-9+/=]+)/.exec(location.hash || "");
  if(!m) return null;
  try{
    const o = JSON.parse(decodeURIComponent(escape(atob(m[1]))));
    const url = syncNormalizeUrl(o.u);
    if(url && syncCodeValid(o.c)) return {url:url, code:String(o.c).trim()};
  }catch(e){}
  return null;
}

/* ---------- UI ---------- */
function syncFillForm(){
  const u = document.querySelector("#syncUrl"), c = document.querySelector("#syncCode");
  if(u) u.value = syncCfg.url || "";
  if(c) c.value = syncCfg.code || "";
  const sec = document.querySelector(".sync-sec");
  if(sec) sec.dataset.on = syncConfigured() ? "1" : "";
}
function syncWireUi(){
  const gen = document.querySelector("#syncGenBtn");
  const saveBtn = document.querySelector("#syncSaveBtn");
  const nowBtn = document.querySelector("#syncNowBtn");
  const linkBtn = document.querySelector("#syncLinkBtn");
  const offBtn = document.querySelector("#syncOffBtn");
  const keepLocal = document.querySelector("#syncKeepLocal");
  const keepRemote = document.querySelector("#syncKeepRemote");

  if(gen) gen.onclick = ()=>{
    const el = document.querySelector("#syncCode");
    if(el){ el.value = syncRandom(24); toast("تم توليد رمز — اضغط تفعيل المزامنة"); }
  };
  if(saveBtn) saveBtn.onclick = async ()=>{
    const url = syncNormalizeUrl((document.querySelector("#syncUrl")||{}).value);
    const code = String(((document.querySelector("#syncCode")||{}).value)||"").trim().toLowerCase();
    if(!url){ syncShowError("رابط قاعدة البيانات غير صالح."); toast("رابط قاعدة البيانات غير صالح", true); return; }
    const complaint = syncUrlComplaint(url);
    if(complaint){ syncShowError(complaint); toast("الرابط ليس رابط Realtime Database", true); return; }
    if(!syncCodeValid(code)){
      syncShowError("رمز المزامنة يجب أن يكون من 16 إلى 64 حرفاً، حروفاً إنجليزية صغيرة وأرقاماً فقط. "+
                    "اضغط «توليد رمز» ليولّده الموقع لك.");
      toast("رمز المزامنة غير صالح", true); return;
    }
    syncShowError("");
    const changedTarget = (url !== syncCfg.url) || (code !== syncCfg.code);
    syncCfg.url = url; syncCfg.code = code; syncCfg.enabled = true;
    if(changedTarget){ syncCfg.remoteStamp = null; syncCfg.lastSyncAt = 0; }
    syncWriteCfg();
    syncFillForm();
    syncStartPolling();
    await syncRun({loud:true});
  };
  if(nowBtn) nowBtn.onclick = ()=>syncRun({loud:true});
  if(linkBtn) linkBtn.onclick = async ()=>{
    if(!syncConfigured()){ toast("فعّل المزامنة أولاً", true); return; }
    const ok = await copyText(syncPairLink());
    toast(ok ? "تم نسخ رابط الربط — افتحه على جهازك الثاني" : "تعذّر النسخ", !ok);
  };
  if(offBtn) offBtn.onclick = ()=>armConfirm(offBtn, ()=>{
    syncCfg.enabled = false;
    syncWriteCfg();
    clearInterval(syncPollT);
    syncShowConflict(false);
    syncShowError("");
    syncFillForm();
    syncSetStatus("off");
    toast("أُوقفت المزامنة — بياناتك المحلية كما هي");
  });
  if(keepLocal) keepLocal.onclick = ()=>syncResolve("local");
  if(keepRemote) keepRemote.onclick = ()=>syncResolve("remote");
}

/* ---------- boot (called by app.js once state is loaded and rendered) ---------- */
async function syncBoot(){
  syncReadCfg();
  const paired = syncReadPairHash();
  if(paired){
    syncCfg.url = paired.url;
    syncCfg.code = paired.code;
    syncCfg.enabled = true;
    syncCfg.remoteStamp = null;
    syncCfg.lastSyncAt = 0;
    try{ history.replaceState(null, "", location.pathname + location.search); }catch(e){}
    toast("تم ربط هذا الجهاز بالمزامنة");
  }
  syncWriteCfg();
  syncWireUi();
  syncFillForm();
  syncSetStatus(syncConfigured() ? "syncing" : "off");
  /* Registered unconditionally — syncRun() is a no-op while sync is off. Registering
     them only when already configured would leave a device that turns sync on from the
     button with no pull on focus, visibility or reconnect until the next page load. */
  window.addEventListener("online", ()=>syncRun());
  document.addEventListener("visibilitychange", ()=>{ if(!document.hidden) syncRun(); });
  window.addEventListener("focus", ()=>syncRun());
  if(!syncConfigured()) return;
  await syncRun({loud: !!paired});
  syncStartPolling();
}

window.cfaSync = { boot: syncBoot, run: syncRun, onLocalChange: syncOnLocalChange };
if(window.__cfaAppReady) syncBoot();
else document.addEventListener("cfa:ready", syncBoot, {once:true});
